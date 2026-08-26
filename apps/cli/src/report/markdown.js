// Markdown renderer for the audit report model. Pure function of the report:
// identical input always yields byte-identical output (no wall-clock inside).
// Handles findings from BOTH ingestion seams:
// - seam A (normalized-input): structured `evidence[]` kinds;
// - seam B (canonical-core): core's per-unit `evidence_units[]`.

import { formatMicroUsd, formatMicroUsdDisplay, roundHalfUpToCent, formatCount } from "../money.js";

function money(microUsd) {
  return formatMicroUsd(roundHalfUpToCent(microUsd));
}

function moneyExact(microUsd) {
  return formatMicroUsd(microUsd);
}

function renderProvenance(report) {
  const p = report.provenance;
  if (p.seam === "canonical-core") {
    return `provenance: canonical-core export v${p.export_version} (${p.export_type}) · producer: ${p.producer ?? "unknown"} · read-only: ${p.read_only}`;
  }
  return `provenance: normalized-input contract v${p.canonical_schema_version} · normalization v${p.normalization_version} · collector ${p.collector_version} · read-only: ${p.read_only}`;
}

/** Deterministic disclosure of the operator classification policy (real mode). */
function renderClassificationPolicy(cp) {
  const actors = cp.bot_actors.length > 0 ? cp.bot_actors.join(", ") : "none";
  const prefixes = cp.branch_prefixes.length > 0 ? cp.branch_prefixes.join(", ") : "none";
  return `classification policy: actor allowlist [${actors}] (${cp.bot_actors_source}) · branch prefixes [${prefixes}] (${cp.branch_prefixes_source})`;
}

function renderHeadline(report) {
  const h = report.headline;
  const o = h.outcomes;
  const costPerSuccess =
    h.cost_per_successful_outcome_micro_usd === null
      ? "n/a — no successful outcomes in period"
      : `**${money(h.cost_per_successful_outcome_display_micro_usd)}** (= ${moneyExact(h.representable_total_cost_micro_usd)} representable spend ÷ ${h.successful_outcomes} accepted; exact value preserved as ${formatMicroUsd(h.cost_per_successful_outcome_micro_usd)})`;
  const savingsTrace = h.potential_savings_traceability_finding_ids.join(", ") || "—";
  const sanityNote =
    h.certainly_avoidable_spend_sanity_note === null || h.certainly_avoidable_spend_sanity_note === undefined
      ? ""
      : `\n\nSanity note: ${h.certainly_avoidable_spend_sanity_note}.`;

  return `## Headline economics (measured unless labeled)

| Metric | Value |
| --- | --- |
| Analysis period | ${report.period.from_iso ?? "?"} → ${report.period.to_iso ?? "?"} (UTC) |
| Agentic tasks analyzed | ${h.agentic_tasks_total} (${o.accepted} accepted · ${o.failed} failed · ${o.aborted} aborted · ${o.unresolved} unresolved) |
| Total measured cost | **${moneyExact(h.total_measured_cost_micro_usd)}** |
| Estimated-basis cost | ${h.total_estimated_cost_micro_usd === null ? "n/a" : moneyExact(h.total_estimated_cost_micro_usd)} |
| Unavailable cost components | ${h.cost_components_unavailable} |
| Representable spend (measured + estimated) | ${moneyExact(h.representable_total_cost_micro_usd)} |
| Successful outcomes | **${h.successful_outcomes}** (${h.successful_outcome_definition}) |
| Cost per successful outcome | ${costPerSuccess} |
| Certainly avoidable spend | **${moneyExact(h.certainly_avoidable_spend_micro_usd)}** (waste ratio ${h.waste_ratio_percent_of_measured}% of measured spend) |
| Potential savings (certain only) | **${moneyExact(h.potential_savings_certain_only_micro_usd)}** — traces to findings: ${savingsTrace} |

Speculative savings: ${h.speculative_savings_note}.
Every savings dollar above resolves to an explicit evidence-backed finding below.${sanityNote}`;
}

