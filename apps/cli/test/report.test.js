import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAuditReport, buildReportFromCoreAudit } from "../src/audit.js";
import { renderMarkdownReport, renderJsonReport } from "../src/report/markdown.js";
import { loadSyntheticFixture } from "../src/synthetic.js";

function syntheticReport() {
  return buildAuditReport(loadSyntheticFixture(), { mode: "synthetic-demo" });
}

/* -------------------------------------------------------------------------
 * LIVE-REPORT-ZERO-DOLLARS (product audit §6): an audit whose representable
 * spend is $0 WHILE cost components were supplied without billing evidence
 * must disclose "no measurable cost evidence supplied" at headline position
 * instead of printing $0.00 (which reads as a MEASURED zero-cost audit).
 * A genuinely measured $0 (zero unavailable components) keeps $0.00.
 * ---------------------------------------------------------------------- */

const ALL_COMPONENT_KEYS = ["inference", "tools", "ci", "compute"];

function componentsWhere(valueFor) {
  return Object.fromEntries(ALL_COMPONENT_KEYS.map((key) => [key, valueFor(key)]));
}

function makeExecution(executionId, components) {
  const total = Object.values(components)
    .filter((c) => c.basis !== "unavailable")
    .reduce((acc, c) => acc + c.amount_micro_usd, 0);
  return {
    execution_id: executionId,
    agent: { family: "coding-agent", model_class: "frontier" },
    started_at: "2026-08-01T10:00:00Z",
    ended_at: "2026-08-01T10:30:00Z",
    components,
    total_amount_micro_usd: total,
  };
}

function makeTask(taskId, executions, status = "accepted") {
  return {
    record_type: "agentic_task",
    task_id: taskId,
    started_at: "2026-08-01T09:00:00Z",
    ended_at: "2026-08-01T11:00:00Z",
    outcome: { status },
    executions,
  };
}

function bundleOf(records) {
  return {
    schema_version: "2",
    normalization_version: "1",
    collector_version: "report-test-1.0.0",
    records,
  };
}

function headlineSlice(markdown) {
  return markdown.slice(markdown.indexOf("## Headline economics"), markdown.indexOf("## Certain-waste"));
}

test("zero-evidence audit discloses 'no measurable cost evidence supplied' instead of $0.00 headlines", () => {
  const unavailable = { basis: "unavailable", amount_micro_usd: null };
  const report = buildAuditReport(
    bundleOf([makeTask("ZT-001", [makeExecution("ZE-001", componentsWhere(() => unavailable))])]),
    { mode: "normalized-input" }
  );
  assert.equal(report.headline.representable_total_cost_micro_usd, 0);
  assert.equal(report.headline.cost_components_unavailable, 4);
  assert.equal(report.headline.successful_outcomes, 1);
  assert.equal(report.headline.no_measurable_cost_evidence_supplied, true);
  assert.match(report.headline.no_measurable_cost_evidence_note, /4 cost component\(s\)/);

  const headline = headlineSlice(renderMarkdownReport(report));
  for (const needle of [
    "| Total measured cost | no measurable cost evidence supplied |",
    "| Representable spend (measured + estimated) | no measurable cost evidence supplied |",
    "| Cost per successful outcome | no measurable cost evidence supplied |",
    "Cost evidence note:",
  ]) {
    assert.ok(headline.includes(needle), `headline must include: ${needle}`);
  }
  // The misleading numeric claims are gone from exactly those three cells…
  assert.ok(!headline.includes("| Total measured cost | **$0.00** |"));
  assert.ok(!headline.includes("**$0.00** (= $0.00 representable spend ÷ 1 accepted"));
  // …while the rest of the numeric table stays unchanged.
  assert.ok(headline.includes("| Unavailable cost components | 4 |"));
  assert.ok(headline.includes("| Successful outcomes | **1** "));
  assert.ok(headline.includes("| Certainly avoidable spend | **$0.00** (waste ratio 0% of measured spend) |"));

  // Machine consumers keep exact numbers AND gain the explicit flag.
  const parsed = JSON.parse(renderJsonReport(report));
  assert.equal(parsed.headline.no_measurable_cost_evidence_supplied, true);
  assert.equal(typeof parsed.headline.no_measurable_cost_evidence_note, "string");
  assert.equal(parsed.headline.total_measured_cost_micro_usd, 0);
});

