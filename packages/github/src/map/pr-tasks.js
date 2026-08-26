/**
 * PR-lifecycle -> canonical AGENTIC_TASK mapping (WC-002 normalized mapping).
 *
 * One ingested pull request becomes ONE vendor-neutral task:
 *   task_started -> pull_request_created
 *     -> one execution per observed head revision (distinct SHA), ordered by
 *        commit time; each replaced revision finishes `superseded` pointing
 *        at its strictly-later replacement;
 *   final revision finishes `completed` (merged) / `aborted` (closed w/o
 *   merge); an open PR simply stays running — unresolved outcomes are
 *   reported honestly, never guessed.
 *
 * All raw GitHub coordinates live inside tenant/source-scoped refs and
 * source provenance only.
 *
 * Internal event records are `{ _order, event }` pairs: `_order` encodes
 * evidence sequence for deterministic total ordering and is stripped before
 * delivery (see audit.js).
 */
import { taskRefForPr, prRefFor, executionRefForRevision, apiRef, eventId } from '../refs.js';
import { githubSource, conformCanonicalEvent } from '../canonical.js';
import { COLLECTOR_VERSION, NORMALIZATION_VERSION } from '../versions.js';

/**
 * Map one agentic PR + its commits into canonical events.
 *
 * @param {object} p
 * @param {object} p.pr              GitHub pull-request JSON (list shape)
 * @param {object} p.classification  result of classifyPullRequest()
 * @param {Array}  p.commits         GitHub PR-commit JSON array (may be empty)
 * @param {object} p.scope           repoScope() result
 * @returns {{ records: Array<{_order:number, event:object}>, taskRef, revisions }}
 */
export function mapPullRequestTask({ pr, classification, commits, scope }) {
  const number = requireInt(pr?.number, 'pr.number');
  const taskRef = taskRefForPr(number);
  const prRef = prRefFor(number);
  const scopeKey = scope.key;

  let order = 0;
  const records = [];
  const add = (e) => {
    records.push({ _order: order++, event: conformCanonicalEvent(e) });
  };

  const createdAt = isoOrNull(pr?.created_at);
  const closedAt = isoOrNull(pr?.closed_at);
  const mergedAt = isoOrNull(pr?.merged_at);
  const headSha = shortSha(pr?.head?.sha);

  // Task + delivery signals ----------------------------------------------------
  if (createdAt) {
    add({
      type: 'task_started',
      time: createdAt,
      task_ref: taskRef,
      event_id: eventId(scopeKey, 'task-started', `pr${number}`),
      source: githubSource({
        ref: apiRef.pull(scopeKey, number),
        meta: {
          collector_version: COLLECTOR_VERSION,
          normalization_version: NORMALIZATION_VERSION,
          agentic_confidence: classification.confidence,
          agentic_basis: classification.basis,
        },
      }),
      payload: {},
    });
    add({
      type: 'pull_request_created',
      time: createdAt,
      task_ref: taskRef,
      event_id: eventId(scopeKey, 'pr-created', String(number)),
      source: githubSource({
        ref: apiRef.pull(scopeKey, number),
        meta: { collector_version: COLLECTOR_VERSION, normalization_version: NORMALIZATION_VERSION, head_branch: String(pr?.head?.ref ?? '') },
      }),
      payload: { pr_ref: prRef },
    });
  }

  // Executions: one per observed head revision ---------------------------------
  const orderedCommits = orderCommits(commits);
  const revisions = orderedCommits.map((c, i) => ({
    sha: String(c.sha),
    executionRef: executionRefForRevision(taskRef, c.sha),
    committedAt: isoOrNull(c?.commit?.committer?.date) ?? isoOrNull(c?.commit?.author?.date),
  }));

  revisions.forEach((rev, i) => {
    add({
      type: 'execution_started',
      time: rev.committedAt,
      task_ref: taskRef,
      event_id: eventId(scopeKey, 'exec-start', `pr${number}`, `${i}:${rev.sha}`),
      source: githubSource({
        ref: apiRef.commits(scopeKey, number),
        meta: { collector_version: COLLECTOR_VERSION, normalization_version: NORMALIZATION_VERSION, revision_source: 'pull_commits' },
      }),
      payload: { execution_ref: rev.executionRef, revision_key: rev.sha },
    });

    const next = revisions[i + 1];
    if (next) {
      add({
        type: 'execution_finished',
        time: next.committedAt,
        task_ref: taskRef,
        event_id: eventId(scopeKey, 'exec-finish', `pr${number}`, `${i}:${rev.sha}`),
        source: githubSource({
          ref: apiRef.commits(scopeKey, number),
          meta: { collector_version: COLLECTOR_VERSION, normalization_version: NORMALIZATION_VERSION, superseded_by_revision: next.sha },
        }),
        payload: {
          execution_ref: rev.executionRef,
          status: 'superseded',
          superseded_by_execution_ref: next.executionRef,
        },
      });
      return;
    }

    // Final revision: terminal status only when the task itself terminated.
    if (mergedAt || pr?.state === 'closed') {
      const status = mergedAt ? 'completed' : 'aborted';
      add({
        type: 'execution_finished',
        time: mergedAt ?? closedAt,
        task_ref: taskRef,
        event_id: eventId(scopeKey, 'exec-finish', `pr${number}`, `${i}:${rev.sha}`),
        source: githubSource({
          ref: apiRef.pull(scopeKey, number),
          meta: {
            collector_version: COLLECTOR_VERSION,
            normalization_version: NORMALIZATION_VERSION,
            ...(headSha ? { head_sha: headSha } : {}),
            terminal_basis: status === 'completed' ? 'pull_request_merged' : 'pull_request_closed_unmerged',
          },
        }),
        payload: { execution_ref: rev.executionRef, status },
      });
    }
    // Open PRs intentionally emit no execution_finished (still running).
  });

  // Terminal delivery signals ---------------------------------------------------
  if (closedAt && !mergedAt) {
    add({
      type: 'pull_request_closed',
      time: closedAt,
      task_ref: taskRef,
      event_id: eventId(scopeKey, 'pr-closed', String(number)),
      source: githubSource({ ref: apiRef.pull(scopeKey, number), meta: { collector_version: COLLECTOR_VERSION, normalization_version: NORMALIZATION_VERSION } }),
      payload: { pr_ref: prRef },
    });
  }
  if (mergedAt) {
    add({
      type: 'pull_request_merged',
      time: mergedAt,
      task_ref: taskRef,
      event_id: eventId(scopeKey, 'pr-merged', String(number)),
      source: githubSource({ ref: apiRef.pull(scopeKey, number), meta: { collector_version: COLLECTOR_VERSION, normalization_version: NORMALIZATION_VERSION } }),
      payload: { pr_ref: prRef },
    });
  }

  return { records, taskRef, revisions };
}

/** Sort commits chronologically, keeping GitHub's evidence order for ties. */
function orderCommits(commits) {
  if (!Array.isArray(commits)) return [];
  return commits
    .map((c, index) => ({ c, index }))
    .sort((a, b) => {
      const ta = ts(a.c);
      const tb = ts(b.c);
      if (ta !== tb) return ta < tb ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ c }) => c);

  function ts(c) {
    return c?.commit?.committer?.date ?? c?.commit?.author?.date ?? '';
  }
}

function requireInt(v, field) {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new TypeError(`${field} must be an integer`);
  return n;
}

function isoOrNull(v) {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function shortSha(sha) {
  return typeof sha === 'string' && sha.length > 0 ? sha.slice(0, 12) : undefined;
}
