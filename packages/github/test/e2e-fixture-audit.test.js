/**
 * End-to-end fixture audit (WC-002 acceptance: "fixture audit works without
 * credentials"). Exercises the REAL transport seam — createGithubRestClient
 * over an injected in-memory fetch — through collectHistory into
 * assembleAudit, proving the full read-only pipeline produces canonical
 * evidence with zero network access and zero credentials.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectHistory } from '../src/collect/history.js';
import { createGithubRestClient } from '../src/collect/client.js';
import { assembleAudit } from '../src/map/audit.js';
import { actionsUsageCostSource, actionsMeasuredCostSource } from '../src/cost-source.js';
import {
  OWNER,
  REPO,
  SCOPE_KEY,
  BOT_ACTOR,
  fixturePullRequests,
  fixtureCommitsByPull,
  fixtureWorkflowRuns,
  fixtureWorkflowJobs,
  fixtureCheckRunsBySha,
  fixtureUsageRecords,
  FIXTURE_RATE_USD_PER_MINUTE,
  sha,
} from './fixtures/synthetic-repo.js';

function inMemoryGithub() {
  const prs = fixturePullRequests();
  const commits = fixtureCommitsByPull();
  const runs = fixtureWorkflowRuns();
  const checks = fixtureCheckRunsBySha();
  const jobs = fixtureWorkflowJobs();
  return async function fetchImpl(url) {
    const u = new URL(url);
    const p = u.pathname;
    const json = p.endsWith(`/repos/${OWNER}/${REPO}/pulls`)
      ? prs
      : /\/pulls\/(\d+)\/commits$/.test(p)
        ? (commits.get(Number(p.match(/(\d+)\/commits$/)[1])) ?? [])
        : p.endsWith('/actions/runs')
          ? { workflow_runs: runs }
          : /\/actions\/runs\/(\d+)\/jobs$/.test(p)
            ? (() => {
                const runId = Number(p.match(/runs\/(\d+)\/jobs$/)[1]);
                const list =
                  jobs.get(`${runId}@a1`) ??
                  [...jobs.entries()].find(([key]) => key.startsWith(`${runId}@`))?.[1] ??
                  [];
                return { jobs: list, total_count: list.length };
              })()
            : /\/commits\/([0-9a-f]+)\/check-runs$/.test(p)
              ? { check_runs: checks.get(p.match(/commits\/([0-9a-f]+)\/check-runs$/)[1]) ?? [] }
              : null;
    return { status: json === null ? 404 : 200, headers: {}, json };
  };
}

test('full pipeline: in-memory GitHub -> collector -> canonical audit (no credentials)', async () => {
  const fetchImpl = inMemoryGithub();
  const seenMethods = [];
  const client = createGithubRestClient({
    // No token anywhere in this test: fixture mode must stay credential-free.
    fetchImpl: async (url, init) => {
      seenMethods.push(init.method);
      return fetchImpl(url, init);
    },
  });

  const evidence = await collectHistory({
    repoConfig: { owner: OWNER, repo: REPO },
    policy: { botActors: [BOT_ACTOR], branchPrefixes: ['forge/'] },
    client,
  });
  assert.ok(seenMethods.length > 0);
  assert.ok(seenMethods.every((m) => m === 'GET'), 'the whole sweep must be read-only');

  const { events, stats } = assembleAudit(evidence, {
    costSource: actionsUsageCostSource({
      usageByAttempt: fixtureUsageRecords(),
      rateUsdPerMinute: FIXTURE_RATE_USD_PER_MINUTE,
    }),
  });

  // Economics add up exactly from represented evidence:
  // runs: $0.12 + $0.112 from usage records; jobs stay unknown under the
  // run-level-only source, so the known total is unchanged.
  assert.equal(stats.costs.known_micro_usd_total, 232_000);
  assert.equal(stats.counts.workflow_runs_emitted, 3);
  assert.equal(stats.counts.check_runs_emitted, 3);
  assert.equal(stats.counts.workflow_jobs_emitted, 5); // terminal jobs of correlated runs
  assert.equal(stats.counts.workflow_jobs_pending_not_terminal, 1); // 5202 still running

  // Job events are compute evidence bound to tasks/revision executions:
  const jobEvents = events.filter((e) => e.type === 'compute_usage_recorded');
  assert.equal(jobEvents.length, 5);
  for (const ev of jobEvents) {
    assert.equal(ev.payload.resource_class, 'github_actions_runner');
    assert.match(ev.payload.resource_ref, /^cmp:wfjob:\d+$/);
    assert.ok(ev.event_id.startsWith(`ev:${SCOPE_KEY}:wfjob:`));
  }
  // The 6-minute integration job on run 9002 binds to its revision execution:
  const integration = jobEvents.find((e) => e.payload.resource_ref === 'cmp:wfjob:5201');
  assert.equal(integration.task_ref, 't:pr:101');
  assert.equal(integration.execution_ref, `t:pr:101:rev:${sha.pr101r3}`);

  // The merged task carries its supersession chain and terminal success:
  const task101 = events.filter((e) => e.task_ref === 't:pr:101');
  assert.ok(task101.some((e) => e.type === 'pull_request_merged'));
  const superseded = task101.filter(
    (e) => e.type === 'execution_finished' && e.payload.status === 'superseded'
  );
  assert.equal(superseded.length, 2);

  // Revision-bound CI on the duplicated attempt shares one equivalence key:
  const dupKey = new Set(
    events
      .filter((e) => e.type === 'ci_run_recorded' && e.payload.revision_key === sha.pr101r2)
      .map((e) => e.payload.equivalence_key)
  );
  assert.equal(dupKey.size, 1);

  // Scope discipline survives the whole journey:
  assert.ok(stats.scope === SCOPE_KEY);
  for (const ev of events) assert.ok(ev.event_id.startsWith(`ev:${SCOPE_KEY}:`));
});

test('full pipeline: measured compute money from collected job timing, without double-counting', async () => {
  const fetchImpl = inMemoryGithub();
  const evidence = await collectHistory({
    repoConfig: { owner: OWNER, repo: REPO },
    policy: { botActors: [BOT_ACTOR], branchPrefixes: ['forge/'] },
    fetchImpl,
  });

  const { events, stats } = assembleAudit(evidence, {
    costSource: actionsMeasuredCostSource({
      usageByAttempt: fixtureUsageRecords(),
      rateUsdPerMinute: FIXTURE_RATE_USD_PER_MINUTE,
    }),
  });

  // Run-level usage money: $0.12 + $0.112 = 232_000 µ$ (unchanged semantics).
  // Job-level money for attempts NOT covered by usage records:
  //   9002@a1 integration 6min            -> 48_000 µ$
  //   9004@a1 warm-cache 30s -> ceil(1)   ->  8_000 µ$ (per-job billed minimum)
  //   9005@a1 gauge-lint 150s -> ceil(3)  -> 24_000 µ$
  // Jobs of 9001@a1 resolve to UNKNOWN because run-level usage already carries
  // that attempt — composing both evidence classes cannot double-count.
  assert.equal(stats.costs.known_micro_usd_total, 312_000);
  assert.equal(
    stats.costs.unknown_by_reason['a run-level actions usage record already carries this attempt cost; job-level money would double-count'],
    2
  );

  const measuredJobs = events.filter(
    (e) => e.type === 'compute_usage_recorded' && e.payload.cost.known === true
  );
  assert.deepEqual(
    measuredJobs.map((e) => e.payload.resource_ref).sort(),
    ['cmp:wfjob:5201', 'cmp:wfjob:5301', 'cmp:wfjob:5401']
  );
  assert.deepEqual(measuredJobs.map((e) => e.payload.cost.micro_usd).sort((a, b) => a - b), [
    8_000,
    24_000,
    48_000,
  ]);
});

test('real-mode configuration is accepted and shaped correctly (no live call)', () => {
  // Composed at runtime from harmless fragments — no credential-shaped literal.
  const token = ['ghp', 'local', 'fixture'].join('_');
  const client = createGithubRestClient({ token, baseUrl: 'https://api.github.com' });
  assert.equal(client.baseUrl, 'https://api.github.com');
  // The client exposes ONLY reads; there is no post/patch/delete capability.
  for (const key of Object.keys(client)) {
    assert.match(String(key), /^(request|paginate|baseUrl)$/, `unexpected capability "${key}"`);
  }
});