test("a genuinely free audit still renders $0.00 (zero is a measurement, not an absence)", () => {
  const free = { basis: "measured", amount_micro_usd: 0 };
  const report = buildAuditReport(
    bundleOf([makeTask("ZT-002", [makeExecution("ZE-002", componentsWhere(() => free))])]),
    { mode: "normalized-input" }
  );
  assert.equal(report.headline.total_measured_cost_micro_usd, 0);
  assert.equal(report.headline.cost_components_unavailable, 0);
  assert.equal(report.headline.no_measurable_cost_evidence_supplied, false);
  assert.equal(report.headline.no_measurable_cost_evidence_note, null);

  const headline = headlineSlice(renderMarkdownReport(report));
  assert.ok(headline.includes("| Total measured cost | **$0.00** |"));
  assert.ok(
    headline.includes("**$0.00** (= $0.00 representable spend ÷ 1 accepted; exact value preserved as $0.00)")
  );
  assert.ok(!headline.includes("no measurable cost evidence supplied"));
  assert.ok(!headline.includes("Cost evidence note:"));
});

test("partial evidence keeps numeric headlines even when some components are unavailable", () => {
  const report = syntheticReport(); // measured > 0 with one unavailable ci component
  assert.equal(report.headline.no_measurable_cost_evidence_supplied, false);
  assert.equal(report.headline.no_measurable_cost_evidence_note, null);
  const headline = headlineSlice(renderMarkdownReport(report));
  assert.ok(headline.includes("| Total measured cost | **$28.57** |"));
  assert.ok(headline.includes("| Unavailable cost components | 1 |"));
  assert.ok(!headline.includes("no measurable cost evidence supplied"));
});

test("zero-evidence audit without accepted outcomes keeps n/a per-outcome wording but discloses absent costs", () => {
  const unavailable = { basis: "unavailable", amount_micro_usd: null };
  const report = buildAuditReport(
    bundleOf([makeTask("ZT-003", [makeExecution("ZE-003", componentsWhere(() => unavailable))], "unresolved")]),
    { mode: "normalized-input" }
  );
  assert.equal(report.headline.cost_per_successful_outcome_micro_usd, null);
  assert.equal(report.headline.no_measurable_cost_evidence_supplied, true);

  const headline = headlineSlice(renderMarkdownReport(report));
  assert.ok(headline.includes("| Total measured cost | no measurable cost evidence supplied |"));
  assert.ok(headline.includes("| Cost per successful outcome | n/a — no successful outcomes in period |"));
  assert.ok(headline.includes("Cost evidence note:"));
});

test("canonical-core zero-known-cost export (the real-github-read-only shape) renders the same disclosure", () => {
  // Minimal valid TenantLedger.audit()-export envelope mirroring what real
  // GitHub mode produces without operator-supplied usage records: outcomes
  // reconstruct fine while every cost component stays unknown to core.
  const envelope = {
    export_type: "beetlejuice_core_audit_export",
    export_version: "1",
    producer: "report-test zero-billing core export",
    analysis_period: { from_iso: "2026-08-01T00:00:00Z", to_iso: "2026-08-02T00:00:00Z" },
    audit: {
      tasks: [
        {
          taskRef: "task-zero-billing",
          outcome: { kind: "accepted", attribution: "merged" },
          lastTime: "2026-08-01T12:00:00Z",
        },
      ],
      waste: { findings: [], certainlyAvoidableMicroUsd: 0 },
      summary: {
        totals: { accepted: 1, failed: 0, aborted: 0, unresolved: 0 },
        cost: {
          currency: "USD",
          unit: "micro_usd",
          knownMicroUsd: 0,
          accountingBalanced: true,
          costPerAcceptedOutcomeMicroUsd: 0,
          unknownComponentCount: 3,
          byKindMicroUsd: {},
        },
        waste: { findingsCount: 0, certainlyAvoidableMicroUsd: 0 },
      },
    },
  };

  const report = buildReportFromCoreAudit(envelope, { mode: "canonical-core" });
  assert.equal(report.headline.total_measured_cost_micro_usd, 0);
  assert.equal(report.headline.cost_components_unavailable, 3);
  assert.equal(report.headline.successful_outcomes, 1);
  assert.equal(report.headline.no_measurable_cost_evidence_supplied, true);

  const headline = headlineSlice(renderMarkdownReport(report));
  assert.ok(headline.includes("| Total measured cost | no measurable cost evidence supplied |"));
  assert.ok(headline.includes("| Cost per successful outcome | no measurable cost evidence supplied |"));
  assert.ok(!headline.includes("**$0.00** (= $0.00 representable spend ÷ 1 accepted"));
});

test("headline leads with economics: cost, successful outcomes, cost/success, avoidable spend", () => {
  const md = renderMarkdownReport(syntheticReport());
  const headline = md.slice(md.indexOf("## Headline economics"), md.indexOf("## Certain-waste"));
  for (const needle of [
    "| Total measured cost | **$28.57** |",
    "| Successful outcomes | **2** (agentic tasks whose attributed outcome is accepted) |",
    "**$15.09**",
    "| Certainly avoidable spend | **$8.99** (waste ratio 31.47% of measured spend) |",
    "| Potential savings (certain only) | **$8.99** — traces to findings: F-001, F-002, F-003, F-004 |",
    "$1.60", // estimated-basis cost surfaced next to measured
  ]) {
    assert.ok(headline.includes(needle), `headline must include: ${needle}`);
  }
});

