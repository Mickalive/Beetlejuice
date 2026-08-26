/**
 * Normalized v2 bundle producer (WC-002; integration seam "A7").
 *
 * The product surface (apps/cli `--input`) consumes ONLY adapter-normalized,
 * vendor-neutral `agentic_task` records in the version-2 bundle envelope
 * documented in apps/cli/docs/NORMALIZED_INPUT.md:
 *
 *   { schema_version: "2", normalization_version, collector_version, records: [...] }
 *
 * This module is that producer for GitHub evidence. It reuses the EXACT same
 * mapping/correlation layer as the canonical-event assembler
 * (`map/pr-tasks.js`, `map/pr-index.js`, `map/ci-evidence.js`, `policy.js`),
 * so a historical audit and a normalized bundle built from the same evidence
 * make identical correlation decisions by construction — the seams cannot
 * silently drift.
 *
 * Honesty rules carried over from the event path (and sharpened where the
 * product seam would otherwise amplify them):
 *   - Model/tool invocation spend is NOT observable through read-only GitHub
 *     evidence: those components are always `{ basis: "unavailable",
 *     amount_micro_usd: null }`, never estimated.
 *   - CI/validation cost is `measured` only where the configured cost source
 *     resolves known money (operator-supplied Actions usage + explicit rate);
 *     otherwise the component stays unavailable. Compute cost is measured the
 *     same way from collected Actions JOB timing (the billed unit) when an
 *     explicit rate is configured; attempts already covered by a run-level
 *     usage record resolve to unknown instead of double-counting.
 *   - Revision succession is NOT waste evidence. A replaced head revision is
 *     normal iteration; this producer therefore emits NO
 *     `superseded_by_execution_id` / `retry_of_execution_id` relations from
 *     bare commit succession, so product certain-waste rules have nothing to
 *     misfire on. (The canonical-event seam keeps richer revision detail for
 *     the tenant ledger, which applies its own guarded rules.)
 *   - Closed-without-merge maps to `aborted` here (objective disappeared).
 *     SEAM-DIV (intentional divergence): the canonical-event path attributes
 *     the same repository evidence as `failed`, because the tenant ledger
 *     conservatively resolves an unmerged close as a failed delivery, while
 *     this bundle resolves it as aborted work. Both are NON-SUCCESS
 *     attributions from identical evidence — neither counts as accepted, and
 *     GitHub exposes no explicit terminal-failure signal on close, so neither
 *     seam claims a measured failure mode beyond the close itself.
 *     Consumers comparing seams must compare economics, not outcome labels.
 *   - Known cost whose revision binding is not provable rolls up onto its OWN
 *     task's surviving (final/span) execution — totals stay complete without
 *     inventing bindings, and rollups are counted explicitly.
 *
 * Raw provider payload fields (`workflow_run`, `pull_request`, `head_sha`,
 * `html_url`, `repository`, ...) NEVER appear anywhere in the output — the
 * product surface's validator rejects such keys outright. Identifiers here are
 * tenant-scope refs only (task/execution ids); repository coordinates do not
 * enter the bundle at all (enforced by test/bundle.test.js).
 */
import { repoScope } from './refs.js';
import { normalizePolicy, classifyPullRequest } from './policy.js';
import { unavailableEvidenceCostSource } from './cost-source.js';
import { mapPullRequestTask } from './map/pr-tasks.js';
import { buildPrIndex } from './map/pr-index.js';
import { correlateWorkflowRun, mapWorkflowRun, mapCheckRuns } from './map/ci-evidence.js';
import { mapWorkflowJobs, workflowRunAttemptKey } from './map/workflow-jobs.js';
import { ADAPTER_ID, COLLECTOR_VERSION, NORMALIZATION_VERSION } from './versions.js';

/** Canonical normalized-input schema version this producer targets (seam A). */
export const BUNDLE_SCHEMA_VERSION = '2';

const COMPONENT_KEYS = Object.freeze(['inference', 'tools', 'ci', 'compute']);

/**
 * Build the normalized v2 bundle from collected evidence.
 *
 * @param {object} evidence  collectHistory() output or an equivalent fixture:
 *        { scope, policy?, prs, prClassifications?, commitsByPull,
 *          workflowRuns, checkRunsBySha, collection? }
 * @param {object} [opts]    { policy?, costSource? }
 * @returns {{
 *   schema_version: '2',
 *   normalization_version: string,
 *   collector_version: string,
 *   records: Array<object>,
 *   collection_stats: object,
 * }}
 */
