// A2 seam advancement (factory cycle probe E9/E10): genuine
// `TenantLedger.audit()` JSON serializes findings with `evidence_refs` but NO
// per-unit `evidence_units`. The product surface must render that output
// instead of rejecting it — without inventing money. These tests pin the
// contract: accept + derive UNQUANTIFIED units + flag the gap in data quality,
// while every producer-certified total passes through verbatim.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateCoreAuditExport, deriveUnquantifiedEvidenceUnits } from "../src/core_audit.js";
import { buildReportFromCoreAudit } from "../src/audit.js";
import { renderMarkdownReport, renderJsonReport } from "../src/report/markdown.js";
import { runCli } from "../src/demo.js";

const CORE_EXPORT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/core-audit-export-v1.json"
);

function coreEnvelope() {
  return JSON.parse(readFileSync(CORE_EXPORT_PATH, "utf8"));
}

/** Shape of a genuine core serialization: refs only, no per-unit breakdowns. */
function genuineShapedEnvelope() {
  const env = coreEnvelope();
  for (const f of env.audit.waste.findings) delete f.evidence_units;
  return env;
}

function captureIo(run) {
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  let out = "";
  let err = "";
  process.stdout.write = (chunk) => {
    out += chunk.toString();
    return true;
  };
  process.stderr.write = (chunk) => {
    err += chunk.toString();
    return true;
  };
  return Promise.resolve()
    .then(run)
    .finally(() => {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    })
    .then((result) => ({ result, out, err }));
}

test("genuine-shaped core export (refs, no evidence_units) validates", () => {
  const { ok, errors, audit } = validateCoreAuditExport(genuineShapedEnvelope());
  assert.equal(ok, true, JSON.stringify(errors, null, 2));
  assert.equal(audit.summary.cost.knownMicroUsd, 12_650_000);
});

test("derived units are unquantified placeholders — never invented amounts", () => {
  const finding = { evidence_refs: ["m4", "c9"], unquantified_evidence_refs: ["x7"] };
  assert.deepEqual(deriveUnquantifiedEvidenceUnits(finding), [
    { ref: "m4", kind: "unspecified", micro_usd: null, quantified: false },
    { ref: "c9", kind: "unspecified", micro_usd: null, quantified: false },
    { ref: "x7", kind: "unspecified", micro_usd: null, quantified: false },
  ]);
});

test("report from genuine-shaped export keeps certified totals verbatim and marks derived breakdowns", () => {
  const quantified = buildReportFromCoreAudit(coreEnvelope(), { mode: "canonical-core" });
  const derived = buildReportFromCoreAudit(genuineShapedEnvelope(), { mode: "canonical-core" });

  // Headline economics are identical — derivation touches evidence shape only.
  assert.deepEqual(derived.headline, quantified.headline);

  for (const f of derived.findings) {
    assert.equal(f.unit_breakdown_provided, false);
    assert.ok(f.evidence_units.length > 0);
    for (const u of f.evidence_units) {
      assert.equal(u.micro_usd, null);
      assert.equal(u.quantified, false);
    }
  }
  // Producer-provided units keep their provenance flag.
  for (const f of quantified.findings) assert.equal(f.unit_breakdown_provided, true);

  assert.equal(derived.data_quality.findings_with_derived_unquantified_breakdown, 3);
  assert.equal(quantified.data_quality.findings_with_derived_unquantified_breakdown, 0);

  const md = renderMarkdownReport(derived);
  assert.match(md, /unquantified \(no billing evidence\)/);
  assert.match(md, /Per-unit cost breakdowns were not exported for 3 certain-waste finding/);
  assert.doesNotMatch(renderMarkdownReport(quantified), /Per-unit cost breakdowns were not exported/);

  // Determinism on the derived path.
  const again = buildReportFromCoreAudit(genuineShapedEnvelope(), { mode: "canonical-core" });
  assert.equal(renderJsonReport(derived), renderJsonReport(again));
  assert.equal(renderMarkdownReport(derived), renderMarkdownReport(again));
});

test("CLI renders a genuine-shaped TenantLedger.audit() export end-to-end (E9 regression)", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "beetlejuice-a2-"));
  try {
    const input = path.join(dir, "genuine-core-audit.json");
    writeFileSync(input, JSON.stringify(genuineShapedEnvelope()));
    let code;
    let out;
    await captureIo(async () => {
      code = await runCli(["--core-audit", input]);
    }).then((io) => {
      out = io.out;
    });
    assert.equal(code, 0); // exit 0 — previously exit 2 (A2 seam break)
    assert.match(out, /canonical-core/);
    assert.match(out, /\$12\.65/); // measured cost leads
    assert.match(out, /WASTE_DET_RETRY_V1/);
    assert.match(out, /unquantified \(no billing evidence\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a certain-waste claim without ANY evidence ref is still rejected", () => {
  const env = genuineShapedEnvelope();
  const f = env.audit.waste.findings[0];
  f.evidence_refs = [];
  f.unquantified_evidence_refs = [];
  const { ok, errors } = validateCoreAuditExport(env);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.path.endsWith(".evidence_units")));
});

test("non-string evidence refs are rejected under both unit shapes", () => {
  {
    const env = genuineShapedEnvelope();
    env.audit.waste.findings[0].evidence_refs = [42];
    assert.equal(validateCoreAuditExport(env).ok, false);
  }
  {
    const env = coreEnvelope(); // units present; refs must still be well-typed
    env.audit.waste.findings[0].unquantified_evidence_refs = [null];
    assert.equal(validateCoreAuditExport(env).ok, false);
  }
});

test("sanity note appears when certainly avoidable spend covers >= representable spend", () => {
  // Standard fixture: waste < known cost -> no note.
  const normal = buildReportFromCoreAudit(coreEnvelope(), { mode: "canonical-core" });
  assert.equal(normal.headline.certainly_avoidable_spend_sanity_note, null);
  assert.doesNotMatch(renderMarkdownReport(normal), /Sanity note:/);

  // Craft an export whose certain waste equals total known cost (audit §6 case).
  const env = genuineShapedEnvelope();
  const w = env.audit.waste;
  const delta = env.audit.summary.cost.knownMicroUsd - w.certainlyAvoidableMicroUsd;
  w.findings[0].wasted_micro_usd += delta;
  w.certainlyAvoidableMicroUsd = env.audit.summary.cost.knownMicroUsd;
  env.audit.summary.waste.certainlyAvoidableMicroUsd = w.certainlyAvoidableMicroUsd;
  env.audit.summary.waste.ratioOfKnownCost = 1;

  const report = buildReportFromCoreAudit(env, { mode: "canonical-core" });
  assert.match(
    report.headline.certainly_avoidable_spend_sanity_note,
    /covers >=100% of representable spend/
  );
  const md = renderMarkdownReport(report);
  assert.match(md, /Sanity note: certainly avoidable spend covers >=100%/);
});
