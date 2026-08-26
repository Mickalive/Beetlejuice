// Audit pipeline: two ingestion seams -> ONE report model (WC-005).
//
// Seam A (normalized-input): versioned `agentic_task` bundles from adapters;
//        economics and certain-waste detection run in this package.
// Seam B (canonical-core): a versioned export of packages/core
//        `TenantLedger.audit()`; core's OWN summary/waste/tasks are consumed
//        verbatim — nothing is recomputed, so there is exactly one canonical
//        model doing the economics (audit S1/R7).
//
// The report model is the reusable product surface: the CLI prints it, a future
// dashboard/server can render it without re-implementing economics.

import { validateNormalizedBundle, CANONICAL_SCHEMA_VERSION } from "./schema.js";
import { summarizeEconomics, buildTaskLedger } from "./economics.js";
import { detectCertainWaste, RULE_VERSIONS, WASTE_RULE_ORDER } from "./waste.js";
import {
  validateCoreAuditExport,
  deriveUnquantifiedEvidenceUnits,
  CORE_AUDIT_EXPORT_TYPE,
  CORE_AUDIT_EXPORT_VERSION,
} from "./core_audit.js";
import { roundHalfUpToCent } from "./money.js";

export const REPORT_VERSION = "2";

function assignFindingIds(findings) {
  return findings.map((finding, i) => ({
    finding_id: `F-${String(i + 1).padStart(3, "0")}`,
    ...finding,
  }));
}

const SPECULATIVE_NOTE =
  "Beetlejuice reports only certain, evidence-backed waste in V1; speculative/model-routing savings are intentionally left unestimated";

/* -------------------------------------------------------------------------
 * Seam A — normalized-input bundles (schema v2)
 * ---------------------------------------------------------------------- */

/**
 * Build the full audit report model from an adapter-normalized bundle.
 * @param {{ schema_version, normalization_version, collector_version, records }} bundle
 * @param {{ mode: "synthetic-demo" | "normalized-input" }} meta
 */
export function buildAuditReport(bundle, meta) {
  const validation = validateNormalizedBundle(bundle);
  if (!validation.ok) {
    const error = new Error(
      `normalized input rejected (${validation.errors.length} error(s)); first: ${validation.errors[0].path}: ${validation.errors[0].message}`
    );
    error.code = "INVALID_NORMALIZED_INPUT";
    error.validation_errors = validation.errors;
    throw error;
  }

  const records = validation.records;
  const economics = summarizeEconomics(records);
  const { findings: rawFindings, suppressed_for_double_counting, guards_abstained } =
    detectCertainWaste(records);
  const findings = assignFindingIds(rawFindings);

  const avoidableMicroUsd = findings.reduce((sum, f) => sum + f.avoided_cost_micro_usd, 0);
  const measuredMicroUsd = economics.cost.measured_micro_usd;
  const wasteRatioPercent =
    measuredMicroUsd > 0 ? Math.round((avoidableMicroUsd / measuredMicroUsd) * 100 * 100) / 100 : 0;

  // Traceability: every savings dollar must resolve to explicit findings.
  const savingsFindingIds = findings.map((f) => f.finding_id);

  const ledger = buildTaskLedger(records);
  const wasteByTask = new Map();
  for (const finding of findings) {
    if (!wasteByTask.has(finding.task_id)) wasteByTask.set(finding.task_id, []);
    wasteByTask.get(finding.task_id).push(finding);
  }
  for (const row of ledger) {
    const taskFindings = wasteByTask.get(row.task_id) ?? [];
    for (const finding of taskFindings) {
      row.waste_micro_usd += finding.avoided_cost_micro_usd;
      row.finding_ids.push(finding.finding_id);
    }
  }

  const costPerSuccessMicroUsd = economics.outcomes_economics.cost_per_successful_outcome_micro_usd;

  return {
    report_type: "beetlejuice_audit_report",
    report_version: REPORT_VERSION,
    currency: "USD",
    money_unit_at_rest: "micro_usd",
    mode: meta.mode,
    provenance: {
      seam: "normalized-input",
      canonical_schema_version: CANONICAL_SCHEMA_VERSION,
      normalization_version: bundle.normalization_version,
      collector_version: bundle.collector_version,
      read_only: true,
    },
    period: economics.period,
    headline: headlineFromValues({
      tasksTotal: economics.tasks.total,
      outcomes: {
        accepted: economics.tasks.accepted,
        failed: economics.tasks.failed,
        aborted: economics.tasks.aborted,
        unresolved: economics.tasks.unresolved,
      },
      measuredMicroUsd,
      estimatedMicroUsd: economics.cost.estimated_micro_usd,
      representableMicroUsd: economics.cost.representable_total_micro_usd,
      unavailableComponents: economics.cost.unavailable_components,
      successfulOutcomes: economics.outcomes.successful,
      costPerSuccessMicroUsd,
      avoidableMicroUsd,
      wasteRatioPercent,
      savingsFindingIds,
    }),
    findings,
    waste_detection_meta: {
      rules_considered: [...WASTE_RULE_ORDER],
      rule_versions: { ...RULE_VERSIONS },
      single_claim_attribution: true,
      candidates_suppressed_for_double_counting: suppressed_for_double_counting,
      guards_abstained,
    },
    task_ledger: ledger,
    data_quality: dataQualityBundle(economics),
    diagnostics_secondary: {
      note: "Token counts are secondary diagnostics only; no savings claim derives from them.",
      executions_total: economics.diagnostics.executions_total,
      tokens_input_total: economics.diagnostics.tokens_input_total,
      tokens_output_total: economics.diagnostics.tokens_output_total,
      agents_by_family: economics.diagnostics.agents_by_family,
    },
    method: {
      internal_arithmetic:
        "exact integer micro-usd (single canonical unit with packages/core); display rounding is half-up to the cent",
      attribution: "task-level: all execution component costs attribute to the task outcome",
      waste_policy:
        "only demonstrably unavoidable-to-keep spend is reported as waste; ambiguous evidence produces no finding",
      limitations: [
        "synthetic/normalized aggregates only — raw provider payloads are rejected upstream of this surface",
        "cost bases other than 'measured' are labeled as estimated; unknown components are counted as unavailable",
        "speculative savings (e.g., cheaper-model routing) are intentionally not estimated in V1",
      ],
    },
  };
}

