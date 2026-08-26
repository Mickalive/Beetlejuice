import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateNormalizedBundle,
  CANONICAL_SCHEMA_VERSION,
  OUTCOME_STATUSES,
} from "../src/schema.js";
import { loadSyntheticFixture, loadLegacyV1Fixture } from "../src/synthetic.js";
import { migrateNormalizedBundleV1ToV2 } from "../src/migrate.js";

test("bundled synthetic fixture passes canonical validation (schema v2)", () => {
  const result = validateNormalizedBundle(loadSyntheticFixture());
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.equal(result.records.length, 6);
});

test("requires the versioned envelope (schema_version / normalization / collector)", () => {
  const base = loadSyntheticFixture();
  const strip = (key) => {
    const clone = structuredClone(base);
    delete clone[key];
    return clone;
  };
  for (const [key, path] of [
    ["schema_version", "$.schema_version"],
    ["normalization_version", "$.normalization_version"],
    ["collector_version", "$.collector_version"],
  ]) {
    const result = validateNormalizedBundle(strip(key));
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.path === path), `expected error at ${path}`);
  }
  assert.equal(CANONICAL_SCHEMA_VERSION, "2");
});

test("legacy v1 bundles are refused with a pointer to the migrator", () => {
  const result = validateNormalizedBundle(loadLegacyV1Fixture());
  assert.equal(result.ok, false);
  const err = result.errors.find((e) => e.path === "$.schema_version");
  assert.ok(err, "expected schema_version rejection");
  assert.match(err.message, /migrate/i);
});

test("canonical outcome vocabulary is enforced (accepted/failed/aborted/unresolved)", () => {
  assert.deepEqual([...OUTCOME_STATUSES], ["accepted", "failed", "aborted", "unresolved"]);
  const base = structuredClone(loadSyntheticFixture());
  base.records[0].outcome.status = "closed_by_magic";
  const bad = validateNormalizedBundle(base);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.path.endsWith("outcome.status")));
  // The legacy provider-flavored status must not sneak back in.
  const legacy = structuredClone(loadSyntheticFixture());
  legacy.records[0].outcome.status = "pr_merged";
  const badLegacy = validateNormalizedBundle(legacy);
  assert.equal(badLegacy.ok, false);
});

test("rejects raw GitHub payloads anywhere in the bundle (adapter boundary)", () => {
  const base = structuredClone(loadSyntheticFixture());
  base.records[0].executions[0].workflow_run = { id: 12345 };
  const result = validateNormalizedBundle(base);
  assert.equal(result.ok, false);
  const err = result.errors.find((e) => e.path.includes("workflow_run"));
  assert.ok(err, "expected a raw-provider rejection error");
  assert.match(err.message, /normalize/i);
});

test("rejects deeply nested raw provider fields (html_url under source_refs)", () => {
  const base = structuredClone(loadSyntheticFixture());
  base.records[1].source_refs = [{ html_url: "https://example.invalid/x" }];
  const result = validateNormalizedBundle(base);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.path.includes("html_url")));
});

test("enforces cost accounting invariant: micro-usd components sum to execution total", () => {
  const base = structuredClone(loadSyntheticFixture());
  base.records[0].executions[0].total_amount_micro_usd += 1; // one µ$ off
  const result = validateNormalizedBundle(base);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(
      (e) => e.path.endsWith("total_amount_micro_usd") && /invariant/.test(e.message)
    )
  );
});

test("unavailable components must carry amount_micro_usd = null", () => {
  const base = structuredClone(loadSyntheticFixture());
  const t6 = base.records.find((r) => r.task_id === "T-006");
  t6.executions[0].components.ci.amount_micro_usd = 420000;
  const result = validateNormalizedBundle(base);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /unavailable/.test(e.message)));
});

test("rejects duplicate execution ids and dangling cross-references within a task", () => {
  const base = structuredClone(loadSyntheticFixture());
  base.records[0].executions[1].execution_id = "e-01"; // duplicate
  const dup = validateNormalizedBundle(base);
  assert.equal(dup.ok, false);
  assert.ok(dup.errors.some((e) => /duplicate execution_id/.test(e.message)));

  const base2 = structuredClone(loadSyntheticFixture());
  base2.records[0].executions[1].retry_of_execution_id = "e-does-not-exist";
  const dangling = validateNormalizedBundle(base2);
  assert.equal(dangling.ok, false);
  assert.ok(dangling.errors.some((e) => /unknown execution_id/.test(e.message)));
});

test("rejects empty record sets", () => {
  const empty = validateNormalizedBundle({
    schema_version: "2",
    normalization_version: "1",
    collector_version: "x",
    records: [],
  });
  assert.equal(empty.ok, false);
});

// ---------------------------------------------------------------------------
// v1 → v2 migration
// ---------------------------------------------------------------------------

test("legacy v1 fixture migrates deterministically and passes v2 validation", () => {
  const v1 = loadLegacyV1Fixture();
  const { ok, errors, bundle } = migrateNormalizedBundleV1ToV2(v1);
  assert.equal(ok, true, JSON.stringify(errors, null, 2));
  assert.equal(bundle.schema_version, "2");
  assert.ok(bundle.normalization_version.endsWith("+migrate-v1-to-v2"));

  const result = validateNormalizedBundle(bundle);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));

  // Status mapping.
  const statuses = result.records.map((r) => r.outcome.status).sort();
  assert.deepEqual(statuses, ["aborted", "aborted", "accepted", "accepted", "failed", "unresolved"]);

  // Money conversion is exact: cents ×10_000.
  const t1e1 = result.records[0].executions[0];
  assert.equal(t1e1.total_amount_micro_usd, 3_600_000); // was 360 cents
  assert.equal(t1e1.components.inference.amount_micro_usd, 2_400_000); // was 240 cents

  // Determinism.
  const again = migrateNormalizedBundleV1ToV2(loadLegacyV1Fixture());
  assert.deepEqual(again.bundle, bundle);
});

test("migrated economics equal the native v2 fixture economics exactly", async () => {
  const { summarizeEconomics } = await import("../src/economics.js");
  const migrated = migrateNormalizedBundleV1ToV2(loadLegacyV1Fixture()).bundle;
  const a = summarizeEconomics(validateNormalizedBundle(migrated).records);
  const b = summarizeEconomics(validateNormalizedBundle(loadSyntheticFixture()).records);
  assert.deepEqual(a.cost, b.cost);
  assert.deepEqual(a.tasks, b.tasks);
  assert.deepEqual(a.outcomes_economics, b.outcomes_economics);
});

test("migrator rejects wrong schema versions and unknown legacy statuses precisely", () => {
  const badVersion = migrateNormalizedBundleV1ToV2({ ...loadLegacyV1Fixture(), schema_version: "9" });
  assert.equal(badVersion.ok, false);
  assert.ok(badVersion.errors.some((e) => /expects legacy schema_version/.test(e.message)));

  const base = structuredClone(loadLegacyV1Fixture());
  base.records[0].outcome.status = "weird_status";
  const badStatus = migrateNormalizedBundleV1ToV2(base);
  assert.equal(badStatus.ok, false);
  assert.ok(badStatus.errors.some((e) => /unknown legacy outcome status/.test(e.message)));
});
