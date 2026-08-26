/**
 * Deterministic synthetic-GitHub fixtures for adapter tests.
 *
 * SECURITY NOTE: these fixtures contain NO credential-shaped literals. Any
 * sensitive-looking value used in tests (webhook secrets, tokens) is composed
 * at runtime from harmless word fragments — see test/helpers.js.
 */

export const OWNER = 'acme-factory';
export const REPO = 'line-controller';
export const SCOPE_KEY = `${OWNER}/${REPO}`;

/** Bot actor configured in the operator allowlist (fictional). */
export const BOT_ACTOR = 'forge-bot[bot]';
/** Human actor whose PR must be excluded under the default fixture policy. */
export const HUMAN_ACTOR = 'mira-dev';

/** Deterministic 40-char hex-shaped revision tokens (harmless fragments). */
export const sha = {
  pr101r1: hex('a0', '11'),
  pr101r2: hex('b0', '22'),
  pr101r3: hex('c0', '33'),
  pr102head: hex('d0', '44'),
  pr103head: hex('e0', '55'),
  unrelated: hex('f0', '66'),
};

function hex(prefix, fill) {
  return (prefix + fill).repeat(20).slice(0, 40);
}

export const fixturePolicy = Object.freeze({
  botActors: Object.freeze([BOT_ACTOR]),
  branchPrefixes: Object.freeze(['forge/']),
});

// --- PR builders ---------------------------------------------------------------

export function prJson({ number, state, createdAt, closedAt = null, mergedAt = null, login, headBranch, headSha }) {
  return {
    number,
    state,
    title: `synthetic change ${number}`,
    created_at: createdAt,
    closed_at: closedAt,
    merged_at: mergedAt,
    user: { login },
    head: { ref: headBranch, sha: headSha },
    base: { ref: 'main' },
  };
}

export function commitJson(shaValue, committerDate, authorDate = committerDate) {
  return {
    sha: shaValue,
    commit: {
      committer: { date: committerDate },
      author: { date: authorDate },
      message: 'synthetic revision',
    },
    parents: [],
  };
}

// --- The canonical fixture scenario --------------------------------------------

/**
 * PR #101: agentic (measured), 3 revisions, MERGED.
 * PR #102: agentic (inferred only — human actor, forge/ prefix), 1 revision,
 *          CLOSED WITHOUT MERGE.
 * PR #103: agentic (measured), 1 revision, OPEN (unresolved outcome).
 * PR #110: NOT agentic -> excluded.
 */
export function fixturePullRequests() {
  return [
    prJson({
      number: 101,
      state: 'closed',
      createdAt: '2026-07-01T09:00:00Z',
      closedAt: '2026-07-04T08:15:00Z',
      mergedAt: '2026-07-04T08:15:00Z',
      login: BOT_ACTOR,
      headBranch: 'forge/valve-logic',
      headSha: sha.pr101r3,
    }),
    prJson({
      number: 102,
      state: 'closed',
      createdAt: '2026-07-05T10:00:00Z',
      closedAt: '2026-07-06T12:00:00Z',
      mergedAt: null,
      login: HUMAN_ACTOR,
      headBranch: 'forge/gauge-cleanup',
      headSha: sha.pr102head,
    }),
    prJson({
      number: 103,
      state: 'open',
      createdAt: '2026-07-07T08:00:00Z',
      login: BOT_ACTOR,
      headBranch: 'forge/alarm-hush',
      headSha: sha.pr103head,
    }),
    prJson({
      number: 110,
      state: 'closed',
      createdAt: '2026-07-08T08:00:00Z',
      closedAt: '2026-07-08T09:00:00Z',
      login: HUMAN_ACTOR,
      headBranch: 'feature/manual-tuning',
      headSha: sha.unrelated,
    }),
  ];
}

export function fixtureCommitsByPull() {
  return new Map([
    [
      101,
      [
        commitJson(sha.pr101r1, '2026-07-01T09:05:00Z'),
        commitJson(sha.pr101r2, '2026-07-02T10:00:00Z'),
        commitJson(sha.pr101r3, '2026-07-03T11:30:00Z'),
      ],
    ],
    [102, [commitJson(sha.pr102head, '2026-07-05T10:05:00Z')]],
    [103, [commitJson(sha.pr103head, '2026-07-07T08:05:00Z')]],
  ]);
}

// --- Workflow runs ---------------------------------------------------------------

export function runJson({
  id,
  attempt = 1,
  status = 'completed',
  conclusion = 'success',
  headBranch,
  headSha,
  startedAt,
  updatedAt,
  path = '.github/workflows/ci.yml@refs/heads/main',
  pullRequests = [],
}) {
  return {
    id,
    run_attempt: attempt,
    status,
    conclusion,
    head_branch: headBranch,
    head_sha: headSha,
    run_started_at: startedAt,
    updated_at: updatedAt,
    path,
    name: 'ci',
    pull_requests: pullRequests,
  };
}

