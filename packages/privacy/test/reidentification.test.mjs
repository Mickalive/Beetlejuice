import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EXTERNAL_RESEARCH_DATA_LICENSING,
  GLOBAL_BENCHMARK_CONTRIBUTION,
  PRODUCT_TELEMETRY,
  aggregateCohorts,
  exportGlobalLearningRecords,
  suppressRareCombinations,
} from "../src/index.js";
import { normalizeTenantRecord } from "../src/transform.js";
import { tenantRecord } from "./helpers/fixtures.js";

const PURPOSE = GLOBAL_BENCHMARK_CONTRIBUTION;

function candidatesOf(records) {
  return records.map((r) => {
    const n = normalizeTenantRecord(r);
    if (n.status !== "ok") throw new Error(JSON.stringify(n.entry));
    return n.record;
  });
}

test("a deliberately unique synthetic record is suppressed, not exported", () => {
  const unique = tenantRecord({
    task_class: "incident_response",
    cost_usd: 1234.5,
    outcome: "task_failed",
  });
  const result = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: [unique],
  });
  assert.equal(result.counts.accepted, 0);
  assert.equal(result.counts.suppressed, 1);
  assert.equal(result.cohort_threshold, 5);
  assert.equal(result.suppressed[0].reason_code, "below_cohort_threshold");
  assert.equal(result.suppressed[0].cohort_size, 1);
});

test("records meeting the cohort threshold are admitted", () => {
  const result = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: Array.from({ length: 5 }, () => tenantRecord()),
  });
  assert.equal(result.counts.accepted, 5);
  assert.equal(result.counts.suppressed, 0);
});

test("in a mixed batch only the rare combination is suppressed", () => {
  const common = Array.from({ length: 5 }, () => tenantRecord());
  const unique = tenantRecord({ task_class: "code_review", cost_usd: 777 });
  const result = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: [...common, unique],
  });
  assert.equal(result.counts.accepted, 5);
  assert.equal(result.counts.suppressed, 1);
  assert.equal(result.suppressed[0].combination.task_class, "code_review");
});

test("raising the threshold re-suppresses borderline cohorts", () => {
  const records = Array.from({ length: 5 }, () => tenantRecord());
  const relaxed = exportGlobalLearningRecords({ purpose: PURPOSE, records });
  const strict = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records,
    cohortThreshold: 8,
  });
  assert.equal(relaxed.counts.accepted, 5);
  assert.equal(strict.counts.accepted, 0);
  assert.equal(strict.cohort_threshold, 8);
});

test("purpose policy floors can never be lowered", () => {
  const records = Array.from({ length: 3 }, () => tenantRecord());
  const telemetry = exportGlobalLearningRecords({
    purpose: PRODUCT_TELEMETRY,
    records,
    cohortThreshold: 2, // below the floor of 5
  });
  assert.equal(telemetry.cohort_threshold, 5);
  assert.equal(telemetry.counts.accepted, 0);

  const research = exportGlobalLearningRecords({
    purpose: EXTERNAL_RESEARCH_DATA_LICENSING,
    licenseAcknowledged: true,
    records: Array.from({ length: 10 }, () => tenantRecord()),
    cohortThreshold: 2, // below the research floor of 25
  });
  assert.equal(research.cohort_threshold, 25);
  assert.equal(research.counts.accepted, 0);
  assert.equal(research.counts.suppressed, 10);
});

test("aggregate-only exports expose cohort counts, never individual rows", () => {
  const result = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: [
      ...Array.from({ length: 5 }, () => tenantRecord()),
      ...Array.from({ length: 6 }, () => tenantRecord({ task_class: "test_authoring" })),
      tenantRecord({ task_class: "code_review" }),
    ],
    aggregateOnly: true,
  });
  assert.ok(!("accepted" in result), "individual rows must not exist");
  // Only cohorts meeting the threshold appear, as counts.
  assert.deepEqual(
    result.cohorts.map((c) => c.size).sort((a, b) => a - b),
    [5, 6],
  );
});

test("suppressRareCombinations and aggregateCohorts agree on the threshold", () => {
  const candidates = [
    ...candidatesOf(Array.from({ length: 3 }, () => tenantRecord())),
    ...candidatesOf(Array.from({ length: 2 }, () => tenantRecord({ task_class: "refactoring" }))),
    ...candidatesOf([tenantRecord({ task_class: "code_review" })]),
  ];
  const sup = suppressRareCombinations(candidates, { threshold: 2 });
  const agg = aggregateCohorts(candidates, { threshold: 2 });
  // The singleton is suppressed; both qualifying groups are admitted and
  // appear in the aggregate view.
  assert.equal(sup.admitted.length, 5);
  assert.equal(sup.suppressed.length, 1);
  assert.equal(sup.suppressed[0].combination.task_class, "code_review");
  assert.deepEqual(
    agg.map((c) => c.size).sort((a, b) => a - b),
    [2, 3],
  );
});
