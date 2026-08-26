import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AUDIT_MAPPING_VERSION,
  GLOBAL_BENCHMARK_CONTRIBUTION,
  deriveCiResult,
  exportGlobalLearningRecords,
  mapAuditTaskToPrivacyInput,
  mapOutcome,
} from "../src/index.js";
import {
  fakeCommitDigest,
} from "./helpers/sensitive.js";

/**
 * WC-003 / factory A10: producer-mapping round trip over REALISTIC audit data.
 *
 * The core lane's TenantLedger.audit() emits task aggregates that are FULL of
 * linkable material: task refs, execution refs, revision keys, PR refs,
 * component refs, equivalence keys, adapter names, exact timestamps and free
 * text detail strings. These fixtures replicate that shape (per the canonical
 * event schema) with deliberately poisoned identifier content, then prove the
 * producer mapping + privacy gate strip every trace before export.
 */

const PURPOSE = GLOBAL_BENCHMARK_CONTRIBUTION;

// Fictional tenant identity markers (harmless words; must NEVER survive).
const ORG_MARKER = "orbit-garage-holdings";
const REPO_MARKER = "zebra-quartz-engine";
const BRANCH_MARKER = "sneaky-feature-branch";
const DIGEST_PREFIX = fakeCommitDigest().slice(0, 8);
const ISO_STAMP = "2026-08-01T00:00:00Z";

const cost = (microUsd) => ({ known: true, micro_usd: microUsd });
const UNKNOWN_COST = { known: false, reason: "not priceable from observed evidence" };

/** One model-invocation component in canonical aggregate shape. */
function mi(ref, microUsd, extraPayload = {}) {
  return {
    ref,
    kind: "inference",
    seq: 10,
    cost: microUsd === null ? UNKNOWN_COST : cost(microUsd),
    payload: { invocation_ref: ref, status: "ok", ...extraPayload },
  };
}

function tool(ref, microUsd) {
  return {
    ref,
    kind: "tools",
    seq: 11,
    cost: cost(microUsd),
    payload: { tool_ref: ref, status: "ok" },
  };
}

function compute(ref, microUsd) {
  return {
    ref,
    kind: "compute",
    seq: 12,
    cost: cost(microUsd),
    payload: { resource_ref: ref },
  };
}

function ciRun(ref, status, microUsd) {
  return {
    ref,
    kind: "ci",
    seq: 13,
    cost: cost(microUsd),
    payload: {
      ci_ref: ref,
      status,
      equivalence_key: `rev::${BRANCH_MARKER}::config-standard`,
      started_at: ISO_STAMP,
      finished_at: ISO_STAMP,
    },
  };
}

function human(ref) {
  return {
    ref,
    kind: "human",
    seq: 14,
    cost: UNKNOWN_COST,
    payload: { intervention_ref: ref, intervention_class: "credential_fix" },
  };
}

let repeatCounter = 0;

/**
 * Build one realistic audit task aggregate for a scenario, with every
 * identifier-shaped field poisoned by fictional tenant markers.
 */
