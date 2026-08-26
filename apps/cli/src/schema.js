// Canonical normalized-input contract (v2) for the Beetlejuice product surface (WC-005).
//
// The UI/CLI layer consumes ONLY vendor-neutral, adapter-normalized `agentic_task`
// records. Raw provider payloads (GitHub Actions runs, PR objects, check runs…)
// are rejected here by construction: adapters must normalize before the product
// surface ever sees data. See apps/cli/docs/NORMALIZED_INPUT.md.
//
// v2 changes over the never-integrated v1 draft (see docs § Migrations):
// - money at rest is integer MICRO-USD everywhere (single unit with packages/core);
// - task-level outcome vocabulary is the canonical AGENTIC_TASK attribution
//   vocabulary shared with packages/core: accepted | failed | aborted | unresolved.
//
// All money is represented as integer micro-USD to keep cost accounting exact.

export const CANONICAL_SCHEMA_VERSION = "2";

/** Canonical task-outcome vocabulary (AGENTIC_TASK attribution, shared with core). */
export const OUTCOME_STATUSES = Object.freeze([
  "accepted", // successful/accepted outcome (e.g. merged PR evidence)
  "failed", // explicit terminal failure evidence
  "aborted", // objective disappeared / aborted
  "unresolved", // no terminal signal yet — cost stays visible, success not guessed
]);

/** Provider-flavored statuses from the never-integrated v1 draft → canonical. */
export const V1_OUTCOME_STATUS_ALIASES = Object.freeze({
  pr_merged: "accepted",
  pr_open: "unresolved",
  task_failed: "failed",
  task_aborted: "aborted",
});

/** Cost basis classes — measured vs estimated vs unknown must stay distinguishable. */
export const COST_BASES = Object.freeze(["measured", "estimated", "unavailable"]);

export const COMPONENT_KEYS = Object.freeze(["inference", "tools", "ci", "compute"]);

export const FAILURE_CATEGORIES = Object.freeze([
  "deterministic",
  "transient",
  "flaky",
  "unknown",
]);

/**
 * Field names that only exist in raw provider payloads. If any of these appears
 * anywhere in a bundle, the bundle was NOT normalized by an adapter and is
 * refused. Provenance refs belong under task.source_refs instead.
 */
const RAW_PROVIDER_MARKERS = Object.freeze([
  "workflow_run",
  "workflow_job",
  "pull_request",
  "check_suite",
  "check_run",
  "head_sha",
  "base_sha",
  "html_url",
  "issue_url",
  "repository",
  "sender",
  "installation",
]);

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isIsoDateString(value) {
  if (!isNonEmptyString(value)) return false;
  const t = Date.parse(value);
  return Number.isFinite(t);
}

function isNonNegativeInt(value) {
  return Number.isInteger(value) && value >= 0;
}

function pushError(errors, path, message) {
  errors.push({ path, message });
}

/** Depth-first walk collecting paths of objects carrying raw provider markers. */
function scanForRawProviderPayload(node, path, errors) {
  if (Array.isArray(node)) {
    node.forEach((item, i) => scanForRawProviderPayload(item, `${path}[${i}]`, errors));
    return;
  }
  if (!isPlainObject(node)) return;
  for (const key of Object.keys(node)) {
    if (RAW_PROVIDER_MARKERS.includes(key)) {
      pushError(
        errors,
        `${path}.${key}`,
        `raw provider payload field "${key}" detected; adapters must normalize to the canonical agentic_task schema before the product surface consumes it`
      );
    } else {
      scanForRawProviderPayload(node[key], `${path}.${key}`, errors);
    }
  }
}

function validateComponent(component, path, errors) {
  if (!isPlainObject(component)) {
    pushError(errors, path, "cost component must be an object");
    return;
  }
  const basis = component.basis;
  if (!COST_BASES.includes(basis)) {
    pushError(errors, `${path}.basis`, `basis must be one of ${COST_BASES.join(", ")}`);
    return;
  }
  if (basis === "unavailable") {
    if (component.amount_micro_usd !== null) {
      pushError(errors, `${path}.amount_micro_usd`, "unavailable components must have amount_micro_usd = null");
    }
  } else if (!isNonNegativeInt(component.amount_micro_usd)) {
    pushError(errors, `${path}.amount_micro_usd`, "amount_micro_usd must be a non-negative integer (micro-usd)");
  }
}