/* -------------------------------------------------------------------------
 * Seam B — canonical-core audit exports (TenantLedger.audit())
 * ---------------------------------------------------------------------- */

/** Sum known component cost of a serialized core task aggregate. */
function coreTaskKnownCost(taskAggregate) {
  let known = 0;
  let unknownCount = 0;
  const buckets = [
    ...Object.values(taskAggregate.executions ?? {}).flatMap((e) => Object.values(e.components ?? {})),
    ...Object.values(taskAggregate.unassignedComponents ?? {}),
  ];
  for (const bucket of buckets) {
    for (const component of bucket) {
      if (component?.cost?.known === true && Number.isInteger(component.cost.micro_usd)) {
        known += component.cost.micro_usd;
      } else {
        unknownCount += 1;
      }
    }
  }
  return { known, unknownCount };
}

/**
 * Build the SAME report model from a canonical-core export envelope.
 * Core's numbers pass through verbatim; only arithmetic identities are checked
 * (in validateCoreAuditExport) and per-task rows are grouped from exported
 * evidence. No economics are recomputed here.
 *
 * @param {object} envelope parsed JSON of a beetlejuice_core_audit_export
 * @param {{ mode: "canonical-core", classification_policy?: object }} meta
 *   `classification_policy` (optional, real-github-read-only seam): discloses
 *   the operator policy used to classify which PRs counted as agentic. Rendered
 *   when present; never synthesized for other seams.
 */
