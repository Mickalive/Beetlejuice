import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectHistory } from '../src/collect/history.js';
import { stubTransport, testToken } from './helpers.js';
import {
  OWNER,
  REPO,
  fixturePullRequests,
  fixtureCommitsByPull,
  fixtureWorkflowRuns,
  fixtureWorkflowJobs,
  fixtureCheckRunsBySha,
  sha,
} from './fixtures/synthetic-repo.js';

/** Full in-memory GitHub standing in for api.github.com (fixture mode). */
function memoryGithub({ maxPrPages = 1 } = {}) {
  const prs = fixturePullRequests();
  const commits = fixtureCommitsByPull();
  const runs = { workflow_runs: fixtureWorkflowRuns(), total_count: fixtureWorkflowRuns().length };
  const jobs = fixtureWorkflowJobs();
  return stubTransport([
    {
      match: new RegExp(`/repos/${OWNER}/${REPO}/pulls$`),
      respond: prs,
      headers: maxPrPages > 1 ? {} : {}, // single page: no Link header
    },
    {
      match: new RegExp(`/repos/${OWNER}/${REPO}/pulls/(\\d+)/commits$`),
      respond: (u) => commits.get(Number(u.pathname.match(/(\d+)\/commits$/)[1])) ?? [],
    },
    { match: new RegExp(`/repos/${OWNER}/${REPO}/actions/runs$`), respond: runs },
    {
      match: new RegExp(`/repos/${OWNER}/${REPO}/actions/runs/(\\d+)/jobs$`),
      respond: (u) => {
        const runId = Number(u.pathname.match(/runs\/(\d+)\/jobs$/)[1]);
        const list =
          jobs.get(`${runId}@a1`) ??
          [...jobs.entries()].find(([key]) => key.startsWith(`${runId}@`))?.[1] ??
          [];
        return { jobs: list, total_count: list.length };
      },
    },
    {
      match: new RegExp(`/repos/${OWNER}/${REPO}/commits/([0-9a-f]+)/check-runs$`),
      respond: (u) => {
        const shaValue = u.pathname.match(/commits\/([0-9a-f]+)\/check-runs$/)[1];
        const list = fixtureCheckRunsBySha().get(shaValue) ?? [];
        return { check_runs: list, total_count: list.length };
      },
    },
  ]);
}

test('historical sweep issues only the documented GET plan', async () => {
  const { fetchImpl, calls } = memoryGithub();
  const evidence = await collectHistory({
    repoConfig: { owner: OWNER, repo: REPO },
    policy: { botActors: ['forge-bot[bot]'], branchPrefixes: ['forge/'] },
    fetchImpl,
  });

  const paths = calls.map((c) => c.path);
  assert.ok(paths.some((p) => p.endsWith('/pulls')));
  assert.ok(paths.includes(`/repos/${OWNER}/${REPO}/pulls/101/commits`));
  assert.ok(paths.includes(`/repos/${OWNER}/${REPO}/actions/runs`));
  // check-runs probed only for revisions of INGESTED PRs:
  assert.ok(paths.includes(`/repos/${OWNER}/${REPO}/commits/${sha.pr101r2}/check-runs`));
  assert.ok(!paths.includes(`/repos/${OWNER}/${REPO}/commits/${sha.unrelated}/check-runs`));
  for (const c of calls) assert.equal(c.method, 'GET');
});

