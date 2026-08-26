/**
 * Incremental webhook -> canonical event normalization (WC-002 P1).
 *
 * Historical audits and live deliveries share ONE correlation/mapping layer
 * (`map/pr-index.js`, `map/ci-evidence.js`), so incremental ingestion can
 * never diverge from the historical reconstruction.
 *
 * Delivery handling is explicit and honest:
 *  - what a delivery alone can prove  -> canonical events immediately;
 *  - what needs repository context    -> ignored with the exact reason (the
 *    bounded sweep fills it in; nothing is guessed);
 *  - unknown event types/actions      -> ignored, never a crash.
 *
 * Event ids match the historical mapper's ids for the same evidence, so an
 * upstream idempotency filter (or the ledger's duplicate guard) makes
 * webhook + sweep re-ingestion safe.
 */
import { repoScope } from '../refs.js';
import { normalizePolicy, LINK_INFERRED } from '../policy.js';
import { unavailableEvidenceCostSource } from '../cost-source.js';
import { githubSource, conformCanonicalEvent } from '../canonical.js';
import { taskRefForPr, prRefFor, apiRef, eventId } from '../refs.js';
import { correlateWorkflowRun, mapWorkflowRun, mapCheckRuns } from '../map/ci-evidence.js';
import { mapWorkflowJobs } from '../map/workflow-jobs.js';

const SUPPORTED_EVENTS = Object.freeze(['pull_request', 'workflow_run', 'check_run', 'workflow_job']);

/**
 * Normalize one VERIFIED delivery (callers must verify the signature first;
 * see verifyWebhookSignature).
 *
 * @param {object} p
 * @param {string} p.event            X-GitHub-Event header value
 * @param {string} p.action           payload.action
 * @param {object} p.payload          parsed JSON body
 * @param {object} p.repoConfig       { owner, repo } this installation listens on
 * @param {object} p.policy           agentic classification policy
 * @param {Function} [p.costSource]   cost resolver (defaults to honest unknowns)
 * @param {object}  [p.prIndex]       current ingested-task index (buildPrIndex);
 *                                  required to normalize CI/check deliveries
 * @returns {{ delivered: Array<{_order:number,event:object}>, ignored?: object }}
 */
export function normalizeWebhookDelivery({ event, action, payload, repoConfig, policy, costSource, prIndex }) {
  const scope = repoScope(repoConfig);
  const pol = normalizePolicy(policy);
  const costs = costSource ?? unavailableEvidenceCostSource();

  if (!SUPPORTED_EVENTS.includes(event)) {
    return { delivered: [], ignored: { reason: `unsupported_event:${event}` } };
  }
  if (typeof payload !== 'object' || payload === null) {
    return { delivered: [], ignored: { reason: 'malformed_payload' } };
  }

  // Installation scoping guard: a delivery for another repository is ignored,
  // never partially processed (tenant isolation at the ingestion edge).
  const deliveredRepo = payload?.repository?.full_name;
  if (
    typeof deliveredRepo === 'string' &&
    deliveredRepo.toLowerCase() !== `${scope.owner}/${scope.repo}`.toLowerCase()
  ) {
    return { delivered: [], ignored: { reason: 'repository_out_of_scope', repository: deliveredRepo } };
  }

  switch (event) {
    case 'pull_request':
      return handlePullRequest({ payload, action, scope, policy: pol });
    case 'workflow_run':
      return handleWorkflowRun({ payload, action, scope, costs, prIndex });
    case 'check_run':
      return handleCheckRun({ payload, action, scope, costs, prIndex });
    case 'workflow_job':
      return handleWorkflowJob({ payload, action, scope, costs, prIndex });
    default:
      return { delivered: [], ignored: { reason: `unsupported_event:${event}` } };
  }
}

// --- pull_request -------------------------------------------------------------

