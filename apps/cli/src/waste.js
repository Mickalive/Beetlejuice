// Certain-waste detection over canonical normalized records (product-seam rules).
//
// Policy: a finding is emitted ONLY when the customer's own evidence proves the
// spend could not contribute to the accepted outcome. Ambiguous evidence yields
// NO finding. Each execution's cost is claimed at most once across all rules
// (no double counting). Evidence references stay in tenant scope.
//
// Rule-ID unification (audit S1/R7): every product-seem rule declares the
// canonical packages/core rule class it belongs to (`canonical_rule_class`), so
// reports never mix classification vocabularies. Rules with no core equivalent
// yet carry `canonical_rule_class: null` and are labeled as product-surface
// extensions.

import { COMPONENT_KEYS } from "./schema.js";

export const WASTE_RULE_ORDER = Object.freeze([
  "SUPERSEDED_EXECUTION",
  "IDENTICAL_RETRY_AFTER_DETERMINISTIC_FAILURE",
  "EXECUTION_AFTER_TASK_ABORT",
]);

export const RULE_VERSIONS = Object.freeze({
  SUPERSEDED_EXECUTION: "1.1.0",
  IDENTICAL_RETRY_AFTER_DETERMINISTIC_FAILURE: "1.1.0",
  EXECUTION_AFTER_TASK_ABORT: "1.0.1", // 1.0.1: explanation no longer claims completion without ended_at (audit WORD-1)
});

/**
 * Canonical (packages/core) rule classes for unified reporting vocabularies.
 * Core IDs: WASTE_DET_RETRY_V1 / WASTE_DUP_CI_V1 / WASTE_EXEC_SUPERSEDED_V1.
 */
export const CANONICAL_RULE_CLASSES = Object.freeze({
  SUPERSEDED_EXECUTION: "WASTE_EXEC_SUPERSEDED_V1",
  IDENTICAL_RETRY_AFTER_DETERMINISTIC_FAILURE: "WASTE_DET_RETRY_V1",
  EXECUTION_AFTER_TASK_ABORT: null, // no core equivalent yet (product-surface extension)
});

/**
 * Guard-abstention counters. A guard fires when evidence would otherwise look
 * flaggable but a boundary precondition for certainty is not met; the candidate
 * is dropped and the drop is counted so reports can show why nothing was found.
 */
function newGuardStats() {
  return {
    retry_without_recorded_failure: 0,
    replacement_not_started_strictly_later: 0,
  };
}

function executionCostEvidence(taskId, execution) {
  const components = COMPONENT_KEYS.filter((k) => execution.components[k]).map((k) => {
    const c = execution.components[k];
    return c.basis === "unavailable"
      ? `${k}:unavailable`
      : `${k}:${c.amount_micro_usd}µ$(${c.basis})`;
  });
  return {
    kind: "execution_cost",
    task_id: taskId,
    execution_id: execution.execution_id,
    amount_micro_usd: execution.total_amount_micro_usd,
    components_summary: components.join(", "),
  };
}

function makeFinding(ruleId, execution, explanation, recommendedAction, evidence) {
  return {
    rule_id: ruleId,
    rule_version: RULE_VERSIONS[ruleId],
    canonical_rule_class: CANONICAL_RULE_CLASSES[ruleId],
    confidence: "certain",
    avoided_cost_micro_usd: execution.total_amount_micro_usd,
    currency: "USD",
    claimed_execution_ids: [execution.execution_id],
    explanation,
    recommended_action: recommendedAction,
    evidence,
  };
}

/** Rule 1: execution explicitly superseded by a replacement within the same task. */
function findSupersededExecutionWaste(record, guards) {
  const findings = [];
  for (const execution of record.executions) {
    const target = execution.superseded_by_execution_id;
    if (!target) continue;
    const replacement = record.executions.find((e) => e.execution_id === target);
    if (!replacement || replacement.execution_id === execution.execution_id) continue; // validator already rejects unknown refs
    // R4 guard (audit defect D4): supersession is only PROVABLE when the
    // replacement started strictly later than the superseded attempt. A
    // "replacement" that began earlier is contradictory evidence — flagging it
    // would let internally inconsistent records inflate certain waste.
    const startTs = Date.parse(execution.started_at);
    const replacementTs = Date.parse(replacement.started_at);
    if (!Number.isFinite(startTs) || !Number.isFinite(replacementTs) || replacementTs <= startTs) {
      guards.replacement_not_started_strictly_later += 1;
      continue;
    }
    findings.push(
      makeFinding(
        "SUPERSEDED_EXECUTION",
        execution,
        `Execution ${execution.execution_id} (started ${execution.started_at}) was superseded by ${target}, which started strictly later (${replacement.started_at}), for the same task; its result can no longer contribute to the task outcome (${record.outcome.status}), so its full attributed cost is certainly avoidable.`,
        `Cancel in-flight/superseded attempts as soon as a newer attempt supersedes them instead of letting them run to completion.`,
        [
          executionCostEvidence(record.task_id, execution),
          {
            kind: "superseded_by",
            task_id: record.task_id,
            execution_id: execution.execution_id,
            superseded_by_execution_id: target,
          },
        ]
      )
    );
  }
  return findings;
}

/**
 * Rule 2: identical retry after a classified deterministic failure.
 * Negative controls: retries after transient/flaky/unknown failures emit nothing,
 * retries whose work_signature differs from the failed attempt emit nothing, and
 * (R2 guard, audit defect D2) a retry that does NOT itself carry a recorded
 * failure outcome emits nothing — a retry that succeeded demonstrably
 * contributed to the task path, so calling it "certain waste" is falsifiable.
 */