function validateExecution(execution, path, errors, executionIds) {
  if (!isPlainObject(execution)) {
    pushError(errors, path, "execution must be an object");
    return;
  }
  if (!isNonEmptyString(execution.execution_id)) {
    pushError(errors, `${path}.execution_id`, "execution_id is required");
  } else {
    if (executionIds.has(execution.execution_id)) {
      pushError(errors, `${path}.execution_id`, `duplicate execution_id "${execution.execution_id}" within task`);
    }
    executionIds.add(execution.execution_id);
  }
  if (!isPlainObject(execution.agent) || !isNonEmptyString(execution.agent.family)) {
    pushError(errors, `${path}.agent`, "agent { family } is required (vendor-neutral)");
  }
  if (isPlainObject(execution.agent) && !("model_class" in execution.agent)) {
    pushError(errors, `${path}.agent.model_class`, "model_class is required; use an abstract class when exact identity is unknown");
  }
  if (!isIsoDateString(execution.started_at)) {
    pushError(errors, `${path}.started_at`, "started_at must be an ISO-8601 timestamp string");
  }
  if ("ended_at" in execution && execution.ended_at !== null && !isIsoDateString(execution.ended_at)) {
    pushError(errors, `${path}.ended_at`, "ended_at must be an ISO-8601 timestamp string or null");
  }

  if (!isPlainObject(execution.components) || Object.keys(execution.components).length === 0) {
    pushError(errors, `${path}.components`, "components object with at least one entry is required");
    return;
  }
  let representableSum = 0;
  for (const key of Object.keys(execution.components).sort()) {
    if (!COMPONENT_KEYS.includes(key)) {
      pushError(errors, `${path}.components.${key}`, `unknown component "${key}"; allowed: ${COMPONENT_KEYS.join(", ")}`);
      continue;
    }
    validateComponent(execution.components[key], `${path}.components.${key}`, errors);
    const c = execution.components[key];
    if (
      isPlainObject(c) &&
      COST_BASES.includes(c.basis) &&
      c.basis !== "unavailable" &&
      isNonNegativeInt(c.amount_micro_usd)
    ) {
      representableSum += c.amount_micro_usd;
    }
  }
  if (!isNonNegativeInt(execution.total_amount_micro_usd)) {
    pushError(errors, `${path}.total_amount_micro_usd`, "total_amount_micro_usd must be a non-negative integer (micro-usd)");
  } else if (execution.total_amount_micro_usd !== representableSum) {
    pushError(
      errors,
      `${path}.total_amount_micro_usd`,
      `cost accounting invariant violated: total_amount_micro_usd (${execution.total_amount_micro_usd}) != sum of representable components (${representableSum})`
    );
  }

  if ("tokens" in execution && execution.tokens !== null && !isPlainObject(execution.tokens)) {
    pushError(errors, `${path}.tokens`, "tokens must be an object or null");
  }
  if (
    execution.tokens !== null &&
    isPlainObject(execution.tokens) &&
    (!isNonNegativeInt(execution.tokens.input) || !isNonNegativeInt(execution.tokens.output))
  ) {
    pushError(errors, `${path}.tokens`, "tokens.input/tokens.output must be non-negative integers");
  }
  if ("work_signature" in execution && execution.work_signature !== null && !isNonEmptyString(execution.work_signature)) {
    pushError(errors, `${path}.work_signature`, "work_signature must be a tenant-local opaque string or null");
  }
  if (
    "failure_category" in execution &&
    execution.failure_category !== null &&
    !FAILURE_CATEGORIES.includes(execution.failure_category)
  ) {
    pushError(
      errors,
      `${path}.failure_category`,
      `failure_category must be one of ${FAILURE_CATEGORIES.join(", ")} or null`
    );
  }
  for (const refField of ["retry_of_execution_id", "superseded_by_execution_id"]) {
    const v = execution[refField];
    if (v !== undefined && v !== null && !isNonEmptyString(v)) {
      pushError(errors, `${path}.${refField}`, `${refField} must be a non-empty string or null`);
    } else if (v === execution.execution_id) {
      pushError(errors, `${path}.${refField}`, `${refField} cannot reference itself`);
    }
  }
}