function handlePullRequest({ payload, action, scope, policy }) {
  const pr = payload?.pull_request;
  if (!pr || typeof pr !== 'object') {
    return { delivered: [], ignored: { reason: 'malformed_payload' } };
  }
  const number = Number(payload.number ?? pr.number);
  if (!Number.isInteger(number)) {
    return { delivered: [], ignored: { reason: 'malformed_payload' } };
  }
  const classification = classifyForDelivery(pr, policy);
  const taskRef = taskRefForPr(number);

  switch (action) {
    case 'opened':
    case 'reopened': {
      if (!classification.agentic) return ignoredNotAgentic();
      const createdAt = isoOrNull(pr?.created_at);
      if (!createdAt) return { delivered: [], ignored: { reason: 'delivery_missing_created_at' } };
      const records = [
        signalEvent('task_started', createdAt, taskRef, number, scope, {
          agentic_confidence: classification.confidence,
          agentic_basis: classification.basis,
        }),
        {
          type: 'pull_request_created',
          time: createdAt,
          task_ref: taskRef,
          event_id: eventId(scope.key, 'pr-created', String(number)),
          source: githubSource({
            ref: apiRef.pull(scope.key, number),
            meta: { head_branch: String(pr?.head?.ref ?? '') },
          }),
          payload: { pr_ref: prRefFor(number) },
        },
      ].map((e) => conformCanonicalEvent(e));
      return { delivered: records.map((event, _order) => ({ _order, event })) };
    }
    case 'closed': {
      if (!classification.agentic) return ignoredNotAgentic();
      const mergedAt = isoOrNull(pr?.merged_at);
      const closedAt = isoOrNull(pr?.closed_at) ?? mergedAt;
      if (!closedAt) return { delivered: [], ignored: { reason: 'delivery_missing_closed_at' } };
      const type = mergedAt ? 'pull_request_merged' : 'pull_request_closed';
      const record = conformCanonicalEvent({
        type,
        time: mergedAt ?? closedAt,
        task_ref: taskRef,
        event_id: eventId(scope.key, mergedAt ? 'pr-merged' : 'pr-closed', String(number)),
        source: githubSource({ ref: apiRef.pull(scope.key, number) }),
        payload: { pr_ref: prRefFor(number) },
      });
      return { delivered: [{ _order: 0, event: record }] };
    }
    default:
      // e.g. synchronize/labeled/assigned: revision-level evidence arrives
      // through the commit sweep; a delivery alone cannot prove it.
      return { delivered: [], ignored: { reason: `unsupported_pr_action:${action}` } };
  }
}

// --- workflow_run ---------------------------------------------------------------

function handleWorkflowRun({ payload, action, scope, costs, prIndex }) {
  if (action !== 'completed') {
    return { delivered: [], ignored: { reason: `unsupported_workflow_run_action:${action}` } };
  }
  const run = payload?.workflow_run;
  if (!run || typeof run !== 'object') {
    return { delivered: [], ignored: { reason: 'malformed_payload' } };
  }
  if (!prIndex) {
    return {
      delivered: [],
      ignored: { reason: 'workflow_run_deferred_no_task_index_supplied' },
    };
  }
  const correlation = correlateWorkflowRun(run, prIndex);
  if (correlation.noTask) {
    return { delivered: [], ignored: { reason: correlation.reason } };
  }
  const mapped = mapWorkflowRun({ run, correlation, scope, costSource: costs });
  if (mapped.pending) return { delivered: [], ignored: { reason: 'workflow_run_not_terminal' } };
  if (mapped.excluded) return { delivered: [], ignored: { reason: mapped.excluded.reason } };
  return { delivered: mapped.records.map((r, i) => ({ _order: i, event: r.event })) };
}

// --- check_run ------------------------------------------------------------------

function handleCheckRun({ payload, action, scope, costs, prIndex }) {
  if (action !== 'completed') {
    return { delivered: [], ignored: { reason: `unsupported_check_run_action:${action}` } };
  }
  const check = payload?.check_run;
  if (!check || typeof check !== 'object') {
    return { delivered: [], ignored: { reason: 'malformed_payload' } };
  }
  const sha = payload?.check_run?.head_sha;
  if (typeof sha !== 'string' || sha.length === 0) {
    return { delivered: [], ignored: { reason: 'check_run_missing_head_sha' } };
  }
  if (!prIndex) {
    return { delivered: [], ignored: { reason: 'check_run_deferred_no_task_index_supplied' } };
  }
  const mapped = mapCheckRuns({ sha, checkRuns: [check], prIndex, scope, costSource: costs });
  if (mapped.records.length > 0) {
    return { delivered: mapped.records.map((r, i) => ({ _order: i, event: r.event })) };
  }
  const reason =
    mapped.pending > 0
      ? 'check_run_not_terminal'
      : mapped.excluded[0]?.reason ?? 'check_run_revision_unknown_to_ingested_tasks';
  return { delivered: [], ignored: { reason } };
}