function findIdenticalRetryWaste(record, guards) {
  const findings = [];
  const byId = new Map(record.executions.map((e) => [e.execution_id, e]));
  for (const execution of record.executions) {
    const priorId = execution.retry_of_execution_id;
    if (!priorId) continue;
    const prior = byId.get(priorId);
    if (!prior) continue; // validator rejects unknown refs
    if (prior.failure_category !== "deterministic") continue;
    if (!execution.work_signature || !prior.work_signature || execution.work_signature !== prior.work_signature) {
      continue;
    }
    if (!execution.failure_category) {
      // R2: no recorded failure on the retry itself => observed success or unknown
      // outcome. Either way the certainty premise is broken: abstain.
      guards.retry_without_recorded_failure += 1;
      continue;
    }
    findings.push(
      makeFinding(
        "IDENTICAL_RETRY_AFTER_DETERMINISTIC_FAILURE",
        execution,
        `Execution ${execution.execution_id} retried ${priorId} with an identical work signature after that attempt had already been classified as a deterministic failure (${prior.failure_category}), and the retry itself ended in a recorded failure (${execution.failure_category}); repeating identical inputs against a deterministic failure cannot succeed, so the retry's full cost is certainly avoidable.`,
        `Stop retry chains once a failure is classified deterministic; change inputs or configuration before spending again.`,
        [
          executionCostEvidence(record.task_id, execution),
          {
            kind: "identical_retry_of_deterministic_failure",
            task_id: record.task_id,
            retry_execution_id: execution.execution_id,
            prior_execution_id: priorId,
            work_signature_class: "identical",
            prior_failure_category: prior.failure_category,
            retry_failure_category: execution.failure_category,
          },
        ]
      )
    );
  }
  return findings;
}

/** Rule 3: executions that started only after the task objective disappeared (abort). */
function findExecutionAfterAbortWaste(record) {
  if (record.outcome.status !== "aborted") return [];
  if (!record.aborted_at) return []; // cannot prove timing -> no certain finding
  const abortTs = Date.parse(record.aborted_at);
  if (!Number.isFinite(abortTs)) return [];

  const findings = [];
  for (const execution of record.executions) {
    const startTs = Date.parse(execution.started_at);
    if (!Number.isFinite(startTs)) continue;
    if (startTs <= abortTs) continue; // started while the objective still existed
    // WORD-1: the avoidability claim rests on the START being after the abort.
    // Only say "ran to completion" when an end was actually recorded — never
    // claim more than the evidence shows.
    const ranToCompletion = execution.ended_at !== null && execution.ended_at !== undefined;
    findings.push(
      makeFinding(
        "EXECUTION_AFTER_TASK_ABORT",
        execution,
        `Task was aborted at ${record.aborted_at} (objective disappeared), but execution ${execution.execution_id} started afterwards${ranToCompletion ? ` and ran to completion (ended ${execution.ended_at})` : ""}; spend after the objective vanished demonstrably could not contribute to any accepted outcome.`,
        `Propagate task cancellation to running agents/executions so no compute starts after the objective disappears.`,
        [
          executionCostEvidence(record.task_id, execution),
          {
            kind: "started_after_abort",
            task_id: record.task_id,
            execution_id: execution.execution_id,
            aborted_at: record.aborted_at,
            execution_started_at: execution.started_at,
          },
        ]
      )
    );
  }
  return findings;
}

const RULES_BY_NAME = {
  SUPERSEDED_EXECUTION: findSupersededExecutionWaste,
  IDENTICAL_RETRY_AFTER_DETERMINISTIC_FAILURE: findIdenticalRetryWaste,
  EXECUTION_AFTER_TASK_ABORT: findExecutionAfterAbortWaste,
};

/**
 * Detect certain waste across all records.
 *
 * @returns {{ findings: Array, suppressed_for_double_counting: number, guards_abstained: object }}
 *   findings are deterministically ordered and each carries a tenant-local
 *   finding_key (`<task_id>/<rule>/<execution_id>`); audit assigns F-xxx ids.
 *   guards_abstained counts rule-boundary preconditions that dropped would-be
 *   candidates (see newGuardStats) so "no finding" stays explainable.
 */
export function detectCertainWaste(records) {
  const claimed = new Set(); // `${task_id}::${execution_id}` — single-claim guard
  const findings = [];
  let suppressedForDoubleCounting = 0;
  const guards = newGuardStats();

  // Deterministic iteration order: records as given, rules in fixed order.
  const sortedRecords = [...records].sort((a, b) => (a.task_id < b.task_id ? -1 : 1));
  for (const record of sortedRecords) {
    for (const ruleId of WASTE_RULE_ORDER) {
      for (const finding of RULES_BY_NAME[ruleId](record, guards)) {
        const key = `${record.task_id}::${finding.claimed_execution_ids[0]}`;
        if (claimed.has(key)) {
          suppressedForDoubleCounting += 1;
          continue;
        }
        claimed.add(key);
        findings.push({
          ...finding,
          task_id: record.task_id,
          finding_key: `${record.task_id}/${finding.rule_id}/${finding.claimed_execution_ids[0]}`,
        });
      }
    }
  }

  findings.sort(
    (a, b) =>
      (a.task_id < b.task_id ? -1 : a.task_id > b.task_id ? 1 : 0) ||
      WASTE_RULE_ORDER.indexOf(a.rule_id) - WASTE_RULE_ORDER.indexOf(b.rule_id) ||
      (a.finding_key < b.finding_key ? -1 : 1)
  );

  return {
    findings,
    suppressed_for_double_counting: suppressedForDoubleCounting,
    guards_abstained: guards,
  };
}