export function buildNormalizedBundle(evidence, opts = {}) {
  if (typeof evidence !== 'object' || evidence === null) {
    throw new TypeError('evidence must be an object (collectHistory() output or equivalent fixture)');
  }
  const scope = repoScope(evidence.scope);
  const policy = normalizePolicy(opts.policy ?? evidence.policy ?? {});
  const costSource = opts.costSource ?? unavailableEvidenceCostSource();
  const jobsByRunAttempt =
    evidence.workflowJobsByRunAttempt instanceof Map
      ? evidence.workflowJobsByRunAttempt
      : objToEntries(evidence.workflowJobsByRunAttempt);

  // --- Pass 1: ingest PRs into task skeletons (same mapper as the audit) -----
  /** @type {Array<{entry:object, pr:object, revisions:Array}>} */
  const skeletons = [];
  const stats = newBundleStats();

  /** taskRef -> revisionSha -> microUsd */
  const revisionCost = new Map();
  /** taskRef -> microUsd of known money no revision could provably hold */
  const taskLevelCost = new Map();
  /** Same two buckets for compute money coming from Actions job timing. */
  const revisionComputeCost = new Map();
  const taskLevelComputeCost = new Map();

  const pullsSorted = [...(evidence.prs ?? [])].sort((a, b) => Number(a.number) - Number(b.number));
  for (const pr of pullsSorted) {
    stats.prs_seen += 1;
    const cls =
      (evidence.prClassifications instanceof Map ? evidence.prClassifications.get(pr.number) : undefined) ??
      classifyPullRequest(pr, policy);
    if (!cls.agentic) {
      stats.prs_excluded_non_agentic += 1;
      continue;
    }
    if (cls.confidence === 'measured') stats.prs_ingested_measured += 1;
    else stats.prs_ingested_inferred += 1;

    const commits = getContainer(evidence.commitsByPull, pr.number) ?? [];
    // mapPullRequestTask is the single source of truth for revision ordering
    // and tenant-scope refs; the bundle consumes its structure verbatim.
    const { taskRef, revisions } = mapPullRequestTask({ pr, classification: cls, commits, scope });
    const entry = {
      prNumber: Number(pr.number),
      taskRef,
      headBranch: String(pr?.head?.ref ?? ''),
      confidence: cls.confidence,
      basis: cls.basis,
      agentLogin: matchedActorLogin(pr, cls),
      revisionShas: new Set(revisions.map((r) => r.sha)),
      executionRefByRevision: new Map(revisions.map((r) => [r.sha, r.executionRef])),
    };
    skeletons.push({ entry, pr, revisions });
    stats.revisions_observed += entry.revisionShas.size;
  }
  const prIndex = buildPrIndex(skeletons.map((s) => s.entry));

  // --- Pass 2: attach known CI/validation/compute money per (task, revision) --
  // Buckets mirror the event mappers' binding decisions exactly, because they
  // are derived from the very records those mappers emit.
  const runsSorted = [...(evidence.workflowRuns ?? [])].sort(
    (a, b) => Number(a?.id) - Number(b?.id) || Number(a?.run_attempt ?? 1) - Number(b?.run_attempt ?? 1)
  );
  for (const run of runsSorted) {
    stats.ci_runs_seen += 1;
    const correlation = correlateWorkflowRun(run, prIndex);
    if (correlation.noTask) {
      bump(stats.ci_runs_excluded_by_reason, correlation.reason);
      continue;
    }

    // Compute money from correlated runs' jobs — gated on correlation only,
    // mirroring the event assembler so both seams stay decision-identical.
    const jobs = jobsByRunAttempt.get(workflowRunAttemptKey(run));
    if (jobs !== undefined) {
      stats.workflow_jobs_seen += Array.isArray(jobs) ? jobs.length : 0;
      const jmapped = mapWorkflowJobs({
        run,
        jobs,
        task: correlation.task,
        scope,
        costSource,
        linkConfidence: correlation.confidence,
      });
      stats.workflow_jobs_emitted += jmapped.records.length;
      stats.workflow_jobs_pending_not_terminal += jmapped.pending;
      for (const ex of jmapped.excluded) bump(stats.workflow_jobs_excluded_by_reason, ex.reason);
      for (const { event } of jmapped.records) {
        const jcost = event.payload?.cost;
        if (!jcost || jcost.known !== true) {
          stats.compute_cost_unknown += 1;
          continue;
        }
        stats.compute_cost_known += 1;
        // Mirror mapWorkflowJobs' binding condition exactly: money binds to
        // the revision iff the run head SHA is a known revision of this task.
        const headSha = typeof run.head_sha === 'string' ? run.head_sha : null;
        const revisionKey =
          headSha !== null && correlation.task.executionRefByRevision.has(headSha) ? headSha : null;
        placeKnownCost({
          taskRef: event.task_ref,
          revisionKey,
          entry: prIndex.byNumber.get(correlation.task.prNumber),
          microUsd: jcost.micro_usd,
          revisionCost: revisionComputeCost,
          taskLevelCost: taskLevelComputeCost,
          stats,
          kind: 'compute',
        });
      }
    }

    const mapped = mapWorkflowRun({ run, correlation, scope, costSource });
    if (mapped.pending) {
      stats.ci_runs_pending_not_terminal += 1;
      continue;
    }
    if (mapped.excluded) {
      bump(stats.ci_runs_excluded_by_reason, mapped.excluded.reason);
      continue;
    }
    const event = mapped.records[0]?.event;
    const cost = event?.payload?.cost;
    if (!event || !cost || cost.known !== true) {
      stats.ci_runs_cost_unknown += 1;
      continue;
    }
    stats.ci_runs_cost_known += 1;
    placeKnownCost({
      taskRef: event.task_ref,
      revisionKey: typeof event.payload.revision_key === 'string' ? event.payload.revision_key : null,
      entry: prIndex.byNumber.get(correlation.task.prNumber),
      microUsd: cost.micro_usd,
      revisionCost,
      taskLevelCost,
      stats,
      kind: 'ci',
    });
  }

  const checkMap =
    evidence.checkRunsBySha instanceof Map ? evidence.checkRunsBySha : objToEntries(evidence.checkRunsBySha);
  const shasSorted = [...checkMap.keys()].sort();
  for (const sha of shasSorted) {
    const checkRuns = checkMap.get(sha);
    stats.validation_records_seen += Array.isArray(checkRuns) ? checkRuns.length : 0;
    const mapped = mapCheckRuns({ sha, checkRuns, prIndex, scope, costSource });
    stats.validation_records_pending_not_terminal += mapped.pending;
    for (const ex of mapped.excluded) bump(stats.validation_records_excluded_by_reason, ex.reason);

    for (const { event } of mapped.records) {
      const cost = event?.payload?.cost;
      if (!cost || cost.known !== true) {
        stats.validation_cost_unknown += 1;
        continue;
      }
      stats.validation_cost_known += 1;
      placeKnownCost({
        taskRef: event.task_ref,
        revisionKey: sha, // check-run mapping iterates BY revision sha
        entry: prIndex.byRevision.get(sha)?.[0],
        microUsd: cost.micro_usd,
        revisionCost,
        taskLevelCost,
        stats,
        kind: 'validation',
      });
    }
  }

  // --- Pass 3: emit one record per ingested task ------------------------------
  const records = [];
  for (const skeleton of skeletons) {
    const record = buildRecord({
      ...skeleton,
      revisionCost,
      taskLevelCost,
      revisionComputeCost,
      taskLevelComputeCost,
      stats,
    });
    if (record) records.push(record);
    else stats.prs_excluded_missing_start += 1;
  }

  return deepFreeze({
    schema_version: BUNDLE_SCHEMA_VERSION,
    normalization_version: NORMALIZATION_VERSION,
    collector_version: COLLECTOR_VERSION,
    records,
    collection_stats: finalizeStats(stats, evidence),
  });
}

