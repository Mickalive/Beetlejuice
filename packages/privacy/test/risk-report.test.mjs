import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GLOBAL_BENCHMARK_CONTRIBUTION,
  PRIVACY_RISK_LEVELS,
  exportGlobalLearningRecords,
  summarizePrivacyRisk,
} from "../src/index.js";
import { normalizeTenantRecord } from "../src/transform.js";
import { tenantRecord } from "./helpers/fixtures.js";

const PURPOSE = GLOBAL_BENCHMARK_CONTRIBUTION;

/**
 * WC-003 (advance): every export must carry a privacy-risk result that
 * explains which abstract dimensions were GENERALIZED (and how), which
 * combinations were SUPPRESSED, and why anything was REJECTED — without ever
 * leaking the offending content itself.
 */

test("raw magnitudes and names are reported as generalized fields", () => {
  const result = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: Array.from({ length: 5 }, () => tenantRecord()),
  });
  assert.equal(result.counts.accepted, 5);
  // Every non-explicit derivation is explained, field by field.
  assert.deepEqual(result.privacy_risk.generalized_fields, {
    agent_family: { classified: 5 },
    cost_bucket: { bucketed: 5 },
    duration_bucket: { bucketed: 5 },
    files_touched_bucket: { bucketed: 5 },
    model_class: { classified: 5 },
    record_type: { defaulted: 5 },
    retry_bucket: { bucketed: 5 },
    token_bucket: { bucketed: 5 },
    tool_call_bucket: { bucketed: 5 },
  });
});

test("fully pre-bucketed exports report zero generalization", () => {
  const preBucketed = {
    record_type: "agentic_task_summary",
    task_class: "refactoring",
    language_family: "go",
    repo_size_bucket: "l",
    dependency_complexity: "high",
    orchestration_pattern: "multi_agent_pipeline",
    files_touched_bucket: "10_to_99",
    agent_family: "orchestrator_framework",
    model_class: "frontier_reasoning",
    cost_bucket: "100_to_1000",
    duration_bucket: "1h_to_6h",
    token_bucket: "over_1m",
    tool_call_bucket: "over_20",
    retry_bucket: "2_to_3",
    ci_result: "mixed",
    human_intervention: true,
    outcome: "human_rework",
  };
  const result = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: Array.from({ length: 5 }, () => ({ ...preBucketed })),
  });
  assert.equal(result.counts.accepted, 5);
  assert.deepEqual(result.privacy_risk.generalized_fields, {});
  assert.equal(result.privacy_risk.risk_level, "low");
});

test("generalization alone keeps the operational risk level at low", () => {
  // Bucketing/classifying is the gate doing its normal job; it must NOT be
  // reported as elevated risk when everything was admitted cleanly.
  const result = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: Array.from({ length: 5 }, () => tenantRecord()),
  });
  assert.equal(result.privacy_risk.risk_level, "low");
});

test("suppression raises the operational risk level to medium", () => {
  const result = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: [
      ...Array.from({ length: 5 }, () => tenantRecord()),
      tenantRecord({ task_class: "code_review" }),
    ],
  });
  assert.equal(result.counts.suppressed, 1);
  assert.equal(result.privacy_risk.risk_level, "medium");
  assert.equal(result.privacy_risk.suppressed_records, 1);
});

test("identifier/content smuggling attempts raise the risk level to high", () => {
  const attempts = [
    { customer_id: "leaky-corp-marker" }, // forbidden key
    { prompt_text: "please fix the login bug" }, // forbidden content key
  ];
  for (const smuggle of attempts) {
    const result = exportGlobalLearningRecords({
      purpose: PURPOSE,
      records: [
        ...Array.from({ length: 5 }, () => tenantRecord()),
        tenantRecord(smuggle),
      ],
    });
    assert.equal(result.counts.rejected, 1, Object.keys(smuggle)[0]);
    assert.equal(result.privacy_risk.risk_level, "high", Object.keys(smuggle)[0]);
    assert.ok(
      result.privacy_risk.rejected_reasons.some((r) =>
        r.reason_code.startsWith("forbidden_"),
      ),
    );
  }
});