function auditTask(scenario) {
  repeatCounter += 1;
  const n = repeatCounter;
  const T = `${scenario.taskRefBase}/${ORG_MARKER}/${REPO_MARKER}#${n}`;
  const EX = `EX-${DIGEST_PREFIX}-${n}`;
  const revision = `${DIGEST_PREFIX}${String(n).padStart(4, "0")}`;

  const base = {
    taskRef: T,
    startedSeq: n * 100,
    lastSeq: n * 100 + 9,
    lastTime: ISO_STAMP.replace("00:00:00", `00:${String(n % 60).padStart(2, "0")}:00`),
    eventCount: 9 + n,
    adapters: ["github"],
    executions: [
      {
        executionRef: EX,
        revisionKey: revision,
        status: scenario.executionStatus ?? "completed",
        failureClass: null,
        supersededBy: null,
        startedSeq: n * 100 + 1,
        finishedSeq: n * 100 + 8,
        components: {
          modelInvocations: [],
          toolInvocations: [],
          computeUsage: [],
          ciRuns: [],
          validations: [],
          humanInterventions: [],
        },
      },
    ],
    unassignedComponents: {
      modelInvocations: [],
      toolInvocations: [],
      computeUsage: [],
      ciRuns: [],
      validations: [],
      humanInterventions: [],
    },
    pullRequests: [{ prRef: `PR-${700 + n}`, created: true, closed: false, merged: false }],
    retries: 0,
    humanReworkEvents: 0,
    revertSignals: 0,
    outcome: {
      kind: "unresolved",
      attribution: "partial",
      detail: `no terminal signal for ${T} pull request PR-${700 + n}`,
      mergedPrRefs: [],
      reverted: false,
    },
  };

  const comps = base.executions[0].components;
  switch (scenario.name) {
    case "accepted_simple":
      comps.modelInvocations.push(
        mi(`MI-${n}-1/${ORG_MARKER}`, 2_000_000, { tokens_in: 12000, tokens_out: 4000 }),
        mi(`MI-${n}-2/${ORG_MARKER}`, 1_500_000, { tokens_in: 9000, tokens_out: 3100 }),
      );
      comps.toolInvocations.push(
        tool(`TI-${n}-a`, 100_000),
        tool(`TI-${n}-b`, 100_000),
        tool(`TI-${n}-c`, 100_000),
      );
      comps.computeUsage.push(compute(`CU-${n}`, 200_000));
      comps.ciRuns.push(ciRun(`CI-${n}-1`, "passed", 400_000));
      base.pullRequests[0].merged = true;
      base.outcome = {
        kind: "accepted",
        attribution: "measured",
        detail: `merged pull request evidence: PR-${700 + n}`,
        mergedPrRefs: [`PR-${700 + n}`],
        reverted: false,
      };
      break;

    case "failed_pr_closed":
      comps.modelInvocations.push(mi(`MI-${n}-1`, 1_000_000)); // no tokens reported
      comps.ciRuns.push(ciRun(`CI-${n}-1`, "failed", 250_000));
      base.pullRequests[0].closed = true;
      base.retries = 1;
      base.outcome = {
        kind: "failed",
        attribution: "measured",
        detail: `pull request PR-${700 + n} closed without merge`,
        mergedPrRefs: [],
        reverted: false,
      };
      break;

    case "aborted":
      comps.modelInvocations.push(mi(`MI-${n}-1`, 800_000)); // no tokens reported
      comps.toolInvocations.push(tool(`TI-${n}-a`, 50_000));
      base.executions[0].status = "aborted";
      base.outcome = {
        kind: "aborted",
        attribution: "measured",
        detail: "task_aborted signal observed",
        mergedPrRefs: [],
        reverted: false,
      };
      break;

    case "accepted_reverted":
      comps.modelInvocations.push(
        mi(`MI-${n}-1`, 5_000_000, { tokens_in: 8000, tokens_out: 2000 }),
      );
      for (let k = 0; k < 6; k++) comps.toolInvocations.push(tool(`TI-${n}-${k}`, 50_000));
      comps.ciRuns.push(
        ciRun(`CI-${n}-pass`, "passed", 150_000),
        ciRun(`CI-${n}-cancel`, "cancelled", 150_000),
      );
      base.retries = 2;
      base.revertSignals = 1;
      base.pullRequests[0].merged = true;
      base.outcome = {
        kind: "accepted",
        attribution: "measured",
        detail: `merged then reverted: PR-${700 + n}`,
        mergedPrRefs: [`PR-${700 + n}`],
        reverted: true,
      };
      break;

    case "unresolved_human":
      comps.modelInvocations.push(mi(`MI-${n}-1`, null)); // unknown cost, no tokens
      comps.humanInterventions.push(human(`HI-${n}`));
      comps.computeUsage.push(compute(`CU-${n}`, 20_000));
      base.humanReworkEvents = 1;
      base.outcome = {
        kind: "unresolved",
        attribution: "partial",
        detail: "no terminal outcome signal in observed evidence",
        mergedPrRefs: [],
        reverted: false,
      };
      break;

    default:
      throw new Error(`unknown scenario ${scenario.name}`);
  }
  return base;
}

const SCENARIOS = [
  {
    name: "accepted_simple",
    taskRefBase: "TASK-S1",
    hints: {
      task_class: "bug_fix",
      language_family: "python",
      repo_size_bucket: "m",
      dependency_complexity: "medium",
      orchestration_pattern: "single_agent",
      files_touched_count: 4,
      agent_name: "night-coding-agent",
      model_name: "mid-size-model",
    },
  },
  {
    name: "failed_pr_closed",
    taskRefBase: "TASK-S2",
    hints: {
      task_class: "feature_addition",
      language_family: "javascript_typescript",
      agent_name: "ci-runner-bot",
    },
  },
  {
    name: "aborted",
    taskRefBase: "TASK-S3",
    hints: { task_class: "incident_response", language_family: "go" },
  },
  {
    name: "accepted_reverted",
    taskRefBase: "TASK-S4",
    hints: { task_class: "dependency_upgrade", language_family: "rust" },
  },
  {
    name: "unresolved_human",
    taskRefBase: "TASK-S5",
    hints: { task_class: "documentation", language_family: "python" },
  },
];

