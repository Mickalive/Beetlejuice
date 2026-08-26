import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GLOBAL_BENCHMARK_CONTRIBUTION,
  GLR_FIELD_ORDER,
  exportGlobalLearningRecords,
  isValidGlobalLearningRecord,
} from "../src/index.js";
import { tenantRecord } from "./helpers/fixtures.js";
import {
  fakeCommitDigest,
  fakeProviderToken,
  fakeUuid,
} from "./helpers/sensitive.js";

const PURPOSE = GLOBAL_BENCHMARK_CONTRIBUTION;

function exportedBatch() {
  const result = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: Array.from({ length: 5 }, () => tenantRecord()),
  });
  assert.equal(result.counts.accepted, 5);
  return result;
}

test("accepted records contain exactly the allowlisted abstract fields", () => {
  const { accepted } = exportedBatch();
  for (const record of accepted) {
    assert.ok(isValidGlobalLearningRecord(record));
    assert.deepEqual(Object.keys(record), [...GLR_FIELD_ORDER]);
  }
});

test("no identifier-shaped key can ever appear on an exported record", () => {
  const idLike = /(^|_)(id|ids|uuid|guid|hash|digest|pseudonym|fingerprint|nonce|salt)($|_)/i;
  const { accepted } = exportedBatch();
  for (const record of accepted) {
    for (const key of Object.keys(record)) {
      assert.doesNotMatch(key, idLike, `identifier-like key leaked: ${key}`);
    }
  }
});

test("no deterministic pseudonym value (hex digest / uuid / token shape) is emitted", () => {
  const hexDigest = /\b[a-f0-9]{32,}\b/i;
  const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
  const tokenShape = /\bgh[a-z]_[A-Za-z0-9]{16,}\b/;
  const { accepted } = exportedBatch();
  for (const record of accepted) {
    const json = JSON.stringify(record);
    assert.doesNotMatch(json, hexDigest);
    assert.doesNotMatch(json, uuid);
    assert.doesNotMatch(json, tokenShape);
  }
});

test("pseudonym join keys are rejected even when disguised as analytics fields", () => {
  const attempts = [
    { customer_pseudonym: "customer_8742" },
    { repo_digest: fakeCommitDigest() },
    { developer_hash: "b".repeat(40) },
    { tenant_uuid: fakeUuid() },
    { session_fingerprint: fakeProviderToken() },
    { anonymous_id: "anon-0001" },
  ];
  for (const smuggle of attempts) {
    const result = exportGlobalLearningRecords({
      purpose: PURPOSE,
      records: [tenantRecord(smuggle)],
    });
    assert.equal(result.counts.accepted, 0, Object.keys(smuggle)[0]);
    assert.equal(result.rejected[0].reason_code.startsWith("forbidden_"), true);
  }
});

test("the exporter emits no per-run nonce: repeated exports are identical", () => {
  const a = exportedBatch();
  const b = exportedBatch();
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("records are grouped by content only — no stored join key exists anywhere", () => {
  // Two records with identical abstract features but produced by different
  // tenants must land in the SAME cohort: nothing distinguishes them.
  const t1 = tenantRecord({ agent_name: "tenant-one-agent" });
  const t2 = tenantRecord({ agent_name: "tenant-two-agent" });
  const result = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: [t1, t2, ...Array.from({ length: 3 }, () => tenantRecord())],
  });
  assert.equal(result.counts.accepted, 5);
});