function renderBundleEvidence(evidence) {
  return evidence
    .map((e) => {
      switch (e.kind) {
        case "execution_cost":
          return `- execution \`${e.execution_id}\` in task \`${e.task_id}\`: ${moneyExact(e.amount_micro_usd)} USD [${e.components_summary}]`;
        case "superseded_by":
          return `- \`${e.execution_id}\` carries \`superseded_by_execution_id = ${e.superseded_by_execution_id}\``;
        case "identical_retry_of_deterministic_failure":
          return `- \`${e.retry_execution_id}\` retries \`${e.prior_execution_id}\` with identical work signature; prior failure category: \`${e.prior_failure_category}\`; retry's own recorded failure: \`${e.retry_failure_category}\``;
        case "started_after_abort":
          return `- task aborted at \`${e.aborted_at}\`; execution \`${e.execution_id}\` started later (\`${e.execution_started_at}\`)`;
        default:
          return `- ${JSON.stringify(e)}`;
      }
    })
    .join("\n");
}

function renderCoreEvidence(finding) {
  const lines = (finding.evidence_units ?? []).map(
    (u) =>
      `- evidence unit \`${u.ref}\` (kind \`${u.kind}\`): ${
        u.quantified === false || u.micro_usd === undefined
          ? "unquantified (no billing evidence)"
          : `${moneyExact(u.micro_usd)} USD`
      }`
  );
  for (const ref of finding.unquantified_evidence_refs ?? []) {
    if (!lines.some((l) => l.includes(`\`${ref}\``))) {
      lines.push(`- evidence unit \`${ref}\`: unquantified (no billing evidence)`);
    }
  }
  return lines.join("\n");
}

function renderFindings(report) {
  const meta = report.waste_detection_meta;
  let guardLines = [];
  if (meta.guards_abstained) {
    guardLines = Object.entries(meta.guards_abstained)
      .filter(([, n]) => n > 0)
      .map(([guard, n]) => `- guard abstained ${n} candidate(s): \`${guard}\` — certainty precondition not met, no finding emitted`);
  } else {
    guardLines = ["- rule-boundary guards are enforced inside packages/core for canonical-core exports"];
  }
  const guardBlock = `\n\nRule-boundary guards (conservative abstentions):\n${guardLines.join("\n")}`;

  if (report.findings.length === 0) {
    return `## Certain-waste findings (evidence)

No certain-waste findings in this period. Beetlejuice reports nothing rather than guessing.${guardBlock}`;
  }
  const blocks = report.findings.map((f) => {
    const sourceRef = f.source_finding_id ? ` (source id: \`${f.source_finding_id}\`)` : "";
    const ruleClass = f.canonical_rule_class ? ` · class \`${f.canonical_rule_class}\`` : "";
    const amountField = f.evidence_units ? f.wasted_micro_usd : f.avoided_cost_micro_usd;
    const evidence = f.evidence_units ? renderCoreEvidence(f) : renderBundleEvidence(f.evidence);
    return `### ${f.finding_id}${sourceRef} — ${f.rule_id} v${f.rule_version}${ruleClass} — ${moneyExact(amountField)} — confidence: ${f.confidence}
Why: ${f.explanation}
Evidence (tenant-scope refs only):
${evidence}
Recommended action: ${f.recommended_action}`;
  });
  return `## Certain-waste findings (evidence)

${blocks.join("\n\n")}${guardBlock}`;
}

function renderTaskLedger(report) {
  const rows = report.task_ledger
    .map((r) => {
      const outcome = r.attribution ? `${r.outcome_status} (${r.attribution})` : r.outcome_status;
      const estimated = r.estimated_micro_usd === null ? "n/a" : money(r.estimated_micro_usd);
      const unavailable = r.unavailable_components === null ? "n/a" : String(r.unavailable_components);
      return `| ${r.task_id} | ${outcome} | ${moneyExact(r.measured_micro_usd)} | ${estimated} | ${unavailable} | ${moneyExact(r.waste_micro_usd)}${r.finding_ids.length ? ` (${r.finding_ids.join(", ")})` : ""} |`;
    })
    .join("\n");
  return `## Task ledger (cost → outcome attribution)

| Task | Outcome | Measured | Estimated | Unavailable components | Certain waste |
| --- | --- | --- | --- | --- | --- |
${rows}`;
}