// --- record assembly -----------------------------------------------------------

function buildRecord({ entry, pr, revisions, revisionCost, taskLevelCost, revisionComputeCost, taskLevelComputeCost, stats }) {
  const createdAt = isoOrNull(pr?.created_at);
  const closedAt = isoOrNull(pr?.closed_at);
  const mergedAt = isoOrNull(pr?.merged_at);

  let startedAt = createdAt ?? revisions[0]?.committedAt ?? null;
  if (!startedAt) return null; // no defensible start -> exclude honestly (counted)

  const endedAt = mergedAt ?? closedAt ?? null;
  const outcomeStatus = mergedAt ? 'accepted' : pr?.state === 'closed' ? 'aborted' : 'unresolved';

  const revCosts = revisionCost.get(entry.taskRef);
  const unassignedMicroUsd = taskLevelCost.get(entry.taskRef) ?? 0;
  const revComputeCosts = revisionComputeCost.get(entry.taskRef);
  const unassignedComputeMicroUsd = taskLevelComputeCost.get(entry.taskRef) ?? 0;

  const executions = [];
  for (let i = 0; i < revisions.length; i += 1) {
    const rev = revisions[i];
    if (!isoOrNull(rev.committedAt)) {
      stats.executions_excluded_missing_timestamp += 1;
      continue;
    }
    const isLast = i === revisions.length - 1;
    const ownCost = revCosts?.get(rev.sha) ?? 0;
    const rollup = isLast ? unassignedMicroUsd : 0;
    const ciTotal = ownCost + rollup;
    if (rollup > 0) {
      stats.ci_cost_task_level_rollup_components += 1;
      stats.ci_cost_task_level_rollup_micro_usd_total += rollup;
    }
    const ownCompute = revComputeCosts?.get(rev.sha) ?? 0;
    const computeRollup = isLast ? unassignedComputeMicroUsd : 0;
    const computeTotal = ownCompute + computeRollup;
    if (computeRollup > 0) {
      stats.compute_cost_task_level_rollup_components += 1;
      stats.compute_cost_task_level_rollup_micro_usd_total += computeRollup;
    }
    executions.push(
      executionJson({
        executionId: rev.executionRef,
        agentFamily: agentFamilyFor(entry),
        startedAt: rev.committedAt,
        endedAt: isLast ? endedAt : nextStartTime(revisions, i),
        ciMicroUsd: ciTotal > 0 ? ciTotal : null,
        computeMicroUsd: computeTotal > 0 ? computeTotal : null,
      })
    );
  }

  // No revision could be represented (empty commit list or all excluded):
  // emit ONE span execution so the observed activity window and every known
  // dollar stay visible instead of silently disappearing.
  if (executions.length === 0) {
    stats.executions_span_fallback += 1;
    const spanCi = revCostsTotal(revCosts) + unassignedMicroUsd;
    const spanCompute = revCostsTotal(revComputeCosts) + unassignedComputeMicroUsd;
    executions.push(
      executionJson({
        executionId: `${entry.taskRef}:span`,
        agentFamily: agentFamilyFor(entry),
        startedAt,
        endedAt,
        ciMicroUsd: spanCi > 0 ? spanCi : null,
        computeMicroUsd: spanCompute > 0 ? spanCompute : null,
      })
    );
  }

  return {
    record_type: 'agentic_task',
    task_id: entry.taskRef,
    started_at: startedAt,
    ...(endedAt !== null ? { ended_at: endedAt } : {}),
    ...(outcomeStatus === 'aborted' && closedAt !== null ? { aborted_at: closedAt } : {}),
    source_adapter: { name: ADAPTER_ID, version: COLLECTOR_VERSION },
    outcome: { status: outcomeStatus },
    executions,
  };
}

