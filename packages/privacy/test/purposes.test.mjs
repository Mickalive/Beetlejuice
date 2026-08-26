import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EXTERNAL_RESEARCH_DATA_LICENSING,
  GLOBAL_BENCHMARK_CONTRIBUTION,
  PRODUCT_TELEMETRY,
  PrivacyExportError,
  exportGlobalLearningRecords,
  effectiveCohortThreshold,
} from "../src/index.js";
import { tenantRecord } from "./helpers/fixtures.js";

test("every export requires an explicit consent purpose", () => {
  assert.throws(
    () => exportGlobalLearningRecords({ records: [] }),
    (err) => err instanceof PrivacyExportError && err.code === "PURPOSE_REQUIRED",
  );
});

test("unknown purposes are refused", () => {
  assert.throws(
    () =>
      exportGlobalLearningRecords({
        purpose: "TRAIN_WHATEVER_WE_WANT",
        records: [],
      }),
    (err) => err instanceof PrivacyExportError && err.code === "UNKNOWN_PURPOSE",
  );
});

test("external research / licensing needs an explicit acknowledgement", () => {
  assert.throws(
    () =>
      exportGlobalLearningRecords({
        purpose: EXTERNAL_RESEARCH_DATA_LICENSING,
        records: [],
      }),
    (err) =>
      err instanceof PrivacyExportError &&
      err.code === "LICENSE_ACKNOWLEDGEMENT_REQUIRED",
  );
  // With the acknowledgement the surface opens.
  const result = exportGlobalLearningRecords({
    purpose: EXTERNAL_RESEARCH_DATA_LICENSING,
    licenseAcknowledged: true,
    records: Array.from({ length: 25 }, () => tenantRecord()),
  });
  assert.equal(result.counts.accepted, 25);
});

test("telemetry and benchmark surfaces do not require a licence acknowledgement", () => {
  for (const purpose of [PRODUCT_TELEMETRY, GLOBAL_BENCHMARK_CONTRIBUTION]) {
    const result = exportGlobalLearningRecords({
      purpose,
      records: Array.from({ length: 5 }, () => tenantRecord()),
    });
    assert.equal(result.counts.accepted, 5, purpose);
    assert.equal(result.purpose, purpose);
  }
});

test("purpose is request-level: records cannot carry their own purpose key", () => {
  const result = exportGlobalLearningRecords({
    purpose: GLOBAL_BENCHMARK_CONTRIBUTION,
    records: [
      tenantRecord({ purpose: EXTERNAL_RESEARCH_DATA_LICENSING }),
      tenantRecord({ purpose: PRODUCT_TELEMETRY }),
    ],
  });
  assert.equal(result.counts.accepted, 0);
  assert.equal(result.counts.rejected, 2);
});

test("effective cohort threshold clamps to policy floors and rejects nonsense", () => {
  assert.equal(effectiveCohortThreshold(PRODUCT_TELEMETRY, undefined), 5);
  assert.equal(effectiveCohortThreshold(PRODUCT_TELEMETRY, 2), 5); // clamped up
  assert.equal(effectiveCohortThreshold(PRODUCT_TELEMETRY, 50), 50); // raised
  assert.equal(effectiveCohortThreshold(EXTERNAL_RESEARCH_DATA_LICENSING, 2), 25);
  for (const bad of [1, 0, -3, 2.5, "many"]) {
    assert.throws(
      () => effectiveCohortThreshold(PRODUCT_TELEMETRY, bad),
      (err) => err instanceof PrivacyExportError && err.code === "INVALID_COHORT_THRESHOLD",
      `threshold ${String(bad)} must be rejected`,
    );
  }
});

test("a malformed records container is a request error, not a silent success", () => {
  for (const bad of [undefined, null, "records", { 0: 1 }]) {
    assert.throws(
      () => exportGlobalLearningRecords({ purpose: PRODUCT_TELEMETRY, records: bad }),
      (err) => err instanceof PrivacyExportError && err.code === "INVALID_RECORDS_CONTAINER",
    );
  }
});
