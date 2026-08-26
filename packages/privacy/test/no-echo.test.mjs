import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ECHOABLE_FIELD_NAMES,
  EXTERNAL_RESEARCH_DATA_LICENSING,
  GLOBAL_BENCHMARK_CONTRIBUTION,
  GLR_FIELD_ORDER,
  PRODUCT_TELEMETRY,
  exportGlobalLearningRecords,
  redactRejectionField,
} from "../src/index.js";
import { tenantRecord } from "./helpers/fixtures.js";
import { fakeCommitDigest } from "./helpers/sensitive.js";

/**
 * WC-003 hardening: the no-echo invariant applies to the WHOLE export
 * envelope, not only to accepted record values.
 *
 * A forbidden/unknown KEY NAME is itself caller-controlled free text. If the
 * gate echoed it back inside `rejected[].field`, a tenant could plant
 * org/repo/developer markers in key names and watch them travel into the
 * global layer even though their values were blocked. These tests prove that
 * every caller-controlled string is redacted (`field_redacted: true`) while
 * package-owned closed-vocabulary diagnostics survive.
 */

const PURPOSE = GLOBAL_BENCHMARK_CONTRIBUTION;

// Fictional tenant identity markers (harmless words; must NEVER survive).
const ORG_MARKER = "orbit-garage-holdings";
const REPO_MARKER = "zebra-quartz-engine";
const DEV_MARKER = "dana-developer-nine";

/**
 * Foreign keys whose NAMES match a forbidden-field class. The gate flags
 * them with a `forbidden_*` reason code AND raises the operational risk
 * level to high — but must still never echo the name itself.
 */
const SMUGGLED_KEY_NAMES = () => [
  `${ORG_MARKER}_customer_flag`,
  `repo_${REPO_MARKER}_branch`,
  `developer_${DEV_MARKER}`,
  `${REPO_MARKER}/deploy/url`,
  `access_token_holder_${ORG_MARKER}`,
  `commit_log_notes`,
  `source_file_path_${ORG_MARKER}`,
  `session_run_id_${DEV_MARKER}`,
  `created_at_${ORG_MARKER}`,
  `user_digest_map_${ORG_MARKER}`,
  `home/${DEV_MARKER}/notes`, // "developer" marker matches the identity class
];

/**
 * Foreign keys that match NO forbidden class: still fail closed as
 * `unknown_input_field` (medium risk), still never echoed back.
 */
const UNCLASSIFIED_HOSTILE_KEYS = () => [
  `${ORG_MARKER}_internal_flag`,
  `home/${ORG_MARKER}/notes`,
  `acme_division_${ORG_MARKER}_count`,
  fakeCommitDigest(), // digest-shaped KEY name
  "x".repeat(200), // overlong free-text key
  "Task_Class", // case-variation near miss
  "task_class_", // trailing-underscore near miss
  "__proto__",
  "constructor",
];

test("echoable field names form a closed, package-owned vocabulary", () => {
  for (const glrField of GLR_FIELD_ORDER) {
    assert.ok(
      ECHOABLE_FIELD_NAMES.includes(glrField),
      `GLR field ${glrField} must be echoable`,
    );
  }
  for (const name of ECHOABLE_FIELD_NAMES) {
    assert.match(name, /^[a-z][a-z0-9_]*$/, `non-schema-owned name: ${name}`);
    assert.ok(name.length <= 64, `name too long to be schema-owned: ${name}`);
  }
  assert.ok(Object.isFrozen(ECHOABLE_FIELD_NAMES));
});

test("redactRejectionField echoes only closed-vocabulary names", () => {
  for (const name of ECHOABLE_FIELD_NAMES) {
    assert.deepEqual(redactRejectionField(name), { field: name });
  }
  for (const key of [...SMUGGLED_KEY_NAMES(), ...UNCLASSIFIED_HOSTILE_KEYS()]) {
    assert.deepEqual(
      redactRejectionField(key),
      { field_redacted: true },
      `caller-controlled key must be redacted: ${key.slice(0, 40)}`,
    );
  }
  assert.deepEqual(redactRejectionField(undefined), { field_redacted: true });
});

test("smuggled identifier key names are flagged high-risk and never echoed", () => {
  for (const key of SMUGGLED_KEY_NAMES()) {
    const result = exportGlobalLearningRecords({
      purpose: PURPOSE,
      records: [tenantRecord({ [key]: true })],
    });
    assert.equal(result.counts.accepted, 0, `key was admitted: ${key}`);
    assert.equal(result.rejected.length, 1);
    assert.match(result.rejected[0].reason_code, /^forbidden_/);
    assert.equal(
      result.rejected[0].field_redacted,
      true,
      `foreign key must be reported as redacted: ${key}`,
    );
    assert.equal("field" in result.rejected[0], false);
    assert.ok(!JSON.stringify(result).includes(key), `key leaked into envelope`);
    assert.equal(result.privacy_risk.risk_level, "high");
  }
});

