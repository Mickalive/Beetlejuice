/**
 * Audit assembly: raw collected evidence -> canonical event stream + honest
 * statistics (WC-002). Pure and synchronous: the same evidence always yields
 * byte-identical output, which makes re-ingestion reproducible and testable
 * without any external account.
 *
 * The adapter NEVER fabricates certainty:
 *  - uncorrelatable CI/check evidence is counted as excluded with a reason;
 *  - model/tool invocation spend is not observable via read-only GitHub and
 *    therefore simply never appears;
 *  - costs resolve through the configured cost source (measured where the
 *    operator supplied usage, explicitly unknown otherwise).
 */
import { normalizePolicy, classifyPullRequest } from '../policy.js';
import { unavailableEvidenceCostSource } from '../cost-source.js';
import { entryForPullRequest, buildPrIndex } from './pr-index.js';
import { correlateWorkflowRun, mapWorkflowRun, mapCheckRuns } from './ci-evidence.js';
import { mapWorkflowJobs, workflowRunAttemptKey } from './workflow-jobs.js';

const TYPE_RANK = Object.freeze({
  task_started: 0,
  pull_request_created: 1,
  execution_started: 2,
  ci_run_recorded: 3,
  compute_usage_recorded: 35,
  validation_recorded: 4,
  pull_request_closed: 5,
  pull_request_merged: 6,
  execution_finished: 7,
});

/**
 * Assemble the canonical audit from collected evidence.
 *
 * @param {object} evidence  collectHistory() output or an equivalent fixture:
 *        { scope, policy?, prs, commitsByPull(Map|obj), workflowRuns,
 *          checkRunsBySha(Map|obj), collection? }
 * @param {object} [opts]    { policy?, costSource? } overrides
 * @returns {{ events: Array, stats: object }}
 */
export function assembleAudit(evidence, opts = {}) {
  const scope = evidence.scope;
  const policy = normalizePolicy(opts.policy ?? evidence.policy ?? {});
  const costSource = opts.costSource ?? unavailableEvidenceCostSource();
  const jobsByRunAttempt =
    evidence.workflowJobsByRunAttempt instanceof Map
      ? evidence.workflowJobsByRunAttempt
      : objToEntries(evidence.workflowJobsByRunAttempt);

  const prIndex = { byNumber: new Map(), byHeadBranch: new Map(), byRevision: new Map() };
  const records = [];
  const counts = initCounts();
  const entries = [];

  // --- Tasks from agentic pull requests -------------------------------------
  const pullsSorted = [...(evidence.prs ?? [])].sort((a, b) => Number(a.number) - Number(b.number));
  for (const pr of pullsSorted) {
    counts.pulls_seen += 1;
    const cls =
      (evidence.prClassifications instanceof Map ? evidence.prClassifications.get(pr.number) : undefined) ??
      classifyPullRequest(pr, policy);
    if (!cls.agentic) {
      counts.pulls_excluded_non_agentic += 1;
      continue;
    }
    if (cls.confidence === 'measured') counts.pulls_ingested_measured += 1;
    else counts.pulls_ingested_inferred += 1;

    const commits = mapGet(evidence.commitsByPull, pr.number) ?? [];
    const { records: taskRecords, entry } = entryForPullRequest({ pr, classification: cls, commits, scope });
    records.push(...taskRecords);
    entries.push(entry);
    counts.revisions_observed += entry.revisionShas.size;
  }
  const index = buildPrIndex(entries);
  prIndex.byNumber = index.byNumber;
  prIndex.byHeadBranch = index.byHeadBranch;
  prIndex.byRevision = index.byRevision;

  // --- CI workflow runs -------------------------------------------------------
  const runsSorted = [...(evidence.workflowRuns ?? [])].sort(
    (a, b) => Number(a?.id) - Number(b?.id) || Number(a?.run_attempt ?? 1) - Number(b?.run_attempt ?? 1)
  );
  for (const run of runsSorted) {
    counts.workflow_runs_seen += 1;
    const correlation = correlateWorkflowRun(run, prIndex);
    if (correlation.noTask) {
      bump(counts.workflow_runs_excluded_by_reason, correlation.reason);
      continue;
    }
    if (correlation.multiLink) counts.workflow_runs_multi_link_resolved += 1;

    // Jobs of a CORRELATED run are compute evidence in their own right: they
    // carry money even when the run-level CI record is pending or its
    // conclusion is unmapped, because compute was consumed regardless.
    // Gating on correlation alone (not run mapping) is deliberate and keeps
    // the collector's data-minimized fetch decision identical to emission.
    const jobs = jobsByRunAttempt.get(workflowRunAttemptKey(run));
    if (jobs !== undefined) {
      counts.workflow_jobs_seen += Array.isArray(jobs) ? jobs.length : 0;
      const jmapped = mapWorkflowJobs({
        run,
        jobs,
        task: correlation.task,
        scope,
        costSource,
        linkConfidence: correlation.confidence,
      });
      records.push(...jmapped.records);
      counts.workflow_jobs_emitted += jmapped.records.length;
      counts.workflow_jobs_pending_not_terminal += jmapped.pending;
      for (const ex of jmapped.excluded) bump(counts.workflow_jobs_excluded_by_reason, ex.reason);
      for (const { event } of jmapped.records) {
        if (event.payload?.cost?.known === true) counts.workflow_jobs_cost_known += 1;
        else counts.workflow_jobs_cost_unknown += 1;
      }
    }

    const mapped = mapWorkflowRun({ run, correlation, scope, costSource });
    if (mapped.pending) {
      counts.workflow_runs_pending_not_terminal += 1;
      continue;
    }
    if (mapped.excluded) {
      bump(counts.workflow_runs_excluded_by_reason, mapped.excluded.reason);
      continue;
    }
    // Confidence counters track EVIDENCE ACTUALLY EMITTED, so pending or
    // unmapped deliveries cannot inflate the linkage statistics.
    if (correlation.confidence === 'explicit') counts.workflow_runs_linked_explicit += 1;
    else counts.workflow_runs_linked_inferred += 1;
    records.push(...mapped.records);
    counts.workflow_runs_emitted += mapped.records.length;
  }

  // --- Check runs per known revision ------------------------------------------
  const checkMap = evidence.checkRunsBySha instanceof Map ? evidence.checkRunsBySha : objToEntries(evidence.checkRunsBySha);
  const shasSorted = [...checkMap.keys()].sort();
  for (const sha of shasSorted) {
    const mapped = mapCheckRuns({ sha, checkRuns: checkMap.get(sha), prIndex, scope, costSource });
    records.push(...mapped.records);
    counts.check_runs_emitted += mapped.records.length;
    counts.check_runs_pending_not_terminal += mapped.pending;
    for (const ex of mapped.excluded) bump(counts.check_runs_excluded_by_reason, ex.reason);
  }
  for (const v of checkMap.values()) counts.check_runs_seen += Array.isArray(v) ? v.length : 0;

  // --- Deterministic total order ----------------------------------------------
  const ordered = [...records].sort(compareRecords).map(({ event }) => event);

  const costs = summarizeCosts(ordered);
  const stats = {
    scope: scope.key,
    counts,
    costs,
    notes: buildNotes(evidence),
  };

  return { events: Object.freeze(ordered), stats: deepFreezeStats(stats) };
}