test('Actions jobs are fetched ONLY for runs correlated to ingested tasks (data minimization)', async () => {
  const { fetchImpl, calls } = memoryGithub();
  const evidence = await collectHistory({
    repoConfig: { owner: OWNER, repo: REPO },
    policy: { botActors: ['forge-bot[bot]'], branchPrefixes: ['forge/'] },
    fetchImpl,
  });

  const jobPaths = calls
    .filter((c) => /\/actions\/runs\/(\d+)\/jobs$/.test(c.path))
    .map((c) => Number(c.path.match(/runs\/(\d+)\/jobs$/)[1]));
  // Correlated: 9001 (explicit), 9002 (branch+SHA), 9004 (open PR branch),
  // 9005 (branch match even though its conclusion is unmapped — compute was
  // still consumed). NOT correlated: 9003 on the foreign manual branch.
  assert.deepEqual([...jobPaths].sort((a, b) => a - b), [9001, 9002, 9004, 9005]);
  for (const c of calls.filter((c) => c.path.endsWith('/jobs'))) {
    assert.equal(c.method, 'GET');
    assert.equal(c.query.per_page, '100');
  }

  // Evidence is keyed per run attempt; attempts share one run id so run 9001
  // appears exactly once under its first-seen attempt.
  assert.ok(evidence.workflowJobsByRunAttempt instanceof Map);
  assert.deepEqual([...evidence.workflowJobsByRunAttempt.keys()].sort(), ['9001@a1', '9002@a1', '9004@a1', '9005@a1']);
  assert.equal(evidence.workflowJobsByRunAttempt.get('9001@a1').length, 2);
  assert.equal(evidence.collection.truncated.jobs, false);
});

test('collector fetch decision matches the assembler emission decision (parity)', async () => {
  const { fetchImpl } = memoryGithub();
  const evidence = await collectHistory({
    repoConfig: { owner: OWNER, repo: REPO },
    policy: { botActors: ['forge-bot[bot]'], branchPrefixes: ['forge/'] },
    fetchImpl,
  });
  const fetchedRunIds = new Set(
    [...evidence.workflowJobsByRunAttempt.keys()].map((k) => k.split('@')[0])
  );
  const { assembleAudit } = await import('../src/map/audit.js');
  const { events } = assembleAudit(evidence, {});
  const jobEvents = events.filter((e) => e.type === 'compute_usage_recorded');
  assert.ok(jobEvents.length > 0);
  for (const ev of jobEvents) {
    const runId = ev.source.ref.match(/runs\/(\d+)\/jobs$/)[1];
    assert.ok(fetchedRunIds.has(runId), `emitted job evidence for run ${runId} that was never fetched`);
  }
});

test('classification happens at collection time with honest exclusion counts', async () => {
  const { fetchImpl } = memoryGithub();
  const evidence = await collectHistory({
    repoConfig: { owner: OWNER, repo: REPO },
    policy: { botActors: ['forge-bot[bot]'], branchPrefixes: ['forge/'] },
    fetchImpl,
  });
  assert.equal(evidence.prs.length, 4);
  assert.equal(evidence.prClassifications.get(101).agentic, true);
  assert.equal(evidence.prClassifications.get(110).agentic, false);
});

test('evidence structure is inert and complete for the assembler', async () => {
  const { fetchImpl } = memoryGithub();
  const evidence = await collectHistory({
    repoConfig: { owner: OWNER, repo: REPO },
    policy: { botActors: ['forge-bot[bot]'], branchPrefixes: ['forge/'] },
    fetchImpl,
  });
  assert.deepEqual(evidence.scope, { owner: OWNER, repo: REPO, key: `${OWNER}/${REPO}` });
  assert.equal(evidence.workflowRuns.length, 6);
  assert.ok(evidence.checkRunsBySha instanceof Map);
  assert.ok(evidence.commitsByPull instanceof Map);
  assert.ok(Array.from(evidence.checkRunsBySha.keys()).includes(sha.pr101r3));
});

test('real-mode credential path is explicit; nothing runs without one', async () => {
  await assert.rejects(
    () => collectHistory({ repoConfig: { owner: OWNER, repo: REPO }, policy: { botActors: [] } }),
    /requires either an explicit client|token/
  );
});

test('limits are validated before any request is made', async () => {
  await assert.rejects(
    () =>
      collectHistory({
        repoConfig: { owner: OWNER, repo: REPO },
        policy: { botActors: [] },
        token: testToken(),
        limits: { maxPrPages: 0 },
      }),
    /maxPrPages/
  );
});
