import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ABSOLUTE_MAXIMUM_EPSILON,
  EXTERNAL_RESEARCH_DATA_LICENSING,
  GLOBAL_BENCHMARK_CONTRIBUTION,
  PRODUCT_TELEMETRY,
  PrivacyExportError,
  addPrivateNoiseToCohorts,
  aggregateCohorts,
  effectiveEpsilon,
  exportGlobalLearningRecords,
  laplaceFromUniform,
  normalizeTenantRecord,
} from "../src/index.js";
import { tenantRecord } from "./helpers/fixtures.js";

const PURPOSE = GLOBAL_BENCHMARK_CONTRIBUTION;

/** Two distinct qualifying cohorts (sizes 5 and 6) plus one suppressed singleton. */
function cohortBatch() {
  return [
    ...Array.from({ length: 5 }, () => tenantRecord()),
    ...Array.from({ length: 6 }, () =>
      tenantRecord({ task_class: "test_authoring", outcome: "pr_created" }),
    ),
    tenantRecord({ task_class: "code_review" }), // below threshold, never published
  ];
}

function dpExport(overrides = {}) {
  return exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: cohortBatch(),
    aggregateOnly: true,
    differentialPrivacy: true,
    dpSeed: "cycle-seed-2026",
    ...overrides,
  });
}

test("differential privacy applies only to published aggregates", () => {
  assert.throws(
    () =>
      exportGlobalLearningRecords({
        purpose: PURPOSE,
        records: Array.from({ length: 5 }, () => tenantRecord()),
        differentialPrivacy: true,
        dpSeed: 7,
      }),
    (err) =>
      err instanceof PrivacyExportError && err.code === "DP_REQUIRES_AGGREGATE_MODE",
  );
});

test("DP parameters without the DP flag are rejected, never silently dropped", () => {
  // An operator must not walk away believing counts were noised.
  for (const stray of [
    { epsilon: 2 },
    { dpSeed: 7 },
    { epsilon: 2, dpSeed: 7 },
  ]) {
    assert.throws(
      () => dpExport({ differentialPrivacy: false, ...stray }),
      (err) =>
        err instanceof PrivacyExportError && err.code === "DP_NOT_ENABLED",
      `stray parameters ${JSON.stringify(stray)} must be rejected`,
    );
  }
});

test("differential privacy requires an explicit caller-private seed", () => {
  assert.throws(
    () => dpExport({ dpSeed: undefined }),
    (err) => err instanceof PrivacyExportError && err.code === "DP_SEED_REQUIRED",
  );
});

test("malformed seeds are rejected, never guessed", () => {
  for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "", "   ", null, {}, true]) {
    assert.throws(
      () => dpExport({ dpSeed: bad }),
      (err) => err instanceof PrivacyExportError && err.code === "INVALID_DP_SEED",
      `seed ${String(bad)} must be rejected`,
    );
  }
});

test("epsilon must be a positive finite number", () => {
  for (const bad of [0, -2, Infinity, -Infinity, NaN, "wide", null]) {
    assert.throws(
      () => dpExport({ epsilon: bad }),
      (err) => err instanceof PrivacyExportError && err.code === "INVALID_EPSILON",
      `epsilon ${String(bad)} must be rejected`,
    );
  }
});

test("effective epsilon can be lowered but never raised above the purpose ceiling", () => {
  // Defaults are the ceilings themselves.
  assert.equal(effectiveEpsilon(PRODUCT_TELEMETRY, undefined), 5);
  assert.equal(effectiveEpsilon(GLOBAL_BENCHMARK_CONTRIBUTION, undefined), 2);
  assert.equal(effectiveEpsilon(EXTERNAL_RESEARCH_DATA_LICENSING, undefined), 1);
  // Lowering is always allowed (more noise = stronger protection).
  assert.equal(effectiveEpsilon(GLOBAL_BENCHMARK_CONTRIBUTION, 0.25), 0.25);
  // Raising clamps down to the ceiling — inverse of the cohort floor.
  assert.equal(effectiveEpsilon(PRODUCT_TELEMETRY, 50), 5);
  assert.equal(effectiveEpsilon(GLOBAL_BENCHMARK_CONTRIBUTION, 10), 2);
  assert.equal(effectiveEpsilon(EXTERNAL_RESEARCH_DATA_LICENSING, 10), 1);
  // No purpose may exceed the absolute maximum.
  for (const purpose of [
    PRODUCT_TELEMETRY,
    GLOBAL_BENCHMARK_CONTRIBUTION,
    EXTERNAL_RESEARCH_DATA_LICENSING,
  ]) {
    assert.ok(
      effectiveEpsilon(purpose, undefined) <= ABSOLUTE_MAXIMUM_EPSILON,
      purpose,
    );
  }
});

test("the envelope discloses the mechanism but never the seed", () => {
  const seed = "operator-private-quarterly-seed";
  const result = dpExport({ dpSeed: seed });
  assert.equal(result.aggregate_mode, "differential_private");
  assert.deepEqual(result.differential_privacy, {
    mechanism: "laplace",
    epsilon: 2,
    sensitivity: 1,
  });
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(seed), "the caller-private seed leaked");
  assert.ok(
    !serialized.includes("dpSeed"),
    "no seed-bearing key may exist in the envelope",
  );
});

test("identical requests are byte-identical; the seed changes the draw", () => {
  const a = JSON.stringify(dpExport());
  const b = JSON.stringify(dpExport());
  assert.equal(a, b);

  const sizesFor = (seed) =>
    dpExport({ dpSeed: seed }).cohorts.map((c) => c.size).join(",");
  const variants = new Set([1, 2, 3, 4, 5, "six", "seven"].map(sizesFor));
  assert.ok(
    variants.size > 1,
    "different seeds must produce different noise draws",
  );
});