function realisticBatch() {
  const tasks = [];
  for (let repeat = 0; repeat < 5; repeat++) {
    for (const scenario of SCENARIOS) {
      tasks.push(mapAuditTaskToPrivacyInput(auditTask(scenario), scenario.hints));
    }
  }
  return tasks;
}

test("realistic audit aggregates round-trip through gate to a fully admitted export", () => {
  const inputs = realisticBatch();
  assert.equal(inputs.length, 25);
  const result = exportGlobalLearningRecords({ purpose: PURPOSE, records: inputs });
  assert.equal(result.counts.provided, 25);
  assert.equal(result.counts.accepted, 25, JSON.stringify(result.rejected));
  assert.equal(result.counts.suppressed, 0);
  assert.equal(result.counts.rejected, 0);
});

test("no poisoned identifier from real audit shapes reaches the export envelope", () => {
  const result = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: realisticBatch(),
  });
  const serialized = JSON.stringify(result);
  const forbiddenTraces = [
    ORG_MARKER,
    REPO_MARKER,
    BRANCH_MARKER,
    DIGEST_PREFIX, // commit-digest-shaped revision key fragment
    "PR-70", // PR reference numbers
    ISO_STAMP, // exact timestamp
    "2026-08", // timestamp date fragment
    "github", // adapter fingerprint
    "TASK-", // task-ref prefix
    "EX-", // execution-ref prefix
    "equivalence_key",
    "revisionKey",
    "lastTime",
    "detail",
  ];
  for (const trace of forbiddenTraces) {
    assert.ok(!serialized.includes(trace), `identifier trace leaked into export: ${trace}`);
  }
});

test("abstract economics derived from aggregates land in the correct buckets", () => {
  const result = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: realisticBatch(),
  });
  const byTaskClass = Object.groupBy(result.accepted, (r) => r.task_class);

  // S1 accepted simple: $4.40 measured across inference/tools/compute/ci.
  const s1 = byTaskClass.bug_fix[0];
  assert.equal(s1.cost_bucket, "1_to_10");
  assert.equal(s1.token_bucket, "10k_to_100k"); // 28100 tokens
  assert.equal(s1.tool_call_bucket, "2_to_5");
  assert.equal(s1.retry_bucket, "zero");
  assert.equal(s1.ci_result, "passed");
  assert.equal(s1.human_intervention, false);
  assert.equal(s1.outcome, "pr_merged");
  assert.equal(s1.agent_family, "cli_coding_agent");

  // S2 closed-unmerged failure: $1.25, partial token coverage stays unknown.
  const s2 = byTaskClass.feature_addition[0];
  assert.equal(s2.cost_bucket, "1_to_10");
  assert.equal(s2.token_bucket, "unknown");
  assert.equal(s2.tool_call_bucket, "zero");
  assert.equal(s2.retry_bucket, "one");
  assert.equal(s2.ci_result, "failed");
  assert.equal(s2.outcome, "task_failed");

  // S3 aborted: $0.85, no CI at all.
  const s3 = byTaskClass.incident_response[0];
  assert.equal(s3.cost_bucket, "under_1");
  assert.equal(s3.tool_call_bucket, "one");
  assert.equal(s3.ci_result, "none");
  assert.equal(s3.outcome, "task_aborted");

  // S4 merged-but-reverted: honest revert outcome, mixed CI, coarse counts.
  const s4 = byTaskClass.dependency_upgrade[0];
  assert.equal(s4.cost_bucket, "1_to_10"); // $5.60
  assert.equal(s4.token_bucket, "10k_to_100k"); // exactly 10000 -> upper bucket edge
  assert.equal(s4.tool_call_bucket, "6_to_20");
  assert.equal(s4.retry_bucket, "2_to_3");
  assert.equal(s4.ci_result, "mixed");
  assert.equal(s4.outcome, "revert");

  // S5 unresolved with unpriceable human work: only MEASURED money counts.
  const s5 = byTaskClass.documentation[0];
  assert.equal(s5.cost_bucket, "under_1"); // only the known compute $0.02
  assert.equal(s5.human_intervention, true);
  assert.equal(s5.token_bucket, "unknown");
  assert.equal(s5.ci_result, "none");
  assert.equal(s5.outcome, "task_started");
});

test("wall-clock durations stay unknown: exact timestamps never feed the gate", () => {
  const result = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: realisticBatch(),
  });
  for (const record of result.accepted) {
    assert.equal(record.duration_bucket, "unknown");
  }
});

