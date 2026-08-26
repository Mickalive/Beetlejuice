// Economics summarization over canonical normalized agentic_task records (v2).
//
// Invariants:
// - all arithmetic in integer micro-USD (single canonical unit with core);
// - measured / estimated / unavailable bases are never merged silently;
// - successful outcome = canonical `accepted` attribution; cost per successful
//   outcome is labeled with its exact formula;
// - unresolved tasks keep their cost visible — success is never guessed.

import { COMPONENT_KEYS } from "./schema.js";

const SUCCESS_STATUS = "accepted";

function timestampOf(record) {
  return Date.parse(record.started_at);
}

export function summarizeEconomics(records) {
  let measuredMicroUsd = 0;
  let estimatedMicroUsd = 0;
  let unavailableComponents = 0;

  const byComponent = {};
  for (const key of COMPONENT_KEYS) {
    byComponent[key] = {
      measured: { count: 0, micro_usd: 0 },
      estimated: { count: 0, micro_usd: 0 },
      unavailable: { count: 0 },
    };
  }

  const outcomeCounts = {
    accepted: 0,
    failed: 0,
    aborted: 0,
    unresolved: 0,
  };

  let executionsTotal = 0;
  let tokenInputTotal = 0;
  let tokenOutputTotal = 0;
  const agentFamilies = new Map();

  let minTs = Number.POSITIVE_INFINITY;
  let maxTs = Number.NEGATIVE_INFINITY;

  for (const record of records) {
    outcomeCounts[record.outcome.status] += 1;

    const startTs = timestampOf(record);
    if (Number.isFinite(startTs)) minTs = Math.min(minTs, startTs);
    const endRaw = record.ended_at ?? null;
    const endTs = endRaw ? Date.parse(endRaw) : NaN;
    if (Number.isFinite(endTs)) maxTs = Math.max(maxTs, endTs);
    else if (Number.isFinite(startTs)) maxTs = Math.max(maxTs, startTs);

    for (const execution of record.executions) {
      executionsTotal += 1;
      const family = execution.agent?.family ?? "unknown";
      agentFamilies.set(family, (agentFamilies.get(family) ?? 0) + 1);

      // Executions refine the observed activity window (e.g., open tasks whose
      // record has no ended_at still have finished executions).
      const execStart = Date.parse(execution.started_at);
      if (Number.isFinite(execStart)) {
        minTs = Math.min(minTs, execStart);
        maxTs = Math.max(maxTs, execStart);
      }
      const execEndRaw = execution.ended_at ?? null;
      const execEnd = execEndRaw ? Date.parse(execEndRaw) : NaN;
      if (Number.isFinite(execEnd)) maxTs = Math.max(maxTs, execEnd);

      if (execution.tokens) {
        tokenInputTotal += execution.tokens.input ?? 0;
        tokenOutputTotal += execution.tokens.output ?? 0;
      }

      for (const key of COMPONENT_KEYS) {
        const component = execution.components[key];
        if (!component) continue;
        const bucket = byComponent[key][component.basis];
        bucket.count += 1;
        if (component.basis === "unavailable") {
          unavailableComponents += 1;
        } else {
          bucket.micro_usd += component.amount_micro_usd;
          if (component.basis === "measured") measuredMicroUsd += component.amount_micro_usd;
          else estimatedMicroUsd += component.amount_micro_usd;
        }
      }
    }
  }

  const representableMicroUsd = measuredMicroUsd + estimatedMicroUsd;
  const successfulOutcomes = outcomeCounts[SUCCESS_STATUS];
  const costPerSuccessfulOutcome =
    successfulOutcomes > 0 ? representableMicroUsd / successfulOutcomes : null;

  return {
    period: {
      from_iso: Number.isFinite(minTs) ? new Date(minTs).toISOString() : null,
      to_iso: Number.isFinite(maxTs) ? new Date(maxTs).toISOString() : null,
    },
    tasks: { total: records.length, ...outcomeCounts },
    outcomes: { successful: successfulOutcomes, success_status: SUCCESS_STATUS },
    cost: {
      currency: "USD",
      unit: "micro_usd",
      measured_micro_usd: measuredMicroUsd,
      estimated_micro_usd: estimatedMicroUsd,
      representable_total_micro_usd: representableMicroUsd,
      unavailable_components: unavailableComponents,
      // Cost accounting invariant: representable spend is exactly the sum of
      // per-component amounts; unavailable components contribute $0 but are counted.
    },
    outcomes_economics: {
      cost_per_successful_outcome_micro_usd: costPerSuccessfulOutcome,
      formula:
        "representable_total_micro_usd / successful_outcomes (measured + estimated basis; unavailable components excluded)",
    },
    diagnostics: {
      executions_total: executionsTotal,
      tokens_input_total: tokenInputTotal,
      tokens_output_total: tokenOutputTotal,
      agents_by_family: Object.fromEntries([...agentFamilies.entries()].sort()),
    },
    data_quality_by_component: byComponent,
  };
}

/**
 * Per-task ledger rows used for transparent cost→outcome attribution.
 * Waste amounts are attached later by the audit pipeline.
 */
export function buildTaskLedger(records) {
  const rows = records.map((record) => {
    let measured = 0;
    let estimated = 0;
    let unavailable = 0;
    for (const execution of record.executions) {
      for (const key of COMPONENT_KEYS) {
        const component = execution.components[key];
        if (!component) continue;
        if (component.basis === "measured") measured += component.amount_micro_usd;
        else if (component.basis === "estimated") estimated += component.amount_micro_usd;
        else unavailable += 1;
      }
    }
    return {
      task_id: record.task_id,
      outcome_status: record.outcome.status,
      measured_micro_usd: measured,
      estimated_micro_usd: estimated,
      unavailable_components: unavailable,
      waste_micro_usd: 0,
      finding_ids: [],
    };
  });
  // Deterministic order independent of input record order.
  rows.sort((a, b) => (a.task_id < b.task_id ? -1 : a.task_id > b.task_id ? 1 : 0));
  return rows;
}
