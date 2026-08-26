/**
 * Shared PR-task index used by BOTH the historical assembler and the webhook
 * normalizer (WC-002: one mapping layer, no divergent incremental logic).
 *
 * An index answers three correlation questions deterministically:
 *   - byNumber:     explicit GitHub links (workflow_run.pull_requests);
 *   - byHeadBranch: inferred links (branch-name equality);
 *   - byRevision:   SHA-bound evidence attachment (CI/check runs).
 * Multi-entry lists are kept sorted by PR number so every consumer binds
 * evidence identically.
 */
import { mapPullRequestTask } from './pr-tasks.js';

/** Build one task entry (+ canonical records) for an agentic PR. */
export function entryForPullRequest({ pr, classification, commits, scope }) {
  const { records, taskRef, revisions } = mapPullRequestTask({ pr, classification, commits, scope });
  return {
    records,
    entry: {
      prNumber: Number(pr.number),
      taskRef,
      headBranch: String(pr?.head?.ref ?? ''),
      confidence: classification.confidence,
      basis: classification.basis,
      revisionShas: new Set(revisions.map((r) => r.sha)),
      executionRefByRevision: new Map(revisions.map((r) => [r.sha, r.executionRef])),
    },
  };
}

/** Index entries for correlation. Lists are deterministic (PR number asc). */
export function buildPrIndex(entries) {
  const prIndex = { byNumber: new Map(), byHeadBranch: new Map(), byRevision: new Map() };
  const sorted = [...entries].sort((a, b) => a.prNumber - b.prNumber);
  for (const entry of sorted) {
    prIndex.byNumber.set(entry.prNumber, entry);
    pushMulti(prIndex.byHeadBranch, entry.headBranch, entry);
    for (const sha of entry.revisionShas) pushMulti(prIndex.byRevision, sha, entry);
  }
  return prIndex;
}

function pushMulti(map, key, value) {
  const arr = map.get(key) ?? [];
  arr.push(value);
  map.set(key, arr);
}
