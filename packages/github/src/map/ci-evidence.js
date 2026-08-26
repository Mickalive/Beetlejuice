/**
 * Actions workflow-run + check-run -> canonical evidence mapping (WC-002).
 *
 * Correlation strategy (confidence states, never fabricated certainty):
 *   explicit — GitHub itself linked the run to an ingested PR
 *              (workflow_run.pull_requests non-empty);
 *   inferred — head_branch/head-SHA equality matched exactly one ingested PR;
 *   none     — the run is counted as excluded with a precise reason; it is
 *              never silently attached to a wrong task.
 *
 * Equivalence keys are evidence tokens: identical workflow configuration AND
 * identical revision (`wf:<path>@sha:<head_sha>`). Without a head SHA we
 * abstain from claiming equivalence at all.
 */
import { ciRefFor, validationRefForCheckRun, apiRef, eventId } from '../refs.js';
import { githubSource, conformCanonicalEvent } from '../canonical.js';
import { LINK_EXPLICIT, LINK_INFERRED } from '../policy.js';
import { UNKNOWN_COST_REASONS } from '../cost-source.js';
import { COLLECTOR_VERSION, NORMALIZATION_VERSION } from '../versions.js';

const TERMINAL_CONCLUSION_TO_CI = Object.freeze({
  success: 'passed',
  failure: 'failed',
  cancelled: 'cancelled',
  timed_out: 'timed_out',
  startup_failure: 'failed',
});

/** Conclusions that map cleanly onto validation statuses. */
const CHECK_CONCLUSION_TO_STATUS = Object.freeze({
  success: 'passed',
  failure: 'failed',
  skipped: 'skipped',
  neutral: 'skipped',
});

/**
 * Correlate one workflow run against the ingested PR index.
 * @returns {{task?:object, confidence:'explicit'|'inferred', note?:string}} or {noTask:true, reason}
 */
export function correlateWorkflowRun(run, prIndex) {
  const linkedNumbers = Array.isArray(run?.pull_requests)
    ? run.pull_requests.map((l) => Number(l?.number)).filter((n) => Number.isInteger(n))
    : [];
  const explicitTargets = [...new Set(linkedNumbers)].filter((n) => prIndex.byNumber.has(n)).sort((a, b) => a - b);

  if (explicitTargets.length > 0) {
    if (explicitTargets.length > 1) {
      // Deterministic single-target binding; the multi-link is surfaced in stats.
      return { task: prIndex.byNumber.get(explicitTargets[0]), confidence: LINK_EXPLICIT, multiLink: explicitTargets };
    }
    return { task: prIndex.byNumber.get(explicitTargets[0]), confidence: LINK_EXPLICIT };
  }

  // Inferred: branch-name match against ingested PR heads.
  const branch = String(run?.head_branch ?? '');
  const candidates = prIndex.byHeadBranch.get(branch) ?? [];
  if (candidates.length === 1) return { task: candidates[0], confidence: LINK_INFERRED };
  if (candidates.length > 1) {
    const shaMatches = candidates.filter((t) => t.revisionShas.has(String(run?.head_sha ?? '')));
    if (shaMatches.length === 1) return { task: shaMatches[0], confidence: LINK_INFERRED, disambiguatedBySha: true };
    return { noTask: true, reason: 'ambiguous_branch_match' };
  }
  return { noTask: true, reason: 'no_agentic_pr_link' };
}

/**
 * Map one completed workflow run to canonical `ci_run_recorded` records.
 * Returns { records, excluded?: {reason}, pending?:boolean }.
 */