test("unclassified foreign keys fail closed without being echoed either", () => {
  for (const key of UNCLASSIFIED_HOSTILE_KEYS()) {
    const result = exportGlobalLearningRecords({
      purpose: PURPOSE,
      records: [tenantRecord({ [key]: true })],
    });
    assert.equal(result.counts.accepted, 0, `key was admitted: ${key.slice(0, 40)}`);
    assert.equal(result.rejected[0].reason_code, "unknown_input_field");
    assert.equal(result.rejected[0].field_redacted, true);
    assert.equal("field" in result.rejected[0], false);
    assert.ok(
      !JSON.stringify(result).includes(key),
      `caller-controlled key leaked into envelope`,
    );
    // Unclassified-but-rejected keeps the medium operational signal; the
    // record itself is still barred from the global dataset either way.
    assert.equal(result.privacy_risk.risk_level, "medium");
  }
});

test("closed-vocabulary rejection diagnostics are preserved", () => {
  const cases = [
    [{ task_class: "not_a_real_class" }, "invalid_enum_value", "task_class"],
    [{ cost_usd: -5 }, "negative_value", "cost_usd"],
    [{ tokens_total: 12.5 }, "non_integer_count", "tokens_total"],
  ];
  const missing = tenantRecord();
  delete missing.outcome;
  const missingResult = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: [missing],
  });
  assert.equal(missingResult.counts.accepted, 0);
  assert.deepEqual(missingResult.rejected[0], {
    index: 0,
    reason_code: "missing_required_field",
    field: "outcome",
  });

  for (const [overrides, expectedCode, expectedField] of cases) {
    const result = exportGlobalLearningRecords({
      purpose: PURPOSE,
      records: [tenantRecord(overrides)],
    });
    assert.equal(result.counts.accepted, 0, JSON.stringify(overrides));
    assert.equal(result.rejected[0].reason_code, expectedCode);
    assert.equal(result.rejected[0].field, expectedField);
    assert.equal("field_redacted" in result.rejected[0], false);
  }
});

test("content-defense findings attach only schema-owned field names", () => {
  const result = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: [
      ...Array.from({ length: 5 }, () => tenantRecord()),
      tenantRecord({ agent_name: `agent ${fakeCommitDigest()} bot` }),
    ],
  });
  assert.equal(result.counts.accepted, 5);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].field, "agent_name");
  assert.match(result.rejected[0].reason_code, /_detected$/);
  assert.ok(!JSON.stringify(result).includes(fakeCommitDigest()));
});

test("combined poison batch stays marker-free in every export mode", () => {
  const poison = [
    tenantRecord({ [`${ORG_MARKER}_flag`]: true }),
    tenantRecord({ [`url_${REPO_MARKER}`]: "https://git.invalid/x" }),
    tenantRecord({ customer_id: `${ORG_MARKER}-8742` }),
  ];
  const cohort = Array.from({ length: 6 }, () => tenantRecord());

  const modes = [
    { purpose: PURPOSE, records: [...cohort, ...poison] },
    { purpose: PURPOSE, records: [...cohort, ...poison], aggregateOnly: true },
    {
      purpose: PRODUCT_TELEMETRY,
      records: [...cohort, ...poison],
      cohortThreshold: 6,
    },
    {
      purpose: EXTERNAL_RESEARCH_DATA_LICENSING,
      licenseAcknowledged: true,
      records: [...cohort, ...poison],
    },
  ];

  for (const request of modes) {
    const result = exportGlobalLearningRecords(request);
    const serialized = JSON.stringify(result);
    for (const marker of [ORG_MARKER, REPO_MARKER, DEV_MARKER]) {
      assert.ok(!serialized.includes(marker), `marker leaked: ${marker}`);
    }
    // Every rejection explains itself without echoing caller content.
    for (const entry of result.rejected) {
      assert.match(entry.reason_code, /^[a-z][a-z0-9_]*$/);
      if ("field" in entry) {
        assert.ok(
          ECHOABLE_FIELD_NAMES.includes(entry.field),
          `non-closed-vocabulary field echo: ${entry.field}`,
        );
      }
    }
    if (request.aggregateOnly) {
      // Row-level accounting does not exist in aggregate mode: the six
      // clean records surface ONLY as one cohort count.
      assert.ok(!("accepted" in result));
      assert.deepEqual(result.cohorts.map((c) => c.size), [6]);
      assert.equal(result.counts.rejected, 3);
    } else {
      assert.equal(
        result.counts.provided,
        result.counts.accepted + result.counts.suppressed + result.counts.rejected,
      );
    }
  }
});

test("redaction preserves byte-stable reproducibility", () => {
  const makeRequest = () => ({
    purpose: PURPOSE,
    records: [
      ...Array.from({ length: 5 }, () => tenantRecord()),
      tenantRecord({ [`${ORG_MARKER}_leak_attempt`]: 1 }),
      tenantRecord({ cost_usd: -1 }),
    ],
  });
  const a = JSON.stringify(exportGlobalLearningRecords(makeRequest()));
  const b = JSON.stringify(exportGlobalLearningRecords(makeRequest()));
  assert.equal(a, b);
  const parsed = JSON.parse(a);
  assert.equal(parsed.rejected[0].field_redacted, true);
  assert.equal(parsed.rejected[1].field, "cost_usd");
});
