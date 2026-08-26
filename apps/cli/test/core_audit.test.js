import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  validateCoreAuditExport,
} from "../src/core_audit.js";
import { buildReportFromCoreAudit } from "../src/audit.js";

const CORE_EXPORT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/core-audit-export-v1.json"
);

function coreEnvelope() {
  return JSON.parse(readFileSync(CORE_EXPORT_PATH, "utf8"));
}

// The golden fixture is a GENUINE TenantLedger.audit() export produced by
// running the packages/core snapshot on a synthetic event stream — the shape
// under test is measured, not invented.
test("genuine core audit export validates and carries balanced accounting", () => {
  const { ok, errors, audit } = validateCoreAuditExport(coreEnvelope());
  assert.equal(ok, true, JSON.stringify(errors, null, 2));
  assert.equal(audit.summary.cost.accountingBalanced, true);
  assert.equal(audit.summary.cost.knownMicroUsd, 12_650_000);
});

test("core numbers pass through verbatim into the report headline (no recomputation)", () => {
  const envelope = coreEnvelope();
  const report = buildReportFromCoreAudit(envelope, { mode: "canonical-core" });
  const s = envelope.audit.summary;
  assert.equal(report.headline.total_measured_cost_micro_usd, s.cost.knownMicroUsd);
  assert.equal(report.headline.successful_outcomes, s.totals.accepted);
  assert.equal(
    report.headline.cost_per_successful_outcome_micro_usd,
    s.cost.costPerAcceptedOutcomeMicroUsd
  );
  assert.equal(
    report.headline.certainly_avoidable_spend_micro_usd,
    envelope.audit.waste.certainlyAvoidableMicroUsd
  );
  assert.deepEqual(report.headline.outcomes, {
    accepted: s.totals.accepted,
    failed: s.totals.failed,
    aborted: s.totals.aborted,
    unresolved: s.totals.unresolved,
  });
});

test("core findings keep their rule ids and gain traceable display ids", () => {
  const report = buildReportFromCoreAudit(coreEnvelope(), { mode: "canonical-core" });
  assert.equal(report.findings.length, 3);
  assert.deepEqual(
    report.findings.map((f) => [f.finding_id, f.rule_id]),
    [
      ["F-001", "WASTE_DET_RETRY_V1"],
      ["F-002", "WASTE_DUP_CI_V1"],
      ["F-003", "WASTE_EXEC_SUPERSEDED_V1"],
    ]
  );
  for (const f of report.findings) {
    assert.ok(f.source_finding_id.startsWith(f.rule_id));
    assert.equal(f.canonical_rule_class, f.rule_id); // core ids ARE the canonical space
    assert.ok(Array.isArray(f.evidence_units) && f.evidence_units.length > 0);
    assert.ok(f.recommended_action.length > 10);
  }
  // Traceability covers every finding.
  assert.deepEqual(
    report.headline.potential_savings_traceability_finding_ids,
    report.findings.map((f) => f.finding_id)
  );
});

test("task ledger groups exported evidence without dropping money", () => {
  const report = buildReportFromCoreAudit(coreEnvelope(), { mode: "canonical-core" });
  const ledgerSum = report.task_ledger.reduce((a, r) => a + r.measured_micro_usd, 0);
  assert.equal(ledgerSum, 12_650_000); // equals summary known cost — no money lost in grouping
  const wasteSum = report.task_ledger.reduce((a, r) => a + r.waste_micro_usd, 0);
  assert.equal(wasteSum, report.headline.certainly_avoidable_spend_micro_usd);
  const delta = report.task_ledger.find((r) => r.task_id === "task-delta");
  assert.equal(delta.unavailable_components, 1); // unbilled validation stays visible
});

test("period comes from the envelope when present, else derives from task lastTime", () => {
  const report = buildReportFromCoreAudit(coreEnvelope(), { mode: "canonical-core" });
  assert.equal(report.period.from_iso, "2026-08-03T09:00:00Z");
  assert.equal(report.period.to_iso, "2026-08-07T15:00:00Z");

  const stripped = coreEnvelope();
  delete stripped.analysis_period;
  const fallback = buildReportFromCoreAudit(stripped, { mode: "canonical-core" });
  assert.equal(fallback.period.from_iso, null);
  assert.equal(fallback.period.to_iso, "2026-08-07T15:00:00Z"); // max lastTime among tasks
});

test("tampered exports are rejected by arithmetic identity checks", () => {
  const cases = [];
  {
    const e = coreEnvelope();
    e.audit.waste.certainlyAvoidableMicroUsd += 1;
    cases.push(["certainlyAvoidable sum identity", e]);
  }
  {
    const e = coreEnvelope();
    e.audit.summary.waste.certainlyAvoidableMicroUsd -= 100;
    cases.push(["summary waste mirror", e]);
  }
  {
    const e = coreEnvelope();
    e.audit.summary.cost.costPerAcceptedOutcomeMicroUsd = 42;
    cases.push(["cost-per-outcome identity", e]);
  }
  {
    const e = coreEnvelope();
    e.audit.summary.cost.accountingBalanced = false;
    cases.push(["unbalanced ledger refusal", e]);
  }
  {
    const e = coreEnvelope();
    e.audit.summary.totals.accepted += 1; // now counts exceed aggregates
    cases.push(["totals vs aggregates", e]);
  }
  {
    const e = coreEnvelope();
    e.export_version = "9";
    cases.push(["export version", e]);
  }
  {
    const e = coreEnvelope();
    e.audit.waste.findings[0].confidence = "speculative";
    cases.push(["non-certain confidence", e]);
  }
      {
        const e = coreEnvelope();
        // A2 seam tolerance: units missing BUT refs present is now accepted
        // (covered positively in core_seam.test.js). A certain-waste claim
        // with NO evidence trail at all stays rejected.
        delete e.audit.waste.findings[0].evidence_units;
        e.audit.waste.findings[0].evidence_refs = [];
        e.audit.waste.findings[0].unquantified_evidence_refs = [];
        cases.push(["finding without any evidence ref", e]);
      }

  for (const [name, envelope] of cases) {
    const result = validateCoreAuditExport(envelope);
    assert.equal(result.ok, false, `expected rejection: ${name}`);
    assert.ok(result.errors.length > 0, `${name} must produce an error`);
  }
});

test("raw provider payloads inside a core export are rejected at the boundary", () => {
  const e = coreEnvelope();
  e.audit.tasks[0].workflow_run = { id: 987654321 };
  const result = validateCoreAuditExport(e);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((err) => err.path.includes("workflow_run")));
});