export function mapWorkflowRun({ run, correlation, scope, costSource }) {
  const runId = Number(run?.id);
  const attempt = Number.isInteger(Number(run?.run_attempt)) ? Number(run.run_attempt) : 1;

  if (run?.status !== 'completed') {
    return { records: [], pending: true };
  }
  const status = TERMINAL_CONCLUSION_TO_CI[String(run?.conclusion)];
  if (!status) {
    return { records: [], excluded: { reason: `unmapped_ci_conclusion:${String(run?.conclusion ?? 'unknown')}` } };
  }

  const ciRef = ciRefFor(runId, attempt);
  const headSha = typeof run?.head_sha === 'string' ? run.head_sha : null;
  const equivalenceKey =
    headSha && typeof run?.path === 'string' && run.path.length > 0
      ? `wf:${workflowPathToken(run.path)}@sha:${headSha}`
      : undefined;
  const startedAt = isoOrNull(run?.run_started_at);
  const finishedAt = isoOrNull(run?.updated_at);
  const durationMs = startedAt && finishedAt ? msBetween(startedAt, finishedAt) : undefined;

  const costRes = safeCost(costSource, { kind: 'ci_workflow_run', runId, attempt });
  const cost = costRes.known === true
    ? { known: true, micro_usd: costRes.micro_usd }
    : { known: false, reason: costRes.reason ?? UNKNOWN_COST_REASONS.NO_ACTIONS_USAGE_SUPPLIED };

  // Bind to a specific execution only when the revision is known for that
  // task; otherwise leave unassigned so core keeps the spend visible at task
  // level without inventing a revision binding.
  const target = correlation.task;
  let executionRef;
  let executionBinding = 'task_unassigned';
  if (target && headSha && target.executionRefByRevision.has(headSha)) {
    executionRef = target.executionRefByRevision.get(headSha);
    executionBinding = 'revision';
  }

  const event = conformCanonicalEvent({
    type: 'ci_run_recorded',
    time: startedAt ?? finishedAt,
    task_ref: target.taskRef,
    ...(executionRef !== undefined ? { execution_ref: executionRef } : {}),
    event_id: eventId(scope.key, 'wfrun', `${runId}@a${attempt}`),
    source: githubSource({
      ref: apiRef.workflowRunAttempt(scope.key, runId, attempt),
      meta: {
        collector_version: COLLECTOR_VERSION,
        normalization_version: NORMALIZATION_VERSION,
        link_confidence: correlation.confidence,
        execution_binding: executionBinding,
        ...(correlation.disambiguatedBySha ? { branch_disambiguated_by_sha: true } : {}),
        ...(costRes.known === true ? { cost_provenance: costRes.provenance ?? 'measured' } : {}),
      },
    }),
    payload: {
      ci_ref: ciRef,
      status,
      cost,
      ...(equivalenceKey !== undefined ? { equivalence_key: equivalenceKey } : {}),
      ...(headSha ? { revision_key: headSha } : {}),
      ...(startedAt ? { started_at: startedAt } : {}),
      ...(finishedAt ? { finished_at: finishedAt } : {}),
      ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
    },
  });

  return { records: [wrap(event)] };
}

/**
 * Map terminal check-runs of one revision SHA to `validation_recorded`.
 * Only SHAs belonging to ingested revisions reach this mapper.
 */
export function mapCheckRuns({ sha, checkRuns, prIndex, scope, costSource }) {
  const records = [];
  const excluded = [];
  let pending = 0;

  for (const check of sortBy(checkRuns ?? [], (c) => Number(c?.id))) {
    if (check?.status !== 'completed') {
      pending += 1;
      continue;
    }
    const status = CHECK_CONCLUSION_TO_STATUS[String(check?.conclusion)];
    if (!status) {
      excluded.push({ reason: `unmapped_check_conclusion:${String(check?.conclusion ?? 'unknown')}`, id: check?.id });
      continue;
    }
    const ownerTasks = prIndex.byRevision.get(sha) ?? [];
    if (ownerTasks.length === 0) {
      excluded.push({ reason: 'check_run_revision_unknown_to_ingested_tasks', id: check?.id });
      continue;
    }
    const target = ownerTasks[0]; // deterministic: lowest PR number first
    const checkId = Number(check.id);
    const costRes = safeCost(costSource, { kind: 'check_run', checkRunId: checkId });
    const cost =
      costRes.known === true
        ? { known: true, micro_usd: costRes.micro_usd }
        : { known: false, reason: costRes.reason ?? UNKNOWN_COST_REASONS.CHECK_RUNS_UNBILLED };

    const executionRef = target.executionRefByRevision.get(sha);

    records.push(
      wrap(
        conformCanonicalEvent({
          type: 'validation_recorded',
          time: isoOrNull(check?.completed_at) ?? isoOrNull(check?.started_at),
          task_ref: target.taskRef,
          ...(executionRef !== undefined ? { execution_ref: executionRef } : {}),
          event_id: eventId(scope.key, 'checkrun', String(checkId)),
          source: githubSource({
            ref: apiRef.checkRuns(scope.key, sha),
            meta: {
              collector_version: COLLECTOR_VERSION,
              normalization_version: NORMALIZATION_VERSION,
              link_confidence: LINK_INFERRED,
              execution_binding: executionRef !== undefined ? 'revision' : 'task_unassigned',
              ...(ownerTasks.length > 1 ? { shared_revision_multi_task: ownerTasks.map((t) => t.prNumber) } : {}),
            },
          }),
          payload: {
            validation_ref: validationRefForCheckRun(checkId),
            status,
            cost,
            ...(typeof check?.name === 'string' && check.name.length > 0 ? { validation_class: check.name } : {}),
          },
        })
      )
    );
  }

  return { records, excluded, pending };
}

// --- helpers -----------------------------------------------------------------

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

/** Workflow path token: ".github/workflows/ci.yml@refs/heads/main" -> path part. */
export function workflowPathToken(path) {
  const at = path.indexOf('@');
  return (at >= 0 ? path.slice(0, at) : path).trim();
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