test("published counts are noised integers, clamped at zero, never exact leaks", () => {
  const result = dpExport();
  const exact = aggregateCohorts(
    cohortBatch()
      .map((r) => normalizeTenantRecord(r))
      .filter((n) => n.status === "ok")
      .map((n) => n.record),
    { threshold: 5 },
  );
  assert.equal(result.cohorts.length, exact.length);
  for (const cohort of result.cohorts) {
    assert.ok(Number.isInteger(cohort.size), "noised size must be an integer");
    assert.ok(cohort.size >= 0, "noised size must be clamped at zero");
    assert.equal(cohort.exact_size_exposed, false);
  }

  // The mechanism genuinely perturbs counts: across many seeds at least one
  // cohort deviates from its exact size somewhere.
  let sawDeviation = false;
  for (let seed = 0; seed < 40 && !sawDeviation; seed += 1) {
    const noisy = addPrivateNoiseToCohorts(exact, {
      epsilon: 2,
      sensitivity: 1,
      seed,
    });
    sawDeviation = noisy.some((c, i) => c.size !== exact[i].size);
  }
  assert.ok(sawDeviation, "noise must actually alter some published count");
});

test("utility stays bounded at benchmark epsilon", () => {
  // ε=2 → Laplace scale 0.5; |noise| > 6 has probability ~e^-12 per draw.
  const exact = aggregateCohorts(
    cohortBatch()
      .map((r) => normalizeTenantRecord(r))
      .filter((n) => n.status === "ok")
      .map((n) => n.record),
    { threshold: 5 },
  );
  for (let seed = 0; seed < 20; seed += 1) {
    const noisy = addPrivateNoiseToCohorts(exact, {
      epsilon: 2,
      sensitivity: 1,
      seed,
    });
    for (let i = 0; i < noisy.length; i += 1) {
      assert.ok(
        Math.abs(noisy[i].size - exact[i].size) <= 6,
        `seed ${seed}: noise exceeded utility bound`,
      );
    }
  }
});

test("per-cohort noise is stable across overlapping exports (anti-differencing)", () => {
  // The same cohort exported twice in different batches under one seed must
  // carry the SAME draw, so repeated releases cannot be averaged to cancel it.
  const baseFive = Array.from({ length: 5 }, () => tenantRecord());
  const smallBatch = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: [...baseFive, tenantRecord({ task_class: "code_review" })],
    aggregateOnly: true,
    differentialPrivacy: true,
    dpSeed: "stable-seed",
  });
  const bigBatch = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: [
      ...baseFive,
      ...Array.from({ length: 6 }, () =>
        tenantRecord({ task_class: "test_authoring", outcome: "pr_created" }),
      ),
    ],
    aggregateOnly: true,
    differentialPrivacy: true,
    dpSeed: "stable-seed",
  });
  const keyOf = (cohort) => JSON.stringify(cohort.combination);
  const smallByKey = new Map(smallBatch.cohorts.map((c) => [keyOf(c), c.size]));
  for (const cohort of bigBatch.cohorts) {
    if (smallByKey.has(keyOf(cohort))) {
      assert.equal(
        smallByKey.get(keyOf(cohort)),
        cohort.size,
        "overlapping exports reused different noise for one cohort",
      );
    }
  }
});

test("suppressed rare combinations remain absent from noisy cohorts", () => {
  const result = dpExport();
  const serializedCombinations = result.cohorts.map((c) =>
    JSON.stringify(c.combination),
  );
  const uniqueCombination = JSON.stringify(
    normalizeTenantRecord(tenantRecord({ task_class: "code_review" })).record,
  );
  assert.ok(
    !serializedCombinations.includes(uniqueCombination),
    "a below-threshold combination must not be published through the DP path either",
  );
});

test("counts accounting and risk summary survive the DP path unchanged", () => {
  const result = dpExport();
  const { provided, accepted, suppressed, rejected } = result.counts;
  assert.equal(provided, 12);
  // Aggregate-only publication exposes no rows: `accepted` counts rows and
  // stays 0; the qualifying cohorts appear only as (noised) counts.
  assert.equal(accepted, 0);
  assert.equal(rejected, 0);
  // The below-threshold singleton is accounted as suppressed exactly once.
  assert.equal(suppressed, 1);
  assert.equal(result.privacy_risk.suppressed_records, 1);
});

test("row-level envelopes stay exactly as before (no aggregate fields)", () => {
  const result = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: Array.from({ length: 5 }, () => tenantRecord()),
  });
  assert.ok(!("aggregate_mode" in result));
  assert.ok(!("differential_privacy" in result));
  assert.ok(Array.isArray(result.accepted));
});

test("the versioned pipeline trace includes the differential-privacy step", () => {
  const result = dpExport();
  const ids = result.transformations.map((t) => t.id);
  assert.ok(ids.includes("differential-privacy"));
  const step = result.transformations.find((t) => t.id === "differential-privacy");
  assert.match(step.version, /^\d+\.\d+\.\d+$/);
});

test("laplace draws are deterministic, symmetric and finite at the boundaries", () => {
  assert.equal(laplaceFromUniform(0.5, 0.5), 0);
  // Symmetry around the center.
  assert.equal(
    laplaceFromUniform(0.25, 2),
    -laplaceFromUniform(0.75, 2),
  );
  // Deterministic across calls.
  assert.equal(laplaceFromUniform(0.1, 1), laplaceFromUniform(0.1, 1));
  // Endpoint-underflow clamps instead of emitting ±Infinity.
  assert.ok(Number.isFinite(laplaceFromUniform(0, 0.5)));
  assert.ok(Number.isFinite(laplaceFromUniform(0.9999999999999999, 0.5)));
});