function compareRecords(a, b) {
  const ta = a.event.time ?? '';
  const tb = b.event.time ?? '';
  if (ta !== tb) return ta < tb ? -1 : 1;
  const ra = TYPE_RANK[a.event.type] ?? 50;
  const rb = TYPE_RANK[b.event.type] ?? 50;
  if (ra !== rb) return ra - rb;
  const oa = a._order ?? Number.MAX_SAFE_INTEGER;
  const ob = b._order ?? Number.MAX_SAFE_INTEGER;
  if (oa !== ob) return oa - ob;
  return String(a.event.event_id).localeCompare(String(b.event.event_id));
}

/** Fallback classification when the collector phase was skipped (fixtures). */
function classifyFallback(pr, policy) {
  return classifyPullRequest(pr, policy);
}

function initCounts() {
  return {
    pulls_seen: 0,
    pulls_ingested_measured: 0,
    pulls_ingested_inferred: 0,
    pulls_excluded_non_agentic: 0,
    revisions_observed: 0,
    workflow_runs_seen: 0,
    workflow_runs_emitted: 0,
    workflow_runs_pending_not_terminal: 0,
    workflow_runs_multi_link_resolved: 0,
    workflow_runs_linked_explicit: 0,
    workflow_runs_linked_inferred: 0,
    workflow_runs_excluded_by_reason: {},
    workflow_jobs_seen: 0,
    workflow_jobs_emitted: 0,
    workflow_jobs_pending_not_terminal: 0,
    workflow_jobs_cost_known: 0,
    workflow_jobs_cost_unknown: 0,
    workflow_jobs_excluded_by_reason: {},
    check_runs_seen: 0,
    check_runs_emitted: 0,
    check_runs_pending_not_terminal: 0,
    check_runs_excluded_by_reason: {},
  };
}

function summarizeCosts(events) {
  let knownMicroUsd = 0;
  let unknownComponents = 0;
  const unknownByReason = {};
  for (const ev of events) {
    const cost = ev.payload?.cost;
    if (!cost) continue;
    if (cost.known === true) knownMicroUsd += cost.micro_usd;
    else {
      unknownComponents += 1;
      bump(unknownByReason, cost.reason ?? 'unspecified');
    }
  }
  return { known_micro_usd_total: knownMicroUsd, unknown_components_total: unknownComponents, unknown_by_reason: unknownByReason };
}

const FIXED_NOTES = Object.freeze([
  'model/tool invocation spend is not observable through read-only GitHub evidence; it is never estimated here',
  'CI cost is measured only when the operator supplies Actions usage records plus an explicit rate; otherwise unknown with reason',
  'Actions job (compute) money is measured only when job timing was collected AND an explicit rate was configured; attempts covered by a run-level usage record resolve to unknown instead of double-counting',
]);

function buildNotes(evidence) {
  const notes = [...FIXED_NOTES];
  const trunc = evidence.collection?.truncated;
  if (trunc?.pullRequests) notes.push('pull-request listing hit maxPrPages; results are a bounded sweep');
  if (trunc?.workflowRuns) notes.push('workflow-run listing hit maxRunPages; results are a bounded sweep');
  if (trunc?.checkShas) notes.push('check-run probing hit maxCheckShaCount; some revisions were not probed');
  return notes;
}

// --- small utils --------------------------------------------------------------

function mapGet(container, key) {
  if (container instanceof Map) return container.get(key);
  if (container && typeof container === 'object') return container[key];
  return undefined;
}

function objToEntries(obj) {
  const m = new Map();
  if (obj && typeof obj === 'object') for (const k of Object.keys(obj)) m.set(k, obj[k]);
  return m;
}

function bump(obj, reason) {
  obj[reason] = (obj[reason] ?? 0) + 1;
}

function deepFreezeStats(stats) {
  const freezeDeep = (v) => {
    if (v !== null && typeof v === 'object') {
      for (const k of Object.keys(v)) freezeDeep(v[k]);
      Object.freeze(v);
    }
    return v;
  };
  return freezeDeep(stats);
}