export function buildReportFromCoreAudit(envelope, meta) {
  const validation = validateCoreAuditExport(envelope);
  if (!validation.ok) {
    const error = new Error(
      `canonical-core export rejected (${validation.errors.length} error(s)); first: ${validation.errors[0].path}: ${validation.errors[0].message}`
    );
    error.code = "INVALID_CORE_AUDIT_EXPORT";
    error.validation_errors = validation.errors;
    throw error;
  }

  const { audit, analysis_period: analysisPeriod } = envelope;
  const { tasks, waste, summary } = audit;
  const totals = summary.totals;
  const cost = summary.cost;
  const coreWaste = summary.waste;

  // A2 seam: when core serialized refs only (no per-unit amounts), attach
  // explicitly UNQUANTIFIED derived units instead of rejecting genuine output.
  // `unit_breakdown_provided` keeps the two evidence shapes distinguishable.
  const findings = assignFindingIds(
    waste.findings.map((f) => ({
      source_finding_id: f.finding_id,
      rule_id: f.rule_id,
      rule_version: String(f.rule_version ?? "1"),
      canonical_rule_class: f.rule_id, // core findings ARE the canonical id space
      task_ref: f.task_ref,
      confidence: f.confidence,
      wasted_micro_usd: f.wasted_micro_usd,
      currency: "USD",
      unit_breakdown_provided: f.evidence_units !== undefined,
      evidence_units: f.evidence_units ?? deriveUnquantifiedEvidenceUnits(f),
      unquantified_evidence_refs: f.unquantified_evidence_refs ?? [],
      explanation: f.explanation,
      recommended_action: f.recommendation,
    }))
  );
  const findingsWithDerivedBreakdown = findings.filter((f) => !f.unit_breakdown_provided).length;

  const savingsFindingIds = findings.map((f) => f.finding_id);
  const measuredMicroUsd = cost.knownMicroUsd;
  const wasteRatioPercent =
    measuredMicroUsd > 0 ? Math.round((waste.certainlyAvoidableMicroUsd / measuredMicroUsd) * 100 * 100) / 100 : 0;

  const ledger = tasks.map((task) => {
    const { known, unknownCount } = coreTaskKnownCost(task);
    const taskFindings = findings.filter((f) => f.task_ref === task.taskRef);
    return {
      task_id: task.taskRef,
      outcome_status: task.outcome.kind,
      attribution: task.outcome.attribution,
      measured_micro_usd: known,
      estimated_micro_usd: 0,
      unavailable_components: unknownCount,
      waste_micro_usd: taskFindings.reduce((acc, f) => acc + f.wasted_micro_usd, 0),
      finding_ids: taskFindings.map((f) => f.finding_id),
    };
  });
  ledger.sort((a, b) => (a.task_id < b.task_id ? -1 : a.task_id > b.task_id ? 1 : 0));

  const ruleVersions = {};
  for (const f of waste.findings) ruleVersions[f.rule_id] = f.rule_version ?? 1;

  // Model-class histogram straight from exported invocation payloads (secondary diagnostic).
  const modelClasses = new Map();
  for (const task of tasks) {
    for (const execution of task.executions ?? []) {
      for (const invocation of execution.components?.modelInvocations ?? []) {
        const mc = invocation.payload?.model_class;
        if (typeof mc === "string" && mc.length > 0) {
          modelClasses.set(mc, (modelClasses.get(mc) ?? 0) + 1);
        }
      }
    }
  }

  const period = {
    from_iso: analysisPeriod?.from_iso ?? null,
    to_iso:
      analysisPeriod?.to_iso ??
      tasks.reduce((acc, t) => (t.lastTime && (!acc || Date.parse(t.lastTime) > Date.parse(acc)) ? t.lastTime : acc), null),
  };

  const dataQualityRows = Object.keys(cost.byKindMicroUsd ?? {})
    .sort()
    .map((kind) => ({
      component: kind,
      measured_micro_usd: cost.byKindMicroUsd[kind],
      measured_count: null, // per-kind known-component counts are not part of the core export
      estimated_micro_usd: null,
      estimated_count: null,
      unavailable_count: null,
    }));

  return {
    report_type: "beetlejuice_audit_report",
    report_version: REPORT_VERSION,
    currency: "USD",
    money_unit_at_rest: "micro_usd",
    mode: meta.mode,
    provenance: {
      seam: "canonical-core",
      export_type: CORE_AUDIT_EXPORT_TYPE,
      export_version: CORE_AUDIT_EXPORT_VERSION,
      producer: typeof envelope.producer === "string" ? envelope.producer : null,
      read_only: true,
    },
    period,
    ...(meta.classification_policy
      ? { classification_policy: { ...meta.classification_policy } }
      : {}),
    headline: headlineFromValues({
      tasksTotal: totals.tasks,
      outcomes: {
        accepted: totals.accepted,
        failed: totals.failed,
        aborted: totals.aborted,
        unresolved: totals.unresolved,
      },
      measuredMicroUsd,
      estimatedMicroUsd: 0,
      representableMicroUsd: measuredMicroUsd,
      unavailableComponents: cost.unknownComponentCount,
      successfulOutcomes: totals.accepted,
      costPerSuccessMicroUsd: cost.costPerAcceptedOutcomeMicroUsd,
      avoidableMicroUsd: waste.certainlyAvoidableMicroUsd,
      wasteRatioPercent,
      savingsFindingIds,
      successDefinition:
        "agentic tasks whose attributed outcome is accepted — canonical AGENTIC_TASK attribution",
    }),
    findings,
    waste_detection_meta: {
      rules_considered: Object.keys(ruleVersions).sort(),
      rule_versions: ruleVersions,
      single_claim_attribution: true,
      candidates_suppressed_for_double_counting: null, // not part of the core export contract
      guards_abstained: null, // rule-boundary guards live inside packages/core
    },
    task_ledger: ledger,
    data_quality: {
      policy:
        "canonical-core exports carry known/unknown costs only; components without billing evidence are counted but contribute $0",
      table_rows: dataQualityRows,
      findings_with_derived_unquantified_breakdown: findingsWithDerivedBreakdown,
      totals: {
        measured_micro_usd: measuredMicroUsd,
        estimated_micro_usd: 0,
        unavailable_components: cost.unknownComponentCount,
        representable_total_micro_usd: measuredMicroUsd,
      },
      accounting_balanced: cost.accountingBalanced,
    },
    diagnostics_secondary: {
      note: "Token counts are secondary diagnostics only; no savings claim derives from them. Not available in this export.",
      executions_total: null,
      tokens_input_total: null,
      tokens_output_total: null,
      model_classes: Object.fromEntries([...modelClasses.entries()].sort()),
    },
    method: {
      internal_arithmetic:
        "exact integer micro-usd consumed verbatim from packages/core TenantLedger.audit(); no recomputation on this surface",
      attribution: "core's conservative outcome attribution (merged > failed > closed-unmerged > aborted > unresolved)",
      waste_policy:
        "only core-certified certain-waste findings are rendered; this surface never manufactures findings",
      limitations: [
        "consumes a reconstructed AGENTIC_TASK aggregate export; raw provider payloads are rejected at this boundary",
        "components without billing evidence stay visible as unknown-cost counts, never guessed",
        "speculative savings (e.g., cheaper-model routing) are intentionally not estimated in V1",
      ],
    },
  };
}

