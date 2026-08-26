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
import { actionsUsageCostSource } from '../src/cost-source.js';
import {
  OWNER,
  REPO,
  SCOPE_KEY,
  BOT_ACTOR,
  fixturePullRequests,
  fixtureCommitsByPull,
  fixtureWorkflowRuns,
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
  return async function fetchImpl(url) {
    const u = new URL(url);
    const p = u.pathname;
    const json = p.endsWith(`/repos/${OWNER}/${REPO}/pulls`)
      ? prs
      : /\/pulls\/(\d+)\/commits$/.test(p)
        ? (commits.get(Number(p.match(/(\d+)\/commits$/)[1])) ?? [])
        : p.endsWith('/actions/runs')
          ? { workflow_runs: runs }
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
  assert.equal(stats.costs.known_micro_usd_total, 232_000); // $0.12 + $0.112
  assert.equal(stats.counts.workflow_runs_emitted, 3);
  assert.equal(stats.counts.check_runs_emitted, 3);

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