test("cost per successful outcome shows the display value AND preserves the exact value", () => {
  const report = syntheticReport();
  assert.equal(report.headline.cost_per_successful_outcome_micro_usd, 15_085_000);
  assert.equal(report.headline.cost_per_successful_outcome_display_micro_usd, 15_090_000);
  const md = renderMarkdownReport(report);
  assert.ok(md.includes("**$15.09**"));
  assert.ok(md.includes("$15.085")); // exact value never hidden
  assert.equal(
    report.headline.cost_per_successful_outcome_formula,
    "representable_total_cost_micro_usd / successful_outcomes"
  );
});

test("token counts never appear in the headline section (secondary diagnostics only)", () => {
  const md = renderMarkdownReport(syntheticReport());
  const headline = md.slice(md.indexOf("## Headline economics"), md.indexOf("## Certain-waste"));
  assert.ok(!headline.toLowerCase().includes("token"), "tokens must not lead the report");
  const diag = md.slice(md.indexOf("## Secondary diagnostics"), md.indexOf("## Method & limitations"));
  assert.ok(diag.includes("434,000 input / 39,700 output"));
});

test("every savings number traces to explicit evidence-backed findings", () => {
  const report = syntheticReport();
  const sum = report.findings.reduce((acc, f) => acc + f.avoided_cost_micro_usd, 0);
  assert.equal(report.headline.certainly_avoidable_spend_micro_usd, sum);
  assert.equal(report.headline.potential_savings_certain_only_micro_usd, sum);
  assert.equal(report.findings.length, 4);
  assert.deepEqual(
    report.headline.potential_savings_traceability_finding_ids,
    report.findings.map((f) => f.finding_id)
  );
  assert.equal(report.headline.speculative_savings_estimate_micro_usd, null);
});

test("findings section explains exactly why each amount is waste (with canonical class)", () => {
  const md = renderMarkdownReport(syntheticReport());
  for (const [id, usd] of [
    ["F-001", "$4.15"],
    ["F-002", "$1.83"],
    ["F-003", "$2.07"],
    ["F-004", "$0.94"],
  ]) {
    const section = md.slice(md.indexOf(`### ${id}`));
    const end = section.indexOf("\n### ", 1);
    const block = end === -1 ? section : section.slice(0, end);
    assert.ok(block.includes(usd), `${id} must show ${usd}`);
    assert.ok(block.includes("confidence: certain"));
    assert.ok(block.includes("Evidence (tenant-scope refs only):"));
    assert.ok(block.includes("Recommended action:"));
  }
  // Unified rule-class vocabulary appears next to seam-A rules.
  assert.ok(md.includes("class `WASTE_EXEC_SUPERSEDED_V1`"));
  assert.ok(md.includes("class `WASTE_DET_RETRY_V1`"));
});

test("data-quality section separates measured / estimated / unavailable", () => {
  const md = renderMarkdownReport(syntheticReport());
  const dq = md.slice(md.indexOf("## Data quality"), md.indexOf("## Secondary diagnostics"));
  for (const needle of [
    "| inference | $19.35 (12) | $1.60 (1) | 0 |",
    "| ci | $5.10 (10) | — | 1 |",
  ]) {
    assert.ok(dq.includes(needle), `data-quality table must include: ${needle}`);
  }
});

test("task ledger attributes waste to the right tasks only (micro-USD)", () => {
  const report = syntheticReport();
  const byTask = Object.fromEntries(report.task_ledger.map((r) => [r.task_id, r]));
  assert.equal(byTask["T-001"].waste_micro_usd, 0);
  assert.equal(byTask["T-002"].waste_micro_usd, 4_150_000);
  assert.equal(byTask["T-003"].waste_micro_usd, 1_830_000);
  assert.equal(byTask["T-004"].waste_micro_usd, 3_010_000); // 2_070_000 + 940_000
  assert.equal(byTask["T-005"].waste_micro_usd, 0);
  assert.equal(byTask["T-006"].waste_micro_usd, 0);
  // Ledger waste equals headline avoidable spend.
  const ledgerSum = report.task_ledger.reduce((a, r) => a + r.waste_micro_usd, 0);
  assert.equal(ledgerSum, report.headline.certainly_avoidable_spend_micro_usd);
});

test("report declares provenance versions, money unit and read-only posture", () => {
  const report = syntheticReport();
  assert.equal(report.provenance.canonical_schema_version, "2");
  assert.equal(report.provenance.normalization_version, "1");
  assert.equal(report.provenance.collector_version, "synthetic-fixture-1.0.0");
  assert.equal(report.provenance.read_only, true);
  assert.equal(report.money_unit_at_rest, "micro_usd");
});
