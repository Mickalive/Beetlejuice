/**
 * Actions workflow-JOB -> canonical compute evidence mapping (WC-002 build
 * item "workflow runs/jobs/checks").
 *
 * Jobs are the unit GitHub actually bills Actions on (per job-minute), and
 * they are directly observable through read-only APIs — so terminal jobs of
 * runs correlated to ingested agentic tasks become `compute_usage_recorded`
 * events. This closes a real economics gap: run-level usage records are
 * operator-supplied exports, while job wall-clock time is collected evidence.
 *
 * Conventions shared with map/ci-evidence.js (one mapping layer):
 *   - revision binding only when the run's head SHA is a known revision of
 *     the correlated task; otherwise the event stays task-level
 *     (`execution_binding: 'task_unassigned'`) — never an invented binding;
 *   - money resolves ONLY through the configured cost source; the default
 *     source answers with a precise per-kind unknown reason;
 *   - non-terminal jobs are counted as pending, malformed ids excluded with
 *     reasons; nothing crashes, nothing is force-attached.
 *
 * Compute was consumed even when a job failed or was cancelled, so job
 * conclusion does NOT gate emission (the canonical compute payload carries no
 * status field by design). Event ids use the globally-unique job id alone,
 * which makes sweep + webhook ingestion idempotent for identical evidence.
 */
import { computeRefForWorkflowJob, apiRef, eventId } from '../refs.js';
import { githubSource, conformCanonicalEvent } from '../canonical.js';
import { COLLECTOR_VERSION, NORMALIZATION_VERSION } from '../versions.js';

export const WORKFLOW_JOB_RESOURCE_CLASS = 'github_actions_runner';

/** Attempt part of the evidence key convention ("runId@a<attempt>"). */
export function workflowRunAttemptKey(run) {
  const attempt = Number(run?.run_attempt);
  return `${Number(run?.id)}@a${Number.isInteger(attempt) && attempt > 0 ? attempt : 1}`;
}

/**
 * Map the terminal jobs of one correlated workflow run to canonical
 * `compute_usage_recorded` records.
 *
 * @param {object} p
 * @param {object} p.run            workflow-run snapshot (id/run_attempt/head_sha)
 * @param {Array}  p.jobs           job snapshots from the jobs endpoint/delivery
 * @param {object} p.task           pr-index entry of the correlated task
 * @param {object} p.scope          repoScope() output
 * @param {Function} p.costSource   cost resolver (see cost-source.js)
 * @param {string} [p.linkConfidence] correlation confidence carried into meta
 * @returns {{ records: Array<{event}>, excluded: Array<{reason,id}>, pending: number }}
 */
export function mapWorkflowJobs({ run, jobs, task, scope, costSource, linkConfidence }) {
  const records = [];
  const excluded = [];
  let pending = 0;

  const headSha = typeof run?.head_sha === 'string' ? run.head_sha : null;
  const executionRef = headSha && task.executionRefByRevision.has(headSha)
    ? task.executionRefByRevision.get(headSha)
    : undefined;

  for (const job of sortBy([...(jobs ?? [])], (j) => Number(j?.id))) {
    const jobId = Number(job?.id);
    if (!Number.isInteger(jobId)) {
      excluded.push({ reason: 'malformed_job_id', id: job?.id ?? null });
      continue;
    }
    if (job?.status !== 'completed') {
      pending += 1;
      continue;
    }

    const startedAt = isoOrNull(job?.started_at);
    const finishedAt = isoOrNull(job?.completed_at);
    const elapsedMs = startedAt && finishedAt ? msBetween(startedAt, finishedAt) : undefined;

    const costRes = safeCost(costSource, {
      kind: 'ci_workflow_job',
      runId: Number(run?.id),
      attempt: attemptOf(run),
      jobId,
      labels: Array.isArray(job?.labels) ? job.labels.filter((l) => typeof l === 'string') : [],
      elapsedMs,
    });
    const cost =
      costRes.known === true
        ? { known: true, micro_usd: costRes.micro_usd }
        : { known: false, reason: costRes.reason ?? 'actions job cost unavailable' };

    records.push(
      wrap(
        conformCanonicalEvent({
          type: 'compute_usage_recorded',
          time: startedAt ?? finishedAt,
          task_ref: task.taskRef,
          ...(executionRef !== undefined ? { execution_ref: executionRef } : {}),
          event_id: eventId(scope.key, 'wfjob', String(jobId)),
          source: githubSource({
            ref: apiRef.workflowRunJobs(scope.key, Number(run?.id)),
            meta: {
              collector_version: COLLECTOR_VERSION,
              normalization_version: NORMALIZATION_VERSION,
              ...(linkConfidence !== undefined ? { link_confidence: linkConfidence } : {}),
              execution_binding: executionRef !== undefined ? 'revision' : 'task_unassigned',
            },
          }),
          payload: {
            resource_ref: computeRefForWorkflowJob(jobId),
            cost,
            resource_class: WORKFLOW_JOB_RESOURCE_CLASS,
          },
        })
      )
    );
  }

  return { records, excluded, pending };
}

// --- helpers (kept in step with map/ci-evidence.js) ----------------------------

export function attemptOf(run) {
  const attempt = Number(run?.run_attempt);
  return Number.isInteger(attempt) && attempt > 0 ? attempt : 1;
}

function wrap(event) {
  return { _order: null, event }; // order assigned by audit assembler
}

function safeCost(costSource, req) {
  try {
    const res = costSource(req);
    return res && typeof res === 'object' ? res : { known: false, reason: 'cost source returned no result' };
  } catch (err) {
    return { known: false, reason: `cost source error: ${err?.message ?? 'unknown'}` };
  }
}

function isoOrNull(v) {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function msBetween(aIso, bIso) {
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return undefined;
  return Math.round(b - a);
}

function sortBy(arr, keyFn) {
  return [...arr].sort((x, y) => keyFn(x) - keyFn(y));
}
