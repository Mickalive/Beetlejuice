import { test } from "node:test";
import assert from "node:assert/strict";
import { detectCertainWaste, CANONICAL_RULE_CLASSES } from "../src/waste.js";
import { validateNormalizedBundle } from "../src/schema.js";
import { loadSyntheticFixture } from "../src/synthetic.js";

function fixtureRecords() {
  return validateNormalizedBundle(loadSyntheticFixture()).records;
}

test("fixture yields exactly the four planted certain-waste findings (micro-USD)", () => {
  const { findings } = detectCertainWaste(fixtureRecords());
  assert.deepEqual(
    findings.map((f) => [f.task_id, f.rule_id, f.claimed_execution_ids[0], f.avoided_cost_micro_usd]),
    [
      ["T-002", "SUPERSEDED_EXECUTION", "e-01", 4_150_000],
      ["T-003", "IDENTICAL_RETRY_AFTER_DETERMINISTIC_FAILURE", "e-02", 1_830_000],
      ["T-004", "EXECUTION_AFTER_TASK_ABORT", "e-02", 2_070_000],
      ["T-004", "EXECUTION_AFTER_TASK_ABORT", "e-03", 940_000],
    ]
  );
});

test("every rule declares its canonical core class (unified vocabulary)", () => {
  assert.equal(CANONICAL_RULE_CLASSES.SUPERSEDED_EXECUTION, "WASTE_EXEC_SUPERSEDED_V1");
  assert.equal(
    CANONICAL_RULE_CLASSES.IDENTICAL_RETRY_AFTER_DETERMINISTIC_FAILURE,
    "WASTE_DET_RETRY_V1"
  );
  assert.equal(CANONICAL_RULE_CLASSES.EXECUTION_AFTER_TASK_ABORT, null);
  for (const finding of detectCertainWaste(fixtureRecords()).findings) {
    assert.equal(finding.canonical_rule_class, CANONICAL_RULE_CLASSES[finding.rule_id]);
  }
});

test("negative controls produce no findings (flaky retry, clean abort, pre-abort execution)", () => {
  const { findings } = detectCertainWaste(fixtureRecords());
  const keys = new Set(findings.map((f) => f.finding_key));
  // T-001 e-02: retry after a FLAKY failure — not certain waste.
  assert.ok(!keys.has("T-001/IDENTICAL_RETRY_AFTER_DETERMINISTIC_FAILURE/e-02"));
  // T-005: aborted but nothing ran after the abort — nothing provably avoidable.
  assert.ok(![...keys].some((k) => k.startsWith("T-005/")));
  // T-004 e-01 started before the abort — not certainly avoidable ex ante.
  assert.ok(!keys.has("T-004/EXECUTION_AFTER_TASK_ABORT/e-01"));
});

test("every finding is 'certain' and carries evidence + recommendation", () => {
  const { findings } = detectCertainWaste(fixtureRecords());
  assert.ok(findings.length > 0);
  for (const finding of findings) {
    assert.equal(finding.confidence, "certain");
    assert.ok(finding.explanation.length > 20);
    assert.ok(finding.recommended_action.length > 10);
    assert.ok(finding.evidence.length >= 2, "cost evidence plus rule evidence required");
    assert.equal(
      finding.avoided_cost_micro_usd,
      finding.evidence.find((e) => e.kind === "execution_cost").amount_micro_usd
    );
  }
});

test("avoidable spend is summed without double counting (single-claim attribution)", () => {
  const { findings, suppressed_for_double_counting } = detectCertainWaste(fixtureRecords());
  const claimed = findings.flatMap((f) => f.claimed_execution_ids.map((id) => `${f.task_id}::${id}`));
  assert.equal(new Set(claimed).size, claimed.length, "an execution may be claimed at most once");
  assert.equal(suppressed_for_double_counting, 0);

  // Craft an execution that matches two rules at once (superseded AND after abort):
  // only one finding survives; the second candidate is suppressed.
  const base = structuredClone(loadSyntheticFixture());
  const task = structuredClone(base.records.find((r) => r.task_id === "T-004")); // aborted
  task.task_id = "T-DUP";
  task.executions[1].superseded_by_execution_id = "e-03";
  task.executions[0].superseded_by_execution_id = null;
  const bundle = { ...base, records: [task] };
  const result = detectCertainWaste(validateNormalizedBundle(bundle).records);
  assert.equal(result.suppressed_for_double_counting, 1);
  const dupTaskFindings = result.findings.filter((f) => f.task_id === "T-DUP");
  const claimedExecs = dupTaskFindings.flatMap((f) => f.claimed_execution_ids);
  assert.equal(new Set(claimedExecs).size, claimedExecs.length);
});