export function fixtureWorkflowRuns() {
  return [
    // Attempt 1 on revision r2, explicitly linked to PR #101. Passed.
    runJson({
      id: 9001,
      attempt: 1,
      conclusion: 'success',
      headBranch: 'forge/valve-logic',
      headSha: sha.pr101r2,
      startedAt: '2026-07-02T10:10:00Z',
      updatedAt: '2026-07-02T10:25:00Z',
      pullRequests: [{ number: 101 }],
    }),
    // Re-run of the SAME run on IDENTICAL inputs after attempt 1 passed —
    // the canonical duplicated-CI certain-waste shape (rule decides).
    runJson({
      id: 9001,
      attempt: 2,
      conclusion: 'success',
      headBranch: 'forge/valve-logic',
      headSha: sha.pr101r2,
      startedAt: '2026-07-02T11:00:00Z',
      updatedAt: '2026-07-02T11:14:00Z',
      pullRequests: [{ number: 101 }],
    }),
    // Explicit link points at an UNINGESTED PR; branch matches #101 ->
    // correlation degrades honestly to 'inferred'.
    runJson({
      id: 9002,
      headBranch: 'forge/valve-logic',
      headSha: sha.pr101r3,
      startedAt: '2026-07-03T11:40:00Z',
      updatedAt: '2026-07-03T11:55:00Z',
      pullRequests: [{ number: 999 }],
    }),
    // No link at all, foreign branch -> excluded.
    runJson({
      id: 9003,
      headBranch: 'feature/manual-tuning',
      headSha: sha.unrelated,
      startedAt: '2026-07-08T08:10:00Z',
      updatedAt: '2026-07-08T08:30:00Z',
      pullRequests: [],
    }),
    // Still running -> pending, not emitted.
    runJson({
      id: 9004,
      status: 'in_progress',
      conclusion: null,
      headBranch: 'forge/alarm-hush',
      headSha: sha.pr103head,
      startedAt: '2026-07-07T08:10:00Z',
      updatedAt: '2026-07-07T08:12:00Z',
      pullRequests: [],
    }),
    // Terminal but unmapped conclusion -> excluded with reason.
    runJson({
      id: 9005,
      conclusion: 'neutral',
      headBranch: 'forge/gauge-cleanup',
      headSha: sha.pr102head,
      startedAt: '2026-07-05T10:10:00Z',
      updatedAt: '2026-07-05T10:12:00Z',
      pullRequests: [],
    }),
  ];
}

// --- Check runs --------------------------------------------------------------------

export function checkRunJson({ id, name, status = 'completed', conclusion = 'success', headSha, completedAt, startedAt }) {
  return {
    id,
    name,
    status,
    conclusion,
    head_sha: headSha,
    started_at: startedAt ?? completedAt,
    completed_at: completedAt,
    app: { slug: 'synthetic-ci' },
  };
}

/** Keyed by revision SHA, exactly like collectHistory() returns. */
export function fixtureCheckRunsBySha() {
  return new Map([
    [
      sha.pr101r2,
      [
        checkRunJson({ id: 7001, name: 'unit-tests', conclusion: 'success', headSha: sha.pr101r2, completedAt: '2026-07-02T10:24:00Z' }),
        checkRunJson({ id: 7002, name: 'lint', conclusion: 'failure', headSha: sha.pr101r2, completedAt: '2026-07-02T10:23:00Z' }),
      ],
    ],
    [
      sha.pr101r3,
      [checkRunJson({ id: 7003, name: 'e2e-smoke', conclusion: 'success', headSha: sha.pr101r3, completedAt: '2026-07-03T11:54:00Z' })],
    ],
    // Revision unknown to any ingested task -> excluded with reason.
    [
      sha.unrelated,
      [checkRunJson({ id: 7004, name: 'manual-check', conclusion: 'success', headSha: sha.unrelated, completedAt: '2026-07-08T08:29:00Z' })],
    ],
  ]);
}

/** Operator-supplied Actions usage + contractual rate (fixture economics). */
export function fixtureUsageRecords() {
  return new Map([
    ['9001@a1', { billable_ms: 900_000 }],
    ['9001@a2', { billable_ms: 840_000 }],
  ]);
}

export const FIXTURE_RATE_USD_PER_MINUTE = 0.008;

/**
 * Assemble the full evidence object exactly as collectHistory() would
 * return it (minus transport metadata), for pure assembler tests.
 */
export function fixtureEvidence() {
  return {
    scope: { owner: OWNER, repo: REPO, key: SCOPE_KEY },
    policy: fixturePolicy,
    prs: fixturePullRequests(),
    prClassifications: new Map(),
    commitsByPull: fixtureCommitsByPull(),
    workflowRuns: fixtureWorkflowRuns(),
    checkRunsBySha: fixtureCheckRunsBySha(),
  };
}
