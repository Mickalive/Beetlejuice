import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ABSOLUTE_MAXIMUM_ROWS_PER_COMBINATION,
  EXTERNAL_RESEARCH_DATA_LICENSING,
  GLOBAL_BENCHMARK_CONTRIBUTION,
  PRODUCT_TELEMETRY,
  PrivacyExportError,
  effectiveMaxRowsPerCombination,
  exportGlobalLearningRecords,
  suppressRareCombinations,
} from "../src/index.js";
import { normalizeTenantRecord } from "../src/transform.js";
import { mixedBatch, expectedDefaultGlobalRecord, tenantRecord } from "./helpers/fixtures.js";

/**
 * WC-003 hardening: cohort floors alone are launderable. A single source
 * can push a near-unique combination past the rarity defense by submitting
 * k duplicate rows in ONE batch. The gate therefore caps how many rows any
 * single export may admit per distinct abstract combination; excess rows
 * are suppressed with `over_combination_cap` — never silently dropped and
 * never admitted.
 */

const PURPOSE = GLOBAL_BENCHMARK_CONTRIBUTION;

function candidatesOf(records) {
  return records.map((r) => {
    const n = normalizeTenantRecord(r);
    if (n.status !== "ok") throw new Error(JSON.stringify(n.entry));
    return n.record;
  });
}

test("a single source cannot launder a unique combination past the cohort floor", () => {
  // One distinct combination submitted many times in one batch.
  const inflated = Array.from({ length: 80 }, () => tenantRecord());
  const result = exportGlobalLearningRecords({ purpose: PURPOSE, records: inflated });

  assert.equal(result.counts.provided, 80);
  // Default benchmark ceiling admits at most 50 rows for this combination…
  assert.equal(result.rows_per_combination_limit, 50);
  assert.equal(result.counts.accepted, 50);
  // …the remaining duplicates are SUPPRESSED with an explanation, not dropped.
  assert.equal(result.counts.suppressed, 30);
  assert.equal(result.counts.rejected, 0);
  for (const entry of result.suppressed) {
    assert.equal(entry.reason_code, "over_combination_cap");
    assert.equal(entry.rows_per_combination_limit, 50);
    assert.equal(entry.cohort_size, 80);
    assert.equal(entry.threshold, result.cohort_threshold);
    // Suppression explanations carry only closed-vocabulary record content.
    assert.deepEqual(entry.combination, expectedDefaultGlobalRecord());
  }
});

test("every purpose bounds admission by its own policy ceiling", () => {
  const cases = [
    [PRODUCT_TELEMETRY, 130, 100],
    [GLOBAL_BENCHMARK_CONTRIBUTION, 80, 50],
    [EXTERNAL_RESEARCH_DATA_LICENSING, 40, 25],
  ];
  for (const [purpose, rows, expectedAdmitted] of cases) {
    const result = exportGlobalLearningRecords({
      purpose,
      licenseAcknowledged: true,
      records: Array.from({ length: rows }, () => tenantRecord()),
    });
    assert.equal(result.rows_per_combination_limit, expectedAdmitted, purpose);
    assert.equal(result.counts.accepted, expectedAdmitted, purpose);
    assert.equal(result.counts.suppressed, rows - expectedAdmitted, purpose);
    assert.ok(result.suppressed.every((e) => e.reason_code === "over_combination_cap"));
  }
});

test("distinct combinations never collide with the cap", () => {
  // Five DISTINCT combinations x5 repeats each: every group meets the floor
  // and stays far below the cap, so everything is admitted exactly as before.
  const records = [];
  for (let repeat = 0; repeat < 5; repeat++) records.push(...mixedBatch());
  const result = exportGlobalLearningRecords({ purpose: PURPOSE, records });
  assert.equal(result.counts.accepted, records.length);
  assert.equal(result.counts.suppressed, 0);
});

test("a floor-sized homogeneous cohort remains admissible on the research surface", () => {
  // The external-research cap equals its cohort floor: exactly-floor cohorts
  // stay fully admissible while gross duplication cannot.
  const result = exportGlobalLearningRecords({
    purpose: EXTERNAL_RESEARCH_DATA_LICENSING,
    licenseAcknowledged: true,
    records: Array.from({ length: 25 }, () => tenantRecord()),
  });
  assert.equal(result.counts.accepted, 25);
  assert.equal(result.counts.suppressed, 0);
});

