import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWebhookDelivery } from '../src/webhook/normalize.js';
import { buildPrIndex, entryForPullRequest } from '../src/map/pr-index.js';
import { fixtureEvidence, sha, SCOPE_KEY, OWNER, REPO, BOT_ACTOR, HUMAN_ACTOR } from './fixtures/synthetic-repo.js';

/** Build the ingested-task index the same way the audit pipeline does. */
function ingestedIndex() {
  const evidence = fixtureEvidence();
  const entries = [];
  for (const pr of evidence.prs) {
    if (pr.number === 110) continue; // excluded upstream by policy
    entries.push(
      entryForPullRequest({
        pr,
        classification:
          pr.login === BOT_ACTOR
            ? { agentic: true, confidence: 'measured', basis: 'bot_actor_allowlist' }
            : { agentic: true, confidence: 'inferred', basis: 'branch_prefix_match:forge/' },
        commits: evidence.commitsByPull.get(pr.number) ?? [],
        scope: evidence.scope,
      }).entry
    );
  }
  return buildPrIndex(entries);
}

const repoConfig = { owner: OWNER, repo: REPO };
const policy = { botActors: [BOT_ACTOR], branchPrefixes: ['forge/'] };

const base = {
  event: 'pull_request',
  action: 'opened',
  repoConfig,
  policy,
  prIndex: ingestedIndex(),
  payload: {
    repository: { full_name: `${OWNER}/${REPO}` },
    number: 205,
    action: 'opened',
    pull_request: {
      number: 205,
      state: 'open',
      created_at: '2026-08-01T09:00:00Z',
      user: { login: BOT_ACTOR },
      head: { ref: 'forge/new-idea', sha: sha.pr103head },
    },
  },
};

/**
 * Build a delivery; `over` merges sensibly: `action` applies to both the
 * delivery and the payload, `pull_request` replaces the snapshot, any other
 * keys are merged into the payload (e.g. `repository`).
 */
function delivery(over = {}) {
  const { action, pull_request, payload: replacePayload, ...rest } = over;
  const result = { ...base };
  const payload = { ...base.payload };
  if (action !== undefined) {
    result.action = action;
    payload.action = action;
  }
  if (pull_request !== undefined) payload.pull_request = pull_request;
  Object.assign(payload, rest);
  result.payload = replacePayload ?? payload;
  return result;
}