function validateRecord(record, index, errors) {
  const path = `records[${index}]`;
  if (!isPlainObject(record)) {
    pushError(errors, path, "record must be an object");
    return;
  }
  if (record.record_type !== "agentic_task") {
    pushError(errors, `${path}.record_type`, 'record_type must be "agentic_task"');
  }
  if (!isNonEmptyString(record.task_id)) {
    pushError(errors, `${path}.task_id`, "task_id is required (tenant-scope identifier)");
  }
  if (!isIsoDateString(record.started_at)) {
    pushError(errors, `${path}.started_at`, "started_at must be an ISO-8601 timestamp string");
  }
  if ("ended_at" in record && record.ended_at !== null && !isIsoDateString(record.ended_at)) {
    pushError(errors, `${path}.ended_at`, "ended_at must be an ISO-8601 timestamp string or null");
  }
  if (!isPlainObject(record.outcome) || !OUTCOME_STATUSES.includes(record.outcome.status)) {
    pushError(
      errors,
      `${path}.outcome.status`,
      `outcome.status must be one of ${OUTCOME_STATUSES.join(", ")} (canonical AGENTIC_TASK attribution vocabulary)`
    );
  }
  if ("aborted_at" in record && record.aborted_at !== null && !isIsoDateString(record.aborted_at)) {
    pushError(errors, `${path}.aborted_at`, "aborted_at must be an ISO-8601 timestamp string or null");
  }
  if (!Array.isArray(record.executions) || record.executions.length === 0) {
    pushError(errors, `${path}.executions`, "executions must be a non-empty array");
    return;
  }
  const executionIds = new Set();
  record.executions.forEach((execution, i) =>
    validateExecution(execution, `${path}.executions[${i}]`, errors, executionIds)
  );

  const idSet = new Set(
    record.executions.filter((e) => isPlainObject(e) && isNonEmptyString(e.execution_id)).map((e) => e.execution_id)
  );
  record.executions.forEach((execution, i) => {
    if (!isPlainObject(execution)) return;
    for (const refField of ["retry_of_execution_id", "superseded_by_execution_id"]) {
      const ref = execution[refField];
      if (isNonEmptyString(ref) && !idSet.has(ref)) {
        pushError(errors, `${path}.executions[${i}].${refField}`, `references unknown execution_id "${ref}" within the same task`);
      }
    }
  });
}

/**
 * Validate a normalized bundle (schema v2).
 * @returns {{ ok: boolean, errors: Array<{path: string, message: string}>, records: Array }}
 */
export function validateNormalizedBundle(bundle) {
  const errors = [];
  if (!isPlainObject(bundle)) {
    return { ok: false, errors: [{ path: "$", message: "bundle must be a JSON object" }], records: [] };
  }
  if (bundle.schema_version !== CANONICAL_SCHEMA_VERSION) {
    pushError(
      errors,
      "$.schema_version",
      bundle.schema_version === "1"
        ? 'schema_version "1" is the legacy draft contract; migrate it first (migrateNormalizedBundleV1ToV2) — see apps/cli/docs/NORMALIZED_INPUT.md § Migrations'
        : `schema_version must be "${CANONICAL_SCHEMA_VERSION}"`
    );
  }
  if (!isNonEmptyString(bundle.normalization_version)) {
    pushError(errors, "$.normalization_version", "normalization_version is required (versioned normalization provenance)");
  }
  if (!isNonEmptyString(bundle.collector_version)) {
    pushError(errors, "$.collector_version", "collector_version is required (versioned collector provenance)");
  }
  if (!Array.isArray(bundle.records)) {
    pushError(errors, "$.records", "records must be an array of agentic_task records");
  } else if (bundle.records.length === 0) {
    pushError(errors, "$.records", "records must contain at least one agentic_task record");
  } else {
    bundle.records.forEach((record, i) => validateRecord(record, i, errors));
  }

  scanForRawProviderPayload(bundle, "$", errors);

  // Deterministic error order for reproducible output/tests.
  errors.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.message < b.message ? -1 : 1));

  return {
    ok: errors.length === 0,
    errors,
    records: errors.length === 0 ? bundle.records : [],
  };
}