test("the cap can be tightened but never loosened past the purpose ceiling", () => {
  assert.equal(effectiveMaxRowsPerCombination(PRODUCT_TELEMETRY, undefined), 100);
  assert.equal(effectiveMaxRowsPerCombination(GLOBAL_BENCHMARK_CONTRIBUTION, undefined), 50);
  assert.equal(effectiveMaxRowsPerCombination(EXTERNAL_RESEARCH_DATA_LICENSING, undefined), 25);
  // Tightening is honored verbatim…
  assert.equal(effectiveMaxRowsPerCombination(PURPOSE, 7), 7);
  const tightened = exportGlobalLearningRecords({
    purpose: PURPOSE,
    maxRowsPerCombination: 6,
    records: Array.from({ length: 10 }, () => tenantRecord()),
  });
  assert.equal(tightened.counts.accepted, 6);
  assert.equal(tightened.counts.suppressed, 4);
  assert.equal(tightened.rows_per_combination_limit, 6);
  // …loosening clamps to the policy ceiling (no request can exceed it).
  assert.equal(effectiveMaxRowsPerCombination(PURPOSE, 500), 50);
  assert.equal(
    effectiveMaxRowsPerCombination(PRODUCT_TELEMETRY, ABSOLUTE_MAXIMUM_ROWS_PER_COMBINATION + 1),
    ABSOLUTE_MAXIMUM_ROWS_PER_COMBINATION,
  );
  // Malformed requests fail loudly instead of being silently ignored.
  for (const bad of [0, -2, 2.5, "many", NaN]) {
    assert.throws(
      () => effectiveMaxRowsPerCombination(PURPOSE, bad),
      (err) =>
        err instanceof PrivacyExportError &&
        err.code === "INVALID_ROWS_PER_COMBINATION",
      `cap ${String(bad)} must be rejected`,
    );
  }
});

test("capped exports keep exact accounting and a medium operational risk signal", () => {
  const result = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: Array.from({ length: 60 }, () => tenantRecord()),
  });
  const { provided, accepted, suppressed, rejected } = result.counts;
  assert.equal(provided, accepted + suppressed + rejected);
  assert.equal(suppressed > 0, true);
  assert.equal(rejected, 0);
  assert.equal(result.privacy_risk.risk_level, "medium");
  assert.deepEqual(result.privacy_risk.rejected_reasons, []);
  assert.equal(result.privacy_risk.suppressed_records, suppressed);
});

test("aggregate-only publication is intentionally unaffected by the admission cap", () => {
  // Published aggregate counts stay truthful (protected by floors + optional
  // DP); capping them would corrupt benchmark statistics.
  const records = Array.from({ length: 130 }, () => tenantRecord());
  const exact = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records,
    aggregateOnly: true,
  });
  assert.ok(!("rows_per_combination_limit" in exact), "cap must not be implied where it was not applied");
  assert.deepEqual(exact.cohorts.map((c) => c.size), [130]);

  const dp = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records,
    aggregateOnly: true,
    differentialPrivacy: true,
    dpSeed: "cap-independent-noise",
  });
  assert.equal(dp.aggregate_mode, "differential_private");
  assert.equal(dp.cohorts.length, 1);
  assert.equal(dp.cohorts[0].exact_size_exposed, false);
});

test("admission order does not change which rows survive capping", () => {
  const fiveA = Array.from({ length: 5 }, () => tenantRecord());
  const eightB = Array.from({ length: 8 }, () =>
    tenantRecord({ task_class: "refactoring" }),
  );
  // Group members are byte-identical, so any interleaving must produce the
  // same payload even while the cap is active (tightened to 6): A admits
  // 5/5, B admits 6/8 and has exactly 2 rows suppressed either way.
  const straight = [...fiveA, ...eightB];
  const interleaved = [];
  for (let i = 0; i < eightB.length; i++) {
    if (i < fiveA.length) interleaved.push(fiveA[i]);
    interleaved.push(eightB[i]);
  }
  const request = { purpose: PURPOSE, maxRowsPerCombination: 6 };
  const a = JSON.stringify(exportGlobalLearningRecords({ ...request, records: straight }));
  const b = JSON.stringify(exportGlobalLearningRecords({ ...request, records: interleaved }));
  assert.equal(a, b);
  const parsed = JSON.parse(a);
  assert.equal(parsed.rows_per_combination_limit, 6);
  assert.equal(parsed.counts.accepted, 11);
  assert.equal(parsed.counts.suppressed, 2);
  assert.equal(parsed.suppressed.every((e) => e.reason_code === "over_combination_cap"), true);
});

test("low-level suppressRareCombinations stays uncapped unless asked otherwise", () => {
  const candidates = candidatesOf(Array.from({ length: 150 }, () => tenantRecord()));
  const uncapped = suppressRareCombinations(candidates, { threshold: 5 });
  assert.equal(uncapped.admitted.length, 150);
  assert.equal(uncapped.suppressed.length, 0);

  const capped = suppressRareCombinations(candidates, {
    threshold: 5,
    maxPerCombination: 20,
  });
  assert.equal(capped.admitted.length, 20);
  assert.equal(capped.suppressed.length, 130);
  assert.equal(capped.suppressed[0].reason_code, "over_combination_cap");

  assert.throws(
    () => suppressRareCombinations(candidates, { threshold: 5, maxPerCombination: 0 }),
    TypeError,
  );
});

test("the versioned pipeline trace discloses the capping behavior", () => {
  const result = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: Array.from({ length: 5 }, () => tenantRecord()),
  });
  const step = result.transformations.find((t) => t.id === "cohort-suppression");
  assert.equal(step?.version, "1.1.0");
});