test("rejection reasons are aggregated with counts in canonical order", () => {
  const result = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: [
      ...Array.from({ length: 5 }, () => tenantRecord()),
      tenantRecord({ task_class: "code_review" }), // suppressed (unique combo)
      tenantRecord({ customer_id: "leaky-corp-marker" }), // forbidden key
      tenantRecord({ cost_usd: -1 }), // negative_value
      tenantRecord({ cost_usd: -2 }), // negative_value again
    ],
  });
  assert.deepEqual(result.privacy_risk.rejected_reasons, [
    { reason_code: "forbidden_customer_or_tenant_field", count: 1 },
    { reason_code: "negative_value", count: 2 },
  ]);
  // Counts conservation holds in the risk block too.
  const { provided_records, candidate_records, admitted_records, suppressed_records, rejected_records } =
    result.privacy_risk;
  assert.equal(provided_records, 9);
  assert.equal(candidate_records, 6);
  assert.equal(admitted_records, 5);
  assert.equal(candidate_records, admitted_records + suppressed_records);
  assert.equal(provided_records, candidate_records + rejected_records);
});

test("the privacy-risk block never echoes offending keys' values or foreign key names", () => {
  const MARKER = "super-distinctive-leak-probe";
  const result = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: [
      ...Array.from({ length: 5 }, () => tenantRecord()),
      tenantRecord({ customer_id: MARKER }),
      tenantRecord({ agent_name: `agent ${MARKER} bot` }),
    ],
  });
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(MARKER), "offending value leaked into envelope");
  // Caller-controlled KEY names are redacted too (input-normalization 1.2.0):
  // only package-owned closed-vocabulary field names may be echoed.
  assert.ok(!serialized.includes("customer_id"), "foreign key name leaked");
  const redacted = result.rejected.find((r) => r.field_redacted === true);
  assert.ok(redacted, "foreign-key rejection must carry field_redacted");
  // Closed-vocabulary diagnostics survive: the content-defense rejection
  // still names the schema-owned field it scanned.
  assert.equal(
    result.rejected.some((r) => r.field === "agent_name"),
    true,
  );
});

test("privacy_risk is byte-stable across runs and independent of input order", () => {
  const makeBatch = () => [
    ...Array.from({ length: 5 }, () => tenantRecord()),
    tenantRecord({ task_class: "code_review" }),
    tenantRecord({ outcome: "task_aborted", ci_result: "none" }),
    tenantRecord({ outcome: "task_aborted", ci_result: "none" }),
    tenantRecord({ customer_id: "another-leaky-marker" }),
  ];
  const forward = exportGlobalLearningRecords({ purpose: PURPOSE, records: makeBatch() });
  const reversed = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: [...makeBatch()].reverse(),
  });
  const again = exportGlobalLearningRecords({ purpose: PURPOSE, records: makeBatch() });

  assert.deepEqual(forward.privacy_risk, again.privacy_risk);
  // Positional indexes differ under reversal, but the aggregated explanation
  // (levels, reasons, generalizations) must not.
  assert.equal(
    JSON.stringify(forward.privacy_risk),
    JSON.stringify(reversed.privacy_risk),
  );
});

test("aggregate-only exports still explain suppression and generalization", () => {
  const result = exportGlobalLearningRecords({
    purpose: PURPOSE,
    aggregateOnly: true,
    records: [
      ...Array.from({ length: 5 }, () => tenantRecord()),
      tenantRecord({ task_class: "code_review" }),
    ],
  });
  assert.ok(!("accepted" in result));
  assert.equal(result.privacy_risk.risk_level, "medium");
  // Provenance covers every NORMALIZED candidate (6), including the one the
  // cohort gate later suppressed: generalization happened at normalization
  // time regardless of admission.
  assert.equal(result.privacy_risk.generalized_fields.cost_bucket.bucketed, 6);
  assert.deepEqual(result.cohorts.map((c) => c.size).sort((a, b) => a - b), [5]);
});

test("summarizePrivacyRisk exposes exactly the documented shape", () => {
  const normalized = normalizeTenantRecord(tenantRecord());
  if (normalized.status !== "ok") throw new Error("fixture must normalize");
  const summary = summarizePrivacyRisk({
    provided: 2,
    candidates: [normalized],
    admittedCount: 0,
    suppressedCount: 1,
    rejected: [],
  });
  assert.deepEqual(Object.keys(summary), [
    "risk_level",
    "provided_records",
    "candidate_records",
    "admitted_records",
    "suppressed_records",
    "rejected_records",
    "rejected_reasons",
    "generalized_fields",
  ]);
  assert.ok(PRIVACY_RISK_LEVELS.includes(summary.risk_level));
});