test("identifiers varying across repeats do NOT split abstract cohorts", () => {
  // Five repeats of each scenario differ ONLY in identifiers; their abstract
  // combinations are identical, so each forms one 5-member cohort.
  const result = exportGlobalLearningRecords({
    purpose: PURPOSE,
    aggregateOnly: true,
    records: realisticBatch(),
  });
  assert.deepEqual(
    result.cohorts.map((c) => c.size).sort((a, b) => a - b),
    [5, 5, 5, 5, 5],
  );
});

test("mapped-batch exports remain deterministic", () => {
  const a = JSON.stringify(
    exportGlobalLearningRecords({ purpose: PURPOSE, records: realisticBatch() }),
  );
  const b = JSON.stringify(
    exportGlobalLearningRecords({ purpose: PURPOSE, records: realisticBatch() }),
  );
  assert.equal(a, b);
});

test("hints override derived magnitudes; forbidden hints reject through the chain", () => {
  const task = auditTask(SCENARIOS[0]);
  const overridden = mapAuditTaskToPrivacyInput(task, {
    ...SCENARIOS[0].hints,
    cost_bucket: "100_to_1000", // explicit pre-bucketed value wins over $4.40
  });
  const normalized = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: Array.from({ length: 5 }, () => ({ ...overridden })),
  });
  assert.equal(normalized.counts.accepted, 5);
  assert.equal(normalized.accepted[0].cost_bucket, "100_to_1000");

  const smuggled = mapAuditTaskToPrivacyInput(task, {
    ...SCENARIOS[0].hints,
    repository_url: `https://git.invalid/${ORG_MARKER}/${REPO_MARKER}`,
  });
  const rejected = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: Array.from({ length: 5 }, () => ({ ...smuggled })),
  });
  assert.equal(rejected.counts.accepted, 0);
  assert.match(rejected.rejected[0].reason_code, /^forbidden_/);
});

test("structurally invalid audit aggregates are refused, never silently mapped", () => {
  const good = auditTask(SCENARIOS[0]);

  assert.throws(() => mapAuditTaskToPrivacyInput(null), TypeError);
  assert.throws(
    () => mapAuditTaskToPrivacyInput({ ...good, outcome: { kind: "merged_pr" } }),
    TypeError,
  );
  assert.throws(() => mapAuditTaskToPrivacyInput({ ...good, retries: -1 }), TypeError);
  assert.throws(
    () =>
      mapAuditTaskToPrivacyInput({
        ...good,
        executions: [
          {
            ...good.executions[0],
            components: {
              ...good.executions[0].components,
              ciRuns: [
                {
                  ref: "X",
                  kind: "ci",
                  cost: cost(1),
                  payload: { ci_ref: "X", status: "sort_of_passed" },
                },
              ],
            },
          },
        ],
      }),
    TypeError,
  );
  assert.throws(
    () =>
      mapAuditTaskToPrivacyInput({
        ...good,
        executions: [
          {
            ...good.executions[0],
            components: {
              ...good.executions[0].components,
              computeUsage: [
                { ref: "X", kind: "compute", cost: { known: true, micro_usd: -5 }, payload: {} },
              ],
            },
          },
        ],
      }),
    TypeError,
  );
});

test("outcome and CI derivations follow the conservative mapping contract", () => {
  assert.equal(mapOutcome({ kind: "accepted", reverted: false }), "pr_merged");
  assert.equal(mapOutcome({ kind: "accepted", reverted: true }), "revert");
  assert.equal(mapOutcome({ kind: "failed", reverted: false }), "task_failed");
  assert.equal(mapOutcome({ kind: "aborted", reverted: false }), "task_aborted");
  assert.equal(mapOutcome({ kind: "unresolved", reverted: false }), "task_started");
  assert.throws(() => mapOutcome({ kind: "vibes" }), TypeError);

  assert.equal(deriveCiResult([]), undefined);
  assert.equal(deriveCiResult([{ payload: { status: "passed" } }]), "passed");
  assert.equal(deriveCiResult([{ payload: { status: "failed" } }]), "failed");
  assert.equal(deriveCiResult([{ payload: { status: "timed_out" } }]), "failed");
  assert.equal(
    deriveCiResult([{ payload: { status: "passed" } }, { payload: { status: "cancelled" } }]),
    "mixed",
  );
  assert.throws(() => deriveCiResult([{ payload: { status: "green" } }]), TypeError);
});

test("the producer mapping itself is versioned for reproducible transforms", () => {
  assert.match(AUDIT_MAPPING_VERSION, /^\d+\.\d+\.\d+$/);
});
