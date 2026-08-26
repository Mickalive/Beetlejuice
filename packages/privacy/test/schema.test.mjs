import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GLR_FIELD_ORDER,
  isValidGlobalLearningRecord,
  normalizeTenantRecord,
  validateGlobalLearningRecord,
} from "../src/index.js";
import { expectedDefaultGlobalRecord, tenantRecord } from "./helpers/fixtures.js";

test("glr/1 schema accepts the canonical abstract record", () => {
  const verdict = validateGlobalLearningRecord(expectedDefaultGlobalRecord());
  assert.equal(verdict.ok, true, JSON.stringify(verdict.issues));
  assert.equal(isValidGlobalLearningRecord(expectedDefaultGlobalRecord()), true);
});

test("schema is closed world: unexpected fields are rejected, not dropped", () => {
  const bad = { ...expectedDefaultGlobalRecord(), favorite_color: "purple" };
  const verdict = validateGlobalLearningRecord(bad);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.issues.some((i) => i.code === "unexpected_field"));
});

test("schema requires every abstract dimension", () => {
  for (const field of GLR_FIELD_ORDER) {
    const partial = { ...expectedDefaultGlobalRecord() };
    delete partial[field];
    const verdict = validateGlobalLearningRecord(partial);
    assert.equal(verdict.ok, false, `missing ${field} must fail`);
    assert.ok(verdict.issues.some((i) => i.code === "missing_field" && i.field === field));
  }
});

test("enum fields reject free-text values", () => {
  const verdict = validateGlobalLearningRecord({
    ...expectedDefaultGlobalRecord(),
    task_class: "fix the login page crash before Friday",
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.issues.some((i) => i.code === "invalid_enum_value"));
});

test("non-boolean human_intervention is rejected", () => {
  const verdict = validateGlobalLearningRecord({
    ...expectedDefaultGlobalRecord(),
    human_intervention: "yes",
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.issues.some((i) => i.code === "invalid_boolean"));
});

test("normalization rejects unknown input keys (fail-closed)", () => {
  const result = normalizeTenantRecord({ ...tenantRecord(), favorite_color: "purple" });
  assert.equal(result.status, "rejected");
  assert.equal(result.entry.reason_code, "unknown_input_field");
});

test("normalization rejects forbidden identifier keys with a precise reason", () => {
  for (const key of [
    "customer_id",
    "tenant_slug",
    "repository_name",
    "developer_login",
    "commit_sha",
    "branch_ref",
    "pr_number",
    "issue_id",
    "github_url",
    "email_address",
    "ip_address",
    "api_key_value",
    "prompt_text",
    "source_diff",
    "file_path",
    "created_at",
    "run_id",
    "session_fingerprint",
    "id",
    "uuid",
    "repo_digest",
    "developer_hash",
  ]) {
    const result = normalizeTenantRecord({ ...tenantRecord(), [key]: "x" });
    assert.equal(result.status, "rejected", `key ${key} must be rejected`);
    assert.match(
      result.entry.reason_code,
      /^(forbidden_|unknown_input_field)/,
      `key ${key}: ${result.entry.reason_code}`,
    );
  }
});

test("exact timestamps cannot be smuggled in under any near-miss name", () => {
  for (const key of ["timestamp", "finished_at", "started_time", "completed_date"]) {
    const result = normalizeTenantRecord({ ...tenantRecord(), [key]: 1756160000000 });
    assert.equal(result.status, "rejected", key);
  }
});

test("prototype-chain keys cannot bypass the fail-closed allowlist", () => {
  // A own enumerable "__proto__" property (not the prototype setter) must
  // still be seen by Object.keys() and rejected like any unknown key.
  const sneaky = tenantRecord();
  Object.defineProperty(sneaky, "__proto__", {
    value: { injected: true },
    enumerable: true,
    configurable: true,
    writable: true,
  });
  const result = normalizeTenantRecord(sneaky);
  assert.equal(result.status, "rejected");
  assert.match(result.entry.reason_code, /^(forbidden_|unknown_input_field)$/);
});

test("constructor-pollution style keys are rejected, not merged", () => {
  const sneaky = { ...tenantRecord(), constructor: { customer_id: "x" } };
  const result = normalizeTenantRecord(sneaky);
  assert.equal(result.status, "rejected");
  assert.equal(result.entry.reason_code, "unknown_input_field");
});

test("raw magnitudes are bucketed and never accepted as identifiers", () => {
  // Negative cost is invalid.
  let result = normalizeTenantRecord(tenantRecord({ cost_usd: -5 }));
  assert.equal(result.status, "rejected");
  assert.equal(result.entry.reason_code, "negative_value");

  // Fractional counts are invalid.
  result = normalizeTenantRecord(tenantRecord({ retry_count: 1.5 }));
  assert.equal(result.status, "rejected");
  assert.equal(result.entry.reason_code, "non_integer_count");

  // Stringly-typed numbers are invalid.
  result = normalizeTenantRecord(tenantRecord({ tool_calls: "7" }));
  assert.equal(result.status, "rejected");
  assert.equal(result.entry.reason_code, "invalid_number");
});

test("missing required semantic fields are rejected", () => {
  for (const field of ["task_class", "language_family", "outcome"]) {
    const rec = tenantRecord();
    delete rec[field];
    const result = normalizeTenantRecord(rec);
    assert.equal(result.status, "rejected", field);
    assert.equal(result.entry.reason_code, "missing_required_field");
  }
});

test("free text in typed enum slots can never enter a record", () => {
  const result = normalizeTenantRecord(
    tenantRecord({ task_class: "please review https://internal.invalid/pr/12" }),
  );
  assert.equal(result.status, "rejected");
  assert.equal(result.entry.reason_code, "invalid_enum_value");
});