// --- workflow_job ----------------------------------------------------------------

/**
 * A completed `workflow_job` delivery is compute evidence bound by head SHA,
 * exactly like check runs. The SAME mapper as the historical sweep is used
 * with a run-shaped wrapper, and the event id depends only on the globally
 * unique job id — so a delivery and a later sweep produce identical events
 * (idempotent re-ingestion). Non-completed actions are deferred: timing that
 * only exists at completion must not be guessed.
 */
function handleWorkflowJob({ payload, action, scope, costs, prIndex }) {
  if (action !== 'completed') {
    return { delivered: [], ignored: { reason: `unsupported_workflow_job_action:${action}` } };
  }
  const job = payload?.workflow_job;
  if (!job || typeof job !== 'object') {
    return { delivered: [], ignored: { reason: 'malformed_payload' } };
  }
  const sha = typeof job.head_sha === 'string' ? job.head_sha : null;
  if (!sha) {
    return { delivered: [], ignored: { reason: 'workflow_job_missing_head_sha' } };
  }
  const runId = Number(job.run_id);
  if (!Number.isInteger(runId) || runId <= 0) {
    return { delivered: [], ignored: { reason: 'workflow_job_missing_run_id' } };
  }
  if (!prIndex) {
    return { delivered: [], ignored: { reason: 'workflow_job_deferred_no_task_index_supplied' } };
  }
  const owners = prIndex.byRevision.get(sha) ?? [];
  if (owners.length === 0) {
    return { delivered: [], ignored: { reason: 'workflow_job_revision_unknown_to_ingested_tasks' } };
  }
  const task = owners[0]; // deterministic: lowest PR number first (check-run convention)
  const attempt = Number(job.run_attempt);
  const runWrapper = {
    id: runId,
    run_attempt: Number.isInteger(attempt) && attempt > 0 ? attempt : 1,
    head_sha: sha,
  };
  const mapped = mapWorkflowJobs({
    run: runWrapper,
    jobs: [job],
    task,
    scope,
    costSource: costs,
    linkConfidence: LINK_INFERRED,
  });
  if (mapped.records.length > 0) {
    return { delivered: mapped.records.map((r, i) => ({ _order: i, event: r.event })) };
  }
  const reason =
    mapped.pending > 0
      ? 'workflow_job_not_terminal'
      : mapped.excluded[0]?.reason ?? 'workflow_job_not_mappable';
  return { delivered: [], ignored: { reason } };
}

// --- helpers ----------------------------------------------------------------------

function signalEvent(type, time, taskRef, number, scope, extraMeta) {
  return {
    type,
    time,
    task_ref: taskRef,
    event_id: eventId(scope.key, type === 'task_started' ? 'task-started' : type, `pr${number}`),
    source: githubSource({ ref: apiRef.pull(scope.key, number), meta: extraMeta }),
    payload: {},
  };
}

function classifyForDelivery(pr, policy) {
  const login = String(pr?.user?.login ?? '').toLowerCase();
  if (login && policy.actorLogins.has(login)) {
    return { agentic: true, confidence: 'measured', basis: 'bot_actor_allowlist' };
  }
  const headRef = String(pr?.head?.ref ?? '');
  const prefix = policy.branchPrefixes.find((p) => headRef.startsWith(p));
  if (prefix !== undefined && prefix.length > 0) {
    return { agentic: true, confidence: 'inferred', basis: `branch_prefix_match:${prefix}` };
  }
  return { agentic: false, confidence: null, basis: 'not_matched_by_policy' };
}

function ignoredNotAgentic() {
  return { delivered: [], ignored: { reason: 'pr_not_agentic_under_policy' } };
}

function isoOrNull(v) {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