function renderDataQualityCell(amountKey, countKey, row) {
  const amount = row[amountKey];
  const count = row[countKey];
  const hasAmount = amount !== null && amount !== undefined;
  const hasCount = count !== null && count !== undefined;
  // A basis that never occurred (no amount, zero/absent count) renders as "—".
  if ((!hasAmount || amount === 0) && (!hasCount || count === 0)) return "—";
  if (!hasAmount) return String(count); // count-only evidence (e.g. unavailable)
  return hasCount ? `${moneyExact(amount)} (${count})` : moneyExact(amount);
}

function renderDataQuality(report) {
  const dq = report.data_quality;
  const rows = dq.table_rows
    .map(
      (row) =>
        `| ${row.component} | ${renderDataQualityCell("measured_micro_usd", "measured_count", row)} | ${renderDataQualityCell(
          "estimated_micro_usd",
          "estimated_count",
          row
        )} | ${row.unavailable_count === null ? "—" : String(row.unavailable_count)} |`
    )
    .join("\n");
  const t = dq.totals;
  const estimatedTotal = t.estimated_micro_usd === null ? "n/a" : money(t.estimated_micro_usd);
  const balancedNote = dq.accounting_balanced === undefined ? "" : `
Ledger accounting identity verified by the producing engine: inference+tools+CI+compute+validation+human = total known cost (balanced: ${dq.accounting_balanced}).`;
  const derivedBreakdownNote =
    dq.findings_with_derived_unquantified_breakdown > 0
      ? `
Per-unit cost breakdowns were not exported for ${dq.findings_with_derived_unquantified_breakdown} certain-waste finding(s); their evidence units are rendered as unquantified and their waste totals remain producer-certified (no amounts invented here).`
      : "";
  return `## Data quality (measured vs estimated vs unavailable)

Cost accounting invariant: component amounts sum exactly to execution totals (exact integer micro-usd internally).

| Component | Measured $ (count) | Estimated $ (count) | Unavailable (count) |
| --- | --- | --- | --- |
${rows}

Totals: measured ${money(t.measured_micro_usd)} · estimated ${estimatedTotal} · unavailable components ${t.unavailable_components} · representable total ${money(t.representable_total_micro_usd)}.${balancedNote}${derivedBreakdownNote}

Policy: ${dq.policy}.`;
}

function renderDiagnostics(report) {
  const d = report.diagnostics_secondary;
  const tokensLine =
    d.tokens_input_total === null
      ? "Token counts: not available in this export."
      : `Tokens across ${d.executions_total} executions: ${formatCount(d.tokens_input_total)} input / ${formatCount(d.tokens_output_total)} output.`;
  const familyLine = d.agents_by_family
    ? `Agent families: ${Object.entries(d.agents_by_family).map(([k, v]) => `${k}×${v}`).join(", ") || "—"}.`
    : `Model classes: ${Object.entries(d.model_classes ?? {}).map(([k, v]) => `${k}×${v}`).join(", ") || "—"} (from exported invocation payloads).`;
  return `## Secondary diagnostics (not economics)

${tokensLine}
${familyLine}
${d.note}`;
}

export function renderMarkdownReport(report) {
  const modeLines = {
    "synthetic-demo": "synthetic demo — bundled fixture, no GitHub credentials used",
    "normalized-input": "normalized-input mode — consumes adapter-normalized canonical records only",
    "canonical-core": "canonical-core mode — consumes a versioned packages/core TenantLedger.audit() export (one canonical model)",
    "real-github-read-only": "real-github-read-only mode — live read-only history audit of a configured repository (GET requests only; no writes performed)",
  };

  return `# Beetlejuice Audit — Agentic Economics Report

mode: ${modeLines[report.mode] ?? report.mode}
${renderProvenance(report)}
${report.classification_policy ? renderClassificationPolicy(report.classification_policy) : ""}

${renderHeadline(report)}

${renderFindings(report)}

${renderTaskLedger(report)}

${renderDataQuality(report)}

${renderDiagnostics(report)}

## Method & limitations

- internal arithmetic: ${report.method.internal_arithmetic}
- attribution: ${report.method.attribution}
- waste policy: ${report.method.waste_policy}
Limitations:
${report.method.limitations.map((l) => `- ${l}`).join("\n")}
`;
}

export function renderJsonReport(report) {
  // Fixed key order from construction => deterministic serialization.
  return `${JSON.stringify(report, null, 2)}\n`;
}