test("identical-retry rule requires BOTH deterministic classification and identical signature", () => {
  const base = structuredClone(loadSyntheticFixture());
  const t3 = structuredClone(base.records.find((r) => r.task_id === "T-003"));
  t3.task_id = "T-R1";
  // Same signature but prior failure reclassified as transient -> NO finding.
  t3.executions[0].failure_category = "transient";
  let r = detectCertainWaste(validateNormalizedBundle({ ...base, records: [t3] }).records);
  assert.ok(!r.findings.some((f) => f.task_id === "T-R1"));

  // Deterministic prior but different work signature -> NO finding.
  const t3b = structuredClone(base.records.find((r) => r.task_id === "T-003"));
  t3b.task_id = "T-R2";
  t3b.executions[1].work_signature = "ws-mig-lock-v2-changed";
  r = detectCertainWaste(validateNormalizedBundle({ ...base, records: [t3b] }).records);
  assert.ok(!r.findings.some((f) => f.task_id === "T-R2"));
});

test("finding output is deterministically ordered across runs", () => {
  const a = detectCertainWaste(fixtureRecords()).findings;
  const b = detectCertainWaste([...fixtureRecords()].reverse()).findings;
  assert.deepEqual(
    a.map((f) => f.finding_key),
    b.map((f) => f.finding_key)
  );
});

// ---------------------------------------------------------------------------
// Adversarial regression tests (product audit defects D2/D4, repairs R2/R4).
// A "certain" finding must survive contradictory evidence attempts.
// ---------------------------------------------------------------------------

function minimalBundleWithTask(taskId, executions, outcome = { status: "accepted" }) {
  return {
    schema_version: "2",
    normalization_version: "1",
    collector_version: "test-1.0.0",
    records: [
      {
        record_type: "agentic_task",
        task_id: taskId,
        started_at: executions[0].started_at,
        ended_at: null,
        outcome,
        executions,
      },
    ],
  };
}

function exec(id, startedAt, extra = {}) {
  return {
    execution_id: id,
    agent: { family: "coding-agent", model_class: "frontier" },
    started_at: startedAt,
    ended_at: null,
    components: { inference: { amount_micro_usd: 1_000_000, basis: "measured" } },
    total_amount_micro_usd: 1_000_000,
    ...extra,
  };
}

test("R2 guard: a retry that itself SUCCEEDED is never certain waste (audit defect D2)", () => {
  // Exact reproduction of adversarial probe B: accepted task; e-01 failed
  // deterministically; identical-signature retry e-02 succeeded (no recorded
  // failure). Flagging e-02 would charge the very call that delivered the
  // outcome — falsifiable "certainty" is forbidden.
  const bundle = minimalBundleWithTask("T-D2", [
    exec("e-01", "2026-08-10T09:00:00Z", {
      work_signature: "sig-K1",
      failure_category: "deterministic",
    }),
    exec("e-02", "2026-08-10T10:00:00Z", {
      work_signature: "sig-K1",
      retry_of_execution_id: "e-01",
      // no failure_category => observed success / unknown outcome
    }),
  ]);
  const r = detectCertainWaste(validateNormalizedBundle(bundle).records);
  assert.equal(r.findings.length, 0);
  assert.equal(r.guards_abstained.retry_without_recorded_failure, 1);
});

