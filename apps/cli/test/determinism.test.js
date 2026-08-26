import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  buildAuditReport,
  buildReportFromCoreAudit,
  renderMarkdownReport,
  renderJsonReport,
} from "../src/index.js";
import { loadSyntheticFixture } from "../src/synthetic.js";

const CORE_EXPORT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/core-audit-export-v1.json"
);

function coreEnvelope() {
  return JSON.parse(readFileSync(CORE_EXPORT_PATH, "utf8"));
}

test("identical input produces byte-identical reports in BOTH seams", () => {
  // Seam A.
  const fixture = loadSyntheticFixture();
  const a = buildAuditReport(structuredClone(fixture), { mode: "synthetic-demo" });
  const b = buildAuditReport(structuredClone(fixture), { mode: "synthetic-demo" });
  assert.equal(renderJsonReport(a), renderJsonReport(b));
  assert.equal(renderMarkdownReport(a), renderMarkdownReport(b));

  // Record order within the bundle must not change the rendered output.
  const shuffled = structuredClone(fixture);
  shuffled.records = [...shuffled.records].reverse();
  const c = buildAuditReport(shuffled, { mode: "synthetic-demo" });
  assert.equal(renderJsonReport(c), renderJsonReport(a));

  // Seam B.
  const ca = buildReportFromCoreAudit(coreEnvelope(), { mode: "canonical-core" });
  const cb = buildReportFromCoreAudit(coreEnvelope(), { mode: "canonical-core" });
  assert.equal(renderJsonReport(ca), renderJsonReport(cb));
  assert.equal(renderMarkdownReport(ca), renderMarkdownReport(cb));
});

test("public API is reusable without the CLI (dashboard/server surface)", () => {
  const report = buildAuditReport(loadSyntheticFixture(), { mode: "normalized-input" });
  const parsed = JSON.parse(renderJsonReport(report));
  assert.equal(parsed.report_version, "2");
  assert.equal(parsed.headline.agentic_tasks_total, 6);

  const core = JSON.parse(renderJsonReport(buildReportFromCoreAudit(coreEnvelope(), { mode: "canonical-core" })));
  assert.equal(core.report_type, "beetlejuice_audit_report");
  assert.equal(core.mode, "canonical-core");
});