function executionJson({ executionId, agentFamily, startedAt, endedAt, ciMicroUsd, computeMicroUsd = null }) {
  const components = {
    inference: { basis: 'unavailable', amount_micro_usd: null },
    tools: { basis: 'unavailable', amount_micro_usd: null },
    ci:
      ciMicroUsd === null
        ? { basis: 'unavailable', amount_micro_usd: null }
        : { basis: 'measured', amount_micro_usd: ciMicroUsd },
    compute:
      computeMicroUsd === null
        ? { basis: 'unavailable', amount_micro_usd: null }
        : { basis: 'measured', amount_micro_usd: computeMicroUsd },
  };
  let total = 0;
  for (const key of COMPONENT_KEYS) {
    const c = components[key];
    if (c.basis !== 'unavailable') total += c.amount_micro_usd;
  }
  return {
    execution_id: executionId,
    agent: { family: agentFamily, model_class: 'unknown' },
    started_at: startedAt,
    ...(endedAt !== null ? { ended_at: endedAt } : {}),
    components,
    total_amount_micro_usd: total,
  };
}

// --- cost placement --------------------------------------------------------------

function placeKnownCost({ taskRef, revisionKey, entry, microUsd, revisionCost, taskLevelCost, stats, kind }) {
  const revisionBelongsToTask =
    revisionKey !== null && entry !== undefined && entry.taskRef === taskRef && entry.revisionShas.has(revisionKey);
  if (revisionBelongsToTask) {
    const perTask = revisionCost.get(taskRef) ?? new Map();
    perTask.set(revisionKey, (perTask.get(revisionKey) ?? 0) + microUsd);
    revisionCost.set(taskRef, perTask);
    if (kind === 'ci') stats.ci_cost_bound_to_revision_micro_usd_total += microUsd;
    else if (kind === 'compute') stats.compute_cost_bound_to_revision_micro_usd_total += microUsd;
    else stats.validation_cost_bound_to_revision_micro_usd_total += microUsd;
    return;
  }
  // Known money whose revision binding is not provable from evidence. It rolls
  // up onto ITS OWN task's surviving execution so task economics stay complete;
  // it never lands on another task.
  if (entry === undefined || entry.taskRef !== taskRef) {
    stats.cost_dropped_unattributable += 1; // defensive: upstream mappers already scope tasks
    return;
  }
  taskLevelCost.set(taskRef, (taskLevelCost.get(taskRef) ?? 0) + microUsd);
  if (kind === 'ci') stats.ci_cost_task_level_micro_usd_total += microUsd;
  else if (kind === 'compute') stats.compute_cost_task_level_micro_usd_total += microUsd;
  else stats.validation_cost_task_level_micro_usd_total += microUsd;
}