test("R2 guard still flags retries whose own outcome is a recorded failure", () => {
  const bundle = minimalBundleWithTask("T-R2OK", [
    exec("e-01", "2026-08-10T09:00:00Z", {
      work_signature: "sig-K1",
      failure_category: "deterministic",
    }),
    exec("e-02", "2026-08-10T10:00:00Z", {
      work_signature: "sig-K1",
      retry_of_execution_id: "e-01",
      failure_category: "flaky",
    }),
  ]);
  const r = detectCertainWaste(validateNormalizedBundle(bundle).records);
  assert.deepEqual(r.findings.map((f) => f.finding_key), [
    "T-R2OK/IDENTICAL_RETRY_AFTER_DETERMINISTIC_FAILURE/e-02",
  ]);
  assert.equal(r.findings[0].rule_version, "1.1.0");
  const retryEvidence = r.findings[0].evidence.find(
    (e) => e.kind === "identical_retry_of_deterministic_failure"
  );
  assert.equal(retryEvidence.retry_failure_category, "flaky");
  assert.equal(r.guards_abstained.retry_without_recorded_failure, 0);
});

test("R2 chain: later retries of a successful attempt are not flagged", () => {
  const bundle = minimalBundleWithTask("T-CHAIN2", [
    exec("e-01", "2026-08-10T09:00:00Z", {
      work_signature: "sig-K1",
      failure_category: "deterministic",
    }),
    exec("e-02", "2026-08-10T10:00:00Z", {
      work_signature: "sig-K1",
      retry_of_execution_id: "e-01",
      failure_category: "deterministic",
    }),
    exec("e-03", "2026-08-10T11:00:00Z", {
      work_signature: "sig-K1",
      retry_of_execution_id: "e-02",
      // succeeded — delivered the accepted outcome
    }),
    exec("e-04", "2026-08-10T12:00:00Z", {
      work_signature: "sig-K1",
      retry_of_execution_id: "e-03",
      failure_category: "deterministic",
    }),
  ]);
  const r = detectCertainWaste(validateNormalizedBundle(bundle).records);
  assert.deepEqual(r.findings.map((f) => f.claimed_execution_ids[0]), ["e-02"]);
  assert.equal(r.guards_abstained.retry_without_recorded_failure, 1); // e-03 protected by R2
});

test("R4 guard: replacement must have started STRICTLY later (audit defect D4)", () => {
  // Reproduction of adversarial probe C/D variant: 'late' run claims it was
  // superseded by 'early', which actually STARTED EARLIER — contradictory
  // evidence must abstain, not emit certain waste.
  const base = structuredClone(loadSyntheticFixture());
  const t2 = structuredClone(base.records.find((r) => r.task_id === "T-002"));
  t2.task_id = "T-D4";
  t2.executions[0].superseded_by_execution_id = "e-03"; // valid: e-03 starts 11:25 > e-01 08:00
  t2.executions[1].superseded_by_execution_id = "e-01"; // invalid: e-01 starts 08:00 < e-02 09:45
  let r = detectCertainWaste(validateNormalizedBundle({ ...base, records: [t2] }).records);
  assert.deepEqual(
    r.findings.map((f) => f.claimed_execution_ids[0]),
    ["e-01"] // only the strictly-later supersession survives
  );
  assert.equal(r.guards_abstained.replacement_not_started_strictly_later, 1);

  // Equal start timestamps are also not strictly later -> abstain.
  const equal = minimalBundleWithTask("T-D4EQ", [
    exec("e-01", "2026-08-10T09:00:00Z", { superseded_by_execution_id: "e-02" }),
    exec("e-02", "2026-08-10T09:00:00Z"),
  ]);
  r = detectCertainWaste(validateNormalizedBundle(equal).records);
  assert.equal(r.findings.length, 0);
  assert.equal(r.guards_abstained.replacement_not_started_strictly_later, 1);
});

test("R4 guard keeps the legitimate strictly-later supersession finding", () => {
  const bundle = minimalBundleWithTask("T-D4OK", [
    exec("e-01", "2026-08-10T09:00:00Z", { superseded_by_execution_id: "e-02" }),
    exec("e-02", "2026-08-10T09:30:00Z"),
  ]);
  const r = detectCertainWaste(validateNormalizedBundle(bundle).records);
  assert.deepEqual(
    r.findings.map((f) => [f.rule_id, f.claimed_execution_ids[0]]),
    [["SUPERSEDED_EXECUTION", "e-01"]]
  );
  assert.equal(r.findings[0].rule_version, "1.1.0");
  assert.ok(r.findings[0].explanation.includes("strictly later"));
});