test('an opened agentic PR delivery emits task_started + pull_request_created', () => {
  const { delivered, ignored } = normalizeWebhookDelivery(delivery());
  assert.equal(ignored, undefined);
  assert.deepEqual(
    delivered.map((d) => d.event.type),
    ['task_started', 'pull_request_created']
  );
  const created = delivered[1].event;
  assert.equal(created.task_ref, 't:pr:205');
  assert.equal(created.payload.pr_ref, 'pr:205');
  assert.match(created.source.meta.head_branch, /forge\//);
});

test('event ids match the historical mapper so idempotent re-ingestion is safe', () => {
  const { delivered } = normalizeWebhookDelivery(delivery());
  assert.ok(delivered.every((d) => d.event.event_id.startsWith(`ev:${SCOPE_KEY}:`)));
  const ids = delivered.map((d) => d.event.event_id);
  assert.deepEqual(ids.sort(), [
    `ev:${SCOPE_KEY}:pr-created:205`,
    `ev:${SCOPE_KEY}:task-started:pr205`,
  ]);
});

test('a closed-unmerged delivery emits exactly one pull_request_closed', () => {
  const { delivered } = normalizeWebhookDelivery(
    delivery({
      action: 'closed',
      pull_request: {
        number: 205,
        state: 'closed',
        closed_at: '2026-08-02T10:00:00Z',
        merged_at: null,
        user: { login: BOT_ACTOR },
        head: { ref: 'forge/new-idea', sha: sha.pr103head },
      },
    })
  );
  assert.deepEqual(delivered.map((d) => d.event.type), ['pull_request_closed']);
});

test('a merged delivery emits pull_request_merged with the merge timestamp', () => {
  const { delivered } = normalizeWebhookDelivery(
    delivery({
      action: 'closed',
      pull_request: {
        number: 206,
        state: 'closed',
        closed_at: '2026-08-02T11:00:00Z',
        merged_at: '2026-08-02T10:59:00Z',
        user: { login: BOT_ACTOR },
        head: { ref: 'forge/merge-me', sha: sha.pr101r3 },
      },
    })
  );
  assert.deepEqual(delivered.map((d) => d.event.type), ['pull_request_merged']);
  assert.equal(delivered[0].event.time, '2026-08-02T10:59:00Z');
});

test('non-agentic PR deliveries are ignored with a reason, not silently mapped', () => {
  const res = normalizeWebhookDelivery(
    delivery({ pull_request: { ...delivery().payload.pull_request, user: { login: HUMAN_ACTOR }, head: { ref: 'feature/x', sha: sha.unrelated } } })
  );
  assert.equal(res.delivered.length, 0);
  assert.equal(res.ignored.reason, 'pr_not_agentic_under_policy');
});

test('synchronize is deferred to the revision sweep (no invented revisions)', () => {
  const res = normalizeWebhookDelivery(delivery({ action: 'synchronize' }));
  assert.equal(res.delivered.length, 0);
  assert.match(res.ignored.reason, /unsupported_pr_action:synchronize/);
});

test('completed workflow runs correlate through the SAME index used historically', () => {
  const { delivered, ignored } = normalizeWebhookDelivery({
    event: 'workflow_run',
    action: 'completed',
    repoConfig,
    policy,
    prIndex: ingestedIndex(),
    payload: {
      repository: { full_name: `${OWNER}/${REPO}` },
      workflow_run: {
        id: 9100,
        run_attempt: 1,
        status: 'completed',
        conclusion: 'success',
        head_branch: 'forge/gauge-cleanup',
        head_sha: sha.pr102head,
        run_started_at: '2026-07-05T10:10:00Z',
        updated_at: '2026-07-05T10:20:00Z',
        path: '.github/workflows/ci.yml@refs/heads/main',
        pull_requests: [],
      },
    },
  });
  assert.equal(ignored, undefined);
  assert.equal(delivered.length, 1);
  const ev = delivered[0].event;
  assert.equal(ev.type, 'ci_run_recorded');
  assert.equal(ev.task_ref, 't:pr:102'); // inferred via branch+SHA — honest
  assert.equal(ev.source.meta.link_confidence, 'inferred');
  assert.equal(ev.payload.cost.known, false); // no usage supplied here
});

test('workflow_run without an ingested-task index is deferred with an explicit reason', () => {
  const res = normalizeWebhookDelivery({
    event: 'workflow_run',
    action: 'completed',
    repoConfig,
    policy,
    payload: { repository: { full_name: `${OWNER}/${REPO}` }, workflow_run: { id: 1, status: 'completed' } },
  });
  assert.equal(res.ignored.reason, 'workflow_run_deferred_no_task_index_supplied');
});

test('terminal check runs bind to known revisions through the shared mapper', () => {
  const { delivered } = normalizeWebhookDelivery({
    event: 'check_run',
    action: 'completed',
    repoConfig,
    policy,
    prIndex: ingestedIndex(),
    payload: {
      repository: { full_name: `${OWNER}/${REPO}` },
      check_run: {
        id: 7100,
        name: 'unit-tests',
        status: 'completed',
        conclusion: 'failure',
        head_sha: sha.pr102head,
        completed_at: '2026-07-05T10:19:00Z',
      },
    },
  });
  assert.equal(delivered.length, 1);
  const ev = delivered[0].event;
  assert.equal(ev.type, 'validation_recorded');
  assert.equal(ev.payload.status, 'failed');
  assert.equal(ev.execution_ref, `t:pr:102:rev:${sha.pr102head}`);
});

test('deliveries from other repositories are ignored whole (tenant isolation edge)', () => {
  const res = normalizeWebhookDelivery(
    delivery({ repository: { full_name: 'someone-else/other-repo' } })
  );
  assert.equal(res.delivered.length, 0);
  assert.equal(res.ignored.reason, 'repository_out_of_scope');
});

test('unknown events and malformed payloads never crash the ingestion surface', () => {
  for (const over of [{ event: 'gollum' }, { payload: null }, { action: 'unlabeled' }]) {
    const res = normalizeWebhookDelivery(delivery(over));
    if (!res.delivered.length) assert.ok(res.ignored.reason.length > 0);
  }
});
