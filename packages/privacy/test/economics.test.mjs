import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GLOBAL_BENCHMARK_CONTRIBUTION,
  exportGlobalLearningRecords,
  isValidGlobalLearningRecord,
} from "../src/index.js";
import { expectedDefaultGlobalRecord, tenantRecord } from "./helpers/fixtures.js";

const PURPOSE = GLOBAL_BENCHMARK_CONTRIBUTION;

/**
 * Acceptance criterion (WC-003): output contains enough abstract
 * economics/outcome information for future benchmarking.
 */
const BENCHMARK_FIELDS = [
  "record_type",
  "task_class",
  "language_family",
  "repo_size_bucket",
  "dependency_complexity",
  "files_touched_bucket",
  "agent_family",
  "model_class",
  "orchestration_pattern",
  "cost_bucket",
  "duration_bucket",
  "token_bucket",
  "tool_call_bucket",
  "retry_bucket",
  "ci_result",
  "human_intervention",
  "outcome",
];

test("accepted records preserve the full abstract economics + outcome surface", () => {
  const result = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: Array.from({ length: 5 }, () => tenantRecord()),
  });
  assert.equal(result.counts.accepted, 5);
  const record = result.accepted[0];
  assert.ok(isValidGlobalLearningRecord(record));
  for (const field of BENCHMARK_FIELDS) {
    assert.notEqual(record[field], undefined, `benchmark field missing: ${field}`);
  }
});

test("raw magnitudes are fully replaced by their buckets", () => {
  const result = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: Array.from({ length: 5 }, () => tenantRecord({ cost_usd: 123.45 })),
  });
  const json = JSON.stringify(result.accepted);
  assert.ok(!json.includes("cost_usd"), "raw cost leaked");
  assert.ok(!json.includes("duration_ms"), "raw duration leaked");
  assert.ok(!json.includes("tokens_total"), "raw tokens leaked");
  assert.ok(!json.includes("123.45"), "exact cost value leaked");
});

test("the full tenant->global mapping is exact and documented by the fixture", () => {
  const result = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: Array.from({ length: 5 }, () => tenantRecord()),
  });
  assert.deepEqual(result.accepted[0], expectedDefaultGlobalRecord());
});

test("pre-bucketed inputs are honored without any raw magnitude", () => {
  const preBucketed = {
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
  assert.deepEqual(result.accepted[0], { record_type: "agentic_task_summary", ...preBucketed });
});

test("outcome vocabulary survives end-to-end for cost-per-outcome benchmarking", () => {
  const outcomes = ["pr_merged", "task_aborted", "ci_failed"];
  const records = [];
  for (const outcome of outcomes) {
    for (let i = 0; i < 5; i++) {
      records.push(
        tenantRecord({
          outcome,
          ...(outcome === "ci_failed" ? { ci_result: "failed", task_class: "bug_fix" } : {}),
          ...(outcome === "pr_merged" ? {} : { ci_result: outcome === "task_aborted" ? "none" : "failed" }),
        }),
      );
    }
  }
  const result = exportGlobalLearningRecords({ purpose: PURPOSE, records });
  assert.equal(result.counts.accepted, 15);
  const seenOutcomes = new Set(result.accepted.map((r) => r.outcome));
  for (const outcome of outcomes) {
    assert.ok(seenOutcomes.has(outcome), `outcome ${outcome} missing`);
  }
});