// --- helpers -----------------------------------------------------------------------

/**
 * measured classification means the allowlisted actor login is EVIDENCE of which
 * agent acted; inferred branch conventions prove nothing about agent identity,
 * so they stay honestly unknown.
 */
function matchedActorLogin(pr, cls) {
  if (cls.confidence !== 'measured') return null;
  const login = pr?.user?.login;
  return typeof login === 'string' && login.length > 0 ? login : null;
}

function agentFamilyFor(entry) {
  return entry.agentLogin !== null ? entry.agentLogin.toLowerCase() : 'unknown';
}

function nextStartTime(revisions, idx) {
  for (let i = idx + 1; i < revisions.length; i += 1) {
    if (isoOrNull(revisions[i].committedAt)) return revisions[i].committedAt;
  }
  return null;
}

function newBundleStats() {
  return {
    prs_seen: 0,
    prs_ingested_measured: 0,
    prs_ingested_inferred: 0,
    prs_excluded_non_agentic: 0,
    prs_excluded_missing_start: 0,
    revisions_observed: 0,
    executions_excluded_missing_timestamp: 0,
    executions_span_fallback: 0,
    ci_runs_seen: 0,
    ci_runs_pending_not_terminal: 0,
    ci_runs_cost_known: 0,
    ci_runs_cost_unknown: 0,
    ci_runs_excluded_by_reason: {},
    workflow_jobs_seen: 0,
    workflow_jobs_emitted: 0,
    workflow_jobs_pending_not_terminal: 0,
    workflow_jobs_excluded_by_reason: {},
    compute_cost_known: 0,
    compute_cost_unknown: 0,
    validation_records_seen: 0,
    validation_records_pending_not_terminal: 0,
    validation_cost_known: 0,
    validation_cost_unknown: 0,
    validation_records_excluded_by_reason: {},
    ci_cost_bound_to_revision_micro_usd_total: 0,
    ci_cost_task_level_micro_usd_total: 0,
    ci_cost_task_level_rollup_components: 0,
    ci_cost_task_level_rollup_micro_usd_total: 0,
    compute_cost_bound_to_revision_micro_usd_total: 0,
    compute_cost_task_level_micro_usd_total: 0,
    compute_cost_task_level_rollup_components: 0,
    compute_cost_task_level_rollup_micro_usd_total: 0,
    validation_cost_bound_to_revision_micro_usd_total: 0,
    validation_cost_task_level_micro_usd_total: 0,
    cost_dropped_unattributable: 0,
  };
}

const FIXED_BUNDLE_NOTES = Object.freeze([
  'inference/tools spend is not observable through read-only GitHub evidence; those components are unavailable, never estimated',
  'ci/compute cost is measured only where the configured cost source resolves known money (Actions usage records or collected job timing times an explicit rate); otherwise unavailable',
  'job-level money for an attempt already covered by a run-level usage record resolves to unknown instead of double-counting',
  "known cost whose revision binding is unprovable rolls up to its own task's final execution so totals stay complete without inventing bindings",
  'no superseded/retry relations are emitted from bare revision succession: normal iteration is not certain waste',
]);

function finalizeStats(stats, evidence) {
  const notes = [...FIXED_BUNDLE_NOTES];
  const trunc = evidence?.collection?.truncated;
  if (trunc?.pullRequests) notes.push('pull-request sweep hit maxPrPages; results are a bounded sweep');
  if (trunc?.workflowRuns) notes.push('workflow-run sweep hit maxRunPages; results are a bounded sweep');
  if (trunc?.checkShas) notes.push('check-run probing hit maxCheckShaCount; some revisions were not probed');
  if (trunc?.jobs) notes.push('Actions job listing hit maxJobPagesPerRun on at least one run; some jobs were not probed');
  return { ...stats, notes };
}

function getContainer(container, key) {
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

function revCostsTotal(revCosts) {
  if (!(revCosts instanceof Map)) return 0;
  let total = 0;
  for (const v of revCosts.values()) total += v;
  return total;
}

function isoOrNull(v) {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}