/* -------------------------------------------------------------------------
 * Shared headline/data-quality assembly
 * ---------------------------------------------------------------------- */

function headlineFromValues({
  tasksTotal,
  outcomes,
  measuredMicroUsd,
  estimatedMicroUsd,
  representableMicroUsd,
  unavailableComponents,
  successfulOutcomes,
  costPerSuccessMicroUsd,
  avoidableMicroUsd,
  wasteRatioPercent,
  savingsFindingIds,
  successDefinition,
}) {
  // Audit §6 observation: rule composition over disjoint, individually proven
  // waste can legitimately reach >=100% of representable spend on an ACCEPTED
  // task. That is defensible but invites justified skepticism — surface an
  // explicit, deterministic sanity note instead of staying silent.
  const wasteAtOrAboveRepresentable = avoidableMicroUsd > 0 && avoidableMicroUsd >= representableMicroUsd;
  return {
    agentic_tasks_total: tasksTotal,
    outcomes,
    total_measured_cost_micro_usd: measuredMicroUsd,
    total_estimated_cost_micro_usd: estimatedMicroUsd,
    representable_total_cost_micro_usd: representableMicroUsd,
    cost_components_unavailable: unavailableComponents,
    successful_outcomes: successfulOutcomes,
    successful_outcome_definition:
      successDefinition ?? "agentic tasks whose attributed outcome is accepted",
    cost_per_successful_outcome_micro_usd: costPerSuccessMicroUsd,
    cost_per_successful_outcome_display_micro_usd:
      costPerSuccessMicroUsd === null ? null : roundHalfUpToCent(costPerSuccessMicroUsd),
    cost_per_successful_outcome_formula:
      costPerSuccessMicroUsd === null ? null : "representable_total_cost_micro_usd / successful_outcomes",
    certainly_avoidable_spend_micro_usd: avoidableMicroUsd,
    waste_ratio_percent_of_measured: wasteRatioPercent,
    potential_savings_certain_only_micro_usd: avoidableMicroUsd,
    potential_savings_traceability_finding_ids: savingsFindingIds,
    speculative_savings_estimate_micro_usd: null,
    speculative_savings_note: SPECULATIVE_NOTE,
    certainly_avoidable_spend_sanity_note: wasteAtOrAboveRepresentable
      ? "certainly avoidable spend covers >=100% of representable spend because independent rules claim disjoint, individually evidenced waste (e.g., superseded attempts plus duplicate CI re-runs); each claim traces to its own finding below"
      : null,
  };
}

function dataQualityBundle(economics) {
  const byComponent = economics.data_quality_by_component;
  const tableRows = Object.keys(byComponent)
    .sort()
    .map((component) => ({
      component,
      measured_micro_usd: byComponent[component].measured.micro_usd,
      measured_count: byComponent[component].measured.count,
      estimated_micro_usd: byComponent[component].estimated.micro_usd,
      estimated_count: byComponent[component].estimated.count,
      unavailable_count: byComponent[component].unavailable.count,
    }));
  return {
    policy:
      "measured and estimated costs are never merged; unavailable components are counted but contribute $0",
    table_rows: tableRows,
    by_component: byComponent,
    totals: {
      measured_micro_usd: economics.cost.measured_micro_usd,
      estimated_micro_usd: economics.cost.estimated_micro_usd,
      unavailable_components: economics.cost.unavailable_components,
      representable_total_micro_usd: economics.cost.representable_total_micro_usd,
    },
  };
}
