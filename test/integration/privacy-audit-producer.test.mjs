// Integration e2e (audit finding A10 closure): the producer mapping from
// canonical tenant analytics into the privacy gate must work against the REAL
// core ledger output — not just replicated fixture shapes.
//
//   @beetlejuice/core TenantLedger (synthetic events)
//     -> audit() task aggregates
//     -> @beetlejuice/privacy mapAuditTaskToPrivacyInput()
//     -> normalizeTenantRecord() [fail-closed gate]
//     -> exportGlobalLearningRecords() [cohort floors + purpose gating]
//
// Pinned contracts:
//   - every identifier-bearing field of the aggregate (task refs, execution
//     refs, revision keys, adapter names, timestamps) is absent from the GLR;
//   - the gate stays fail-closed: unknown keys / bad enums never admit;
//   - rare combinations from one small tenant are SUPPRESSED by the cohort
//     floor rather than exported (re-identification defense on real data);
//   - identical economics from different tenant ledgers produce byte-identical
//     records (unlinkable by default).

import { test } from "node:test";
import assert from "node:assert/strict";

let core = null;
let privacy = null;
let loadError = null;
try {
  core = await import("@beetlejuice/core");
  privacy = await import("@beetlejuice/privacy");
} catch (error) {
  loadError = error;
}

const SKIP =
  "@beetlejuice/core and/or @beetlejuice/privacy are not mounted on this lane checkout; the tenant->privacy producer seam executes on integrated trees only";

/** Build a real ledger from the core synthetic fixture. */
async function buildLedger(tenantKey) {
  const gen = await import("../../packages/core/fixtures/synthetic/generate.js");
  const ledger = new core.TenantLedger(tenantKey);
  ledger.appendAll(gen.buildSyntheticEvents());
  return ledger;
}

test("sibling packages present or absence explicit", () => {
  if (core !== null && privacy !== null) {
    assert.equal(typeof core.TenantLedger, "function");
    assert.equal(typeof privacy.mapAuditTaskToPrivacyInput, "function");
    assert.equal(typeof privacy.exportGlobalLearningRecords, "function");
  } else {
    assert.equal(loadError?.code ?? "ERR_MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND");
    console.log(`[skip] ${SKIP}`);
  }
});

test(
  "real TenantLedger aggregates map through the gate to a cohort-suppressed global export",
  { skip: core === null || privacy === null ? SKIP : false },
  async () => {
    const ledger = await buildLedger("tenant-integration-demo");
    const audit = ledger.audit();
    assert.ok(audit.tasks.length > 0, "fixture must reconstruct tasks");

    // --- Producer mapping + fail-closed normalization -----------------------
    const records = [];
    for (const task of audit.tasks) {
      const input = privacy.mapAuditTaskToPrivacyInput(task, {
        task_class: "bug_fix",
        language_family: "javascript_typescript",
      });
      const res = privacy.normalizeTenantRecord(input);
      assert.equal(res.status, "ok", `mapping must produce a gate-admissible record: ${JSON.stringify(res.entry ?? {})}`);
      records.push(res.record);
    }
    assert.equal(records.length, audit.tasks.length);

    // No identifiers from the tenant aggregate survive the mapping.
    const serialized = JSON.stringify(records);
    for (const taskRef of audit.tasks.map((t) => t.taskRef)) {
      assert.ok(!serialized.includes(String(taskRef)), `task ref ${taskRef} must not reach the global layer`);
    }

    // --- Purpose-gated export ----------------------------------------------
    const out = privacy.exportGlobalLearningRecords({
      records,
      purpose: "GLOBAL_BENCHMARK_CONTRIBUTION",
      licenseAcknowledged: true,
    });
    assert.equal(out.purpose, "GLOBAL_BENCHMARK_CONTRIBUTION");
    assert.equal(out.counts.rejected, 0, "well-formed mapped records must not be rejected");

    // Cohort floor on a single small tenant: near-unique abstract rows are
    // suppressed instead of exported — re-identification defense on REAL data.
    assert.equal(out.counts.provided, records.length);
    assert.equal(out.accepted.length + out.suppressed.length, records.length);
    assert.equal(out.accepted.length, 0, "a 10-task homogeneous tenant must not meet the k-floor alone");
    assert.ok(out.suppressed.length >= 1);
    assert.ok(out.privacy_risk.risk_level, "risk report must explain the decision");

    // Export envelope carries no source content at all.
    const envelopeJson = JSON.stringify(out);
    for (const marker of ["T-0", "e-0", "rev-", "acme", "forge/", "2026-08"]) {
      assert.ok(!envelopeJson.includes(marker), `source-scope marker "${marker}" must not appear in the export`);
    }
  }
);

test(
  "identical economics from two tenants produce byte-identical global records",
  { skip: core === null || privacy === null ? SKIP : false },
  async () => {
    const a = await buildLedger("tenant-A-marker");
    const b = await buildLedger("tenant-B-marker");
    const map = async (ledger) => {
      const recs = [];
      for (const t of ledger.audit().tasks) {
        const res = privacy.normalizeTenantRecord(
          privacy.mapAuditTaskToPrivacyInput(t, { task_class: "bug_fix", language_family: "javascript_typescript" })
        );
        if (res.status === "ok") recs.push(res.record);
      }
      return recs.sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
    };
    const [ra, rb] = await Promise.all([map(a), map(b)]);
    assert.equal(ra.length, rb.length);
    assert.equal(JSON.stringify(ra), JSON.stringify(rb), "global records must be unlinkable to their tenant");
  }
);

test(
  "gate rejects poisoned hints and unknown keys even through the sanctioned producer",
  { skip: core === null || privacy === null ? SKIP : false },
  async () => {
    const ledger = await buildLedger("tenant-poison-probe");
    const task = ledger.audit().tasks[0];

    const poisoned = privacy.normalizeTenantRecord(
      privacy.mapAuditTaskToPrivacyInput(task, { task_class: "not_a_real_class" })
    );
    assert.equal(poisoned.status, "rejected");

    const smuggled = privacy.normalizeTenantRecord({
      ...privacy.mapAuditTaskToPrivacyInput(task, { task_class: "bug_fix" }),
      repository_url: "https://github.example/acme/secret-project",
    });
    assert.equal(smuggled.status, "rejected", "unknown/forbidden keys must fail closed");
  }
);
