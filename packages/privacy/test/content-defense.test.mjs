import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AGENT_FAMILY,
  CI_RESULT,
  COST_BUCKET,
  DEPENDENCY_COMPLEXITY,
  DURATION_BUCKET,
  FILE_COUNT_BUCKET,
  LANGUAGE_FAMILY,
  MODEL_CLASS,
  ORCHESTRATION_PATTERN,
  OUTCOME,
  REPO_SIZE_BUCKET,
  RETRY_BUCKET,
  TASK_CLASS,
  TOKEN_BUCKET,
  TOOL_CALL_BUCKET,
  exportGlobalLearningRecords,
  scanString,
  shannonEntropy,
} from "../src/index.js";
import { tenantRecord } from "./helpers/fixtures.js";
import { allSensitivePayloads } from "./helpers/sensitive.js";

const ALL_VOCABULARIES = [
  AGENT_FAMILY,
  CI_RESULT,
  COST_BUCKET,
  DEPENDENCY_COMPLEXITY,
  DURATION_BUCKET,
  FILE_COUNT_BUCKET,
  LANGUAGE_FAMILY,
  MODEL_CLASS,
  ORCHESTRATION_PATTERN,
  OUTCOME,
  REPO_SIZE_BUCKET,
  RETRY_BUCKET,
  TASK_CLASS,
  TOKEN_BUCKET,
  TOOL_CALL_BUCKET,
];

test("every legitimate vocabulary label passes content defense (no false positives)", () => {
  for (const vocab of ALL_VOCABULARIES) {
    for (const label of vocab) {
      const { findings } = scanString(label);
      assert.deepEqual(
        findings,
        [],
        `label "${label}" must not trip the scanner`,
      );
    }
  }
});

test("every fake sensitive payload is detected", () => {
  for (const { name, value } of allSensitivePayloads()) {
    const v = value();
    const { findings } = scanString(v);
    assert.ok(findings.length > 0, `${name} (${v.length} chars) must be detected`);
  }
});

test("findings are reason codes only — the offending value is never echoed", () => {
  for (const { name, value } of allSensitivePayloads()) {
    const v = value();
    const { findings } = scanString(v);
    for (const code of findings) {
      assert.equal(typeof code, "string");
      assert.ok(!code.includes(v), `${name}: finding leaked the value`);
      assert.match(code, /_detected$/);
    }
  }
});

test("sensitive payloads injected via free-text identity fields reject the record", () => {
  for (const { name, value } of allSensitivePayloads()) {
    const v = value();
    const result = exportGlobalLearningRecords({
      purpose: "GLOBAL_BENCHMARK_CONTRIBUTION",
      records: [tenantRecord({ agent_name: `agent ${v}` })],
    });
    assert.equal(result.counts.accepted, 0, `${name} must not be exported`);
    assert.equal(result.rejected.length, 1);
    assert.match(
      result.rejected[0].reason_code,
      /_detected$/,
      `${name}: expected a content-defense reason`,
    );
    // Nothing about the payload may appear anywhere in the envelope.
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(v), `${name} leaked into the export output`);
  }
});

test("content-defense rejections raise the privacy-risk level to high", () => {
  // The risk summary must reflect that smuggling was attempted and blocked.
  for (const { name, value } of allSensitivePayloads().slice(0, 5)) {
    const result = exportGlobalLearningRecords({
      purpose: "GLOBAL_BENCHMARK_CONTRIBUTION",
      records: [
        ...Array.from({ length: 5 }, () => tenantRecord()),
        tenantRecord({ agent_name: `agent ${value()}` }),
      ],
    });
    assert.equal(result.privacy_risk.risk_level, "high", name);
  }
});

test("benign custom agent names classify without leaking the raw name", () => {
  const cases = [
    ["night-coding-agent", "cli_coding_agent"],
    ["ci-runner-bot", "ci_bot"],
    ["ide-helper-editor", "ide_assistant"],
    ["cloud-autonomous-worker", "cloud_autonomous_agent"],
    ["orchestra-framework-x", "orchestrator_framework"],
    ["pipeline-scheduler-job", "scripted_pipeline"],
    ["mysterious-thing", "custom"],
  ];
  for (const [raw, family] of cases) {
    const result = exportGlobalLearningRecords({
      purpose: "GLOBAL_BENCHMARK_CONTRIBUTION",
      records: Array.from({ length: 5 }, () => tenantRecord({ agent_name: raw })),
    });
    assert.equal(result.counts.accepted, 5, raw);
    assert.equal(result.accepted[0].agent_family, family, raw);
    assert.ok(!JSON.stringify(result).includes(raw), raw);
  }
});

test("entropy heuristic separates vocabulary labels from generated secrets", () => {
  const maxVocabEntropy = Math.max(
    ...ALL_VOCABULARIES.flatMap((v) => v).map((l) => shannonEntropy(l)),
  );
  assert.ok(maxVocabEntropy < 4.0, `vocab entropy too high: ${maxVocabEntropy}`);
});
