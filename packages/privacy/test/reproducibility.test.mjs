import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EXTERNAL_RESEARCH_DATA_LICENSING,
  GLOBAL_BENCHMARK_CONTRIBUTION,
  PRODUCT_TELEMETRY,
  exportGlobalLearningRecords,
  pipelineTrace,
  PRIVACY_TRANSFORM_VERSIONS,
} from "../src/index.js";
import { tenantRecord } from "./helpers/fixtures.js";

const PURPOSE = GLOBAL_BENCHMARK_CONTRIBUTION;

function batch() {
  return [
    ...Array.from({ length: 5 }, () => tenantRecord()),
    tenantRecord({ task_class: "feature_addition", cost_usd: 55 }),
    tenantRecord({ task_class: "feature_addition", cost_usd: 55 }),
    tenantRecord({ outcome: "task_aborted", ci_result: "none" }),
    tenantRecord({ outcome: "task_aborted", ci_result: "none" }),
    tenantRecord({ outcome: "task_aborted", ci_result: "none" }),
    { not: "even close" },
  ];
}

test("repeated exports are byte-identical (reproducible transformations)", () => {
  const a = JSON.stringify(exportGlobalLearningRecords({ purpose: PURPOSE, records: batch() }));
  const b = JSON.stringify(exportGlobalLearningRecords({ purpose: PURPOSE, records: batch() }));
  assert.equal(a, b);
});

test("input order does not change the exported data payload", () => {
  const forward = exportGlobalLearningRecords({ purpose: PURPOSE, records: batch() });
  const reversed = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: [...batch()].reverse(),
  });
  // The data payload is canonical; per-record rejection entries are
  // intentionally positional (they carry the input index for tenant-side
  // debugging) and may differ with input order.
  const payload = (r) =>
    JSON.stringify({ accepted: r.accepted, suppressed: r.suppressed, counts: r.counts });
  assert.equal(payload(forward), payload(reversed));
});

test("the envelope carries the full versioned transformation trace", () => {
  const result = exportGlobalLearningRecords({ purpose: PURPOSE, records: batch() });
  assert.deepEqual(result.transformations, pipelineTrace());
  const expectedIds = Object.keys(PRIVACY_TRANSFORM_VERSIONS);
  assert.deepEqual(
    result.transformations.map((t) => t.id),
    expectedIds,
  );
  for (const step of result.transformations) {
    assert.match(step.version, /^\d+\.\d+\.\d+$/);
  }
});

test("different inputs produce different outputs (pipeline is not constant)", () => {
  const one = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: Array.from({ length: 5 }, () => tenantRecord()),
  });
  const two = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: Array.from({ length: 5 }, () =>
      tenantRecord({ task_class: "refactoring", outcome: "pr_closed" }),
    ),
  });
  assert.notEqual(JSON.stringify(one), JSON.stringify(two));
});

test("exports never embed wall-clock timestamps or generated-at fields", () => {
  const result = exportGlobalLearningRecords({
    purpose: EXTERNAL_RESEARCH_DATA_LICENSING,
    licenseAcknowledged: true,
    records: Array.from({ length: 25 }, () => tenantRecord()),
  });
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        assert.doesNotMatch(key, /timestamp|generated|^date|_at$/i, `timestamp-ish key: ${key}`);
        walk(value);
      }
    }
  };
  walk(result);
});

test("every provided record is accounted for exactly once", () => {
  const records = batch();
  const result = exportGlobalLearningRecords({ purpose: PURPOSE, records });
  const { provided, accepted, suppressed, rejected } = result.counts;
  assert.equal(provided, records.length);
  assert.equal(accepted + suppressed + rejected, provided);
});

test("all consent surfaces share deterministic behavior", () => {
  for (const purpose of [PRODUCT_TELEMETRY, GLOBAL_BENCHMARK_CONTRIBUTION]) {
    const records = Array.from({ length: 5 }, () => tenantRecord());
    const a = JSON.stringify(exportGlobalLearningRecords({ purpose, records }));
    const b = JSON.stringify(exportGlobalLearningRecords({ purpose, records }));
    assert.equal(a, b, purpose);
  }
});
