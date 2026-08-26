import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAuditReport } from "../src/audit.js";
import { renderMarkdownReport, renderJsonReport } from "../src/report/markdown.js";
import { loadSyntheticFixture } from "../src/synthetic.js";

function syntheticReport() {
  return buildAuditReport(loadSyntheticFixture(), { mode: "synthetic-demo" });
}

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
