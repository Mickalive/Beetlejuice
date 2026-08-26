/**
 * First-screen economics (MASTER_PROMPT §19): leads with total measured cost,
 * successful outcomes, cost per successful outcome and certainly avoidable
 * spend — not token counts.
 *
 * Rounding policy: integer micro-USD everywhere; derived ratios are rounded
 * half-up to 6 decimal places. `cost_per_accepted_micro_usd` divides TOTAL
 * measured cost by accepted outcomes — the honest economics view, including
 * the cost of failed/aborted/unresolved work.
 */
import { verifyCostAccounting, costEvidenceState } from './cost.js';

function round6(x) {
  return Math.round(x * 1e6) / 1e6;
}

/**
 * @param {object} input
 * @param {Array} input.tasks reconstructed AGENTIC_TASK aggregates
 * @param {object} input.waste result of runWasteAnalysis()
 * @param {number} [input.eventCount]
 */
export function computeSummary({ tasks, waste, eventCount }) {
  const totals = {
    tasks: tasks.length,
    accepted: 0,
    failed: 0,
    aborted: 0,
    unresolved: 0,
    acceptedWithRevert: 0,
    withHumanRework: 0,
  };
  let known = 0;
  let unknownComponents = 0;
  const attribution = { measured: 0, partial: 0 };

  for (const task of tasks) {
    switch (task.outcome.kind) {
      case 'accepted': totals.accepted += 1; break;
      case 'failed': totals.failed += 1; break;
      case 'aborted': totals.aborted += 1; break;
      default: totals.unresolved += 1; break;
    }
    if (task.outcome.reverted) totals.acceptedWithRevert += 1;
    if (task.humanReworkEvents > 0) totals.withHumanRework += 1;
    attribution[task.outcome.attribution] += 1;
  }

  const accounting = verifyCostAccounting(tasks);
  known = accounting.knownMicroUsd;
  unknownComponents = accounting.unknownComponentCount;

  const byRule = {};
  for (const finding of waste.findings) {
    byRule[finding.rule_id] = (byRule[finding.rule_id] ?? 0) + finding.wasted_micro_usd;
  }

  const certainlyAvoidable = waste.certainlyAvoidableMicroUsd;

  return {
    totals,
    cost: {
      currency: 'USD',
      unit: 'micro_usd',
      knownMicroUsd: known,
      totalComponents: accounting.totalComponents,
      unknownComponentCount: unknownComponents,
      // Canonical zero-cost honesty predicate (audit LIVE-REPORT-ZERO-DOLLARS):
      // when this is 'unmeasured' or 'none_observed', report surfaces must NOT
      // render the headline as "$0.00" — no measurable cost evidence exists.
      evidenceState: costEvidenceState(accounting),
      byKindMicroUsd: { ...accounting.byKindMicroUsd },
      costPerAcceptedOutcomeMicroUsd:
        totals.accepted > 0 ? Math.round(known / totals.accepted) : null,
      accountingBalanced: accounting.balanced,
    },
    waste: {
      findingsCount: waste.findings.length,
      certainlyAvoidableMicroUsd: certainlyAvoidable,
      ratioOfKnownCost: known > 0 ? round6(certainlyAvoidable / known) : null,
      byRuleMicroUsd: byRule,
    },
    dataQuality: {
      eventCount: eventCount ?? null,
      outcomeAttribution: attribution,
    },
  };
}
