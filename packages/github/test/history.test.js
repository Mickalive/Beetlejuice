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
  fixtureCheckRunsBySha,
  sha,
} from './fixtures/synthetic-repo.js';

/** Full in-memory GitHub standing in for api.github.com (fixture mode). */
function memoryGithub({ maxPrPages = 1 } = {}) {
  const prs = fixturePullRequests();
  const commits = fixtureCommitsByPull();
  const runs = { workflow_runs: fixtureWorkflowRuns(), total_count: fixtureWorkflowRuns().length };
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
