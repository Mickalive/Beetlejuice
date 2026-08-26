/**
 * Tenant-input normalization: tenant-shaped observation -> GlobalLearningRecord.
 *
 * The transform is a strict allowlist mapper:
 *
 * - only the documented input fields are accepted; ANY other key rejects the
 *   record (fail-closed). Forbidden-looking keys get a precise reason code;
 * - raw magnitudes (cost, duration, tokens, counts) are bucketed here and the
 *   raw numbers never travel further;
 * - free-text identity inputs (`agent_name`, `model_name`) are content-scanned
 *   and then classified into coarse family/class enums; raw names are dropped;
 * - exact timestamps have no input field at all — they cannot be smuggled in;
 * - output records are built in canonical field order for reproducibility;
 * - every produced field carries a GENERALIZATION PROVENANCE (`explicit`,
 *   `bucketed`, `classified`, `defaulted`) so the export envelope can explain
 *   which abstract dimensions were generalized rather than passed through
 *   (WC-003: privacy-risk result explaining generalized fields).
 */

import { classifyAgentFamily, classifyModelClass } from "./classify.js";
import { scanString } from "./content.js";
import {
  bucketCostUSD,
  bucketDurationMs,
  bucketFileCount,
  bucketRetryCount,
  bucketTokens,
  bucketToolCalls,
} from "./bucketing.js";
import { classifyInputKey, GLR_FIELD_ORDER } from "./schema.js";
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
  RECORD_TYPE,
  REPO_SIZE_BUCKET,
  RETRY_BUCKET,
  TASK_CLASS,
  TOKEN_BUCKET,
  TOOL_CALL_BUCKET,
} from "./vocab.js";

const ENUM = (vocab, to, def) => ({ kind: "enum", vocab, to, default: def });
const INT = (bucketFn, to) => ({ kind: "int", min: 0, bucketFn, to });
const NUM = (bucketFn, to) => ({ kind: "number", min: 0, bucketFn, to });
const BOOL = (to) => ({ kind: "boolean", to, default: false });
const TEXT = (classifyFn, to) => ({ kind: "text", classifyFn, to });

/**
 * Allowed tenant-input fields. Keys map onto GLR fields via `to`.
 * Pre-bucketed enum forms and raw numeric forms coexist; when both are
 * provided the pre-bucketed form wins and the raw number is not processed.
 */
const INPUT_SPECS = Object.freeze({
  record_type: ENUM(RECORD_TYPE, "record_type", "agentic_task_summary"),
  task_class: ENUM(TASK_CLASS, "task_class", undefined),
  language_family: ENUM(LANGUAGE_FAMILY, "language_family", undefined),
  repo_size_bucket: ENUM(REPO_SIZE_BUCKET, "repo_size_bucket", "unknown"),
  dependency_complexity: ENUM(
    DEPENDENCY_COMPLEXITY,
    "dependency_complexity",
    "unknown",
  ),
  orchestration_pattern: ENUM(
    ORCHESTRATION_PATTERN,
    "orchestration_pattern",
    "unknown",
  ),
  ci_result: ENUM(CI_RESULT, "ci_result", "none"),
  outcome: ENUM(OUTCOME, "outcome", undefined),

  files_touched_bucket: ENUM(FILE_COUNT_BUCKET, "files_touched_bucket", "unknown"),
  files_touched_count: INT(bucketFileCount, "files_touched_bucket"),

  cost_bucket: ENUM(COST_BUCKET, "cost_bucket", "unknown"),
  cost_usd: NUM(bucketCostUSD, "cost_bucket"),

  duration_bucket: ENUM(DURATION_BUCKET, "duration_bucket", "unknown"),
  duration_ms: NUM(bucketDurationMs, "duration_bucket"),

  token_bucket: ENUM(TOKEN_BUCKET, "token_bucket", "unknown"),
  tokens_total: INT(bucketTokens, "token_bucket"),

  tool_call_bucket: ENUM(TOOL_CALL_BUCKET, "tool_call_bucket", "unknown"),
  tool_calls: INT(bucketToolCalls, "tool_call_bucket"),

  retry_bucket: ENUM(RETRY_BUCKET, "retry_bucket", "unknown"),
  retry_count: INT(bucketRetryCount, "retry_bucket"),

  human_intervention: BOOL("human_intervention"),

  // Defaults keep unmapped identity inputs from leaking: an absent or
  // unclassifiable agent/model lands on the coarse fallback labels.
  agent_family: ENUM(AGENT_FAMILY, "agent_family", "custom"),
  agent_name: TEXT(classifyAgentFamily, "agent_family"),

  model_class: ENUM(MODEL_CLASS, "model_class", "other"),
  model_name: TEXT(classifyModelClass, "model_class"),
});

/** How a GLR field value came to be (see module docstring). */
export const GENERALIZATION_KINDS = Object.freeze([
  "explicit",
  "bucketed",
  "classified",
  "defaulted",
]);

const REQUIRED_INPUTS = ["task_class", "language_family", "outcome"];

function reject(index, reasonCode, field) {
  return { status: "rejected", entry: { index, reason_code: reasonCode, ...(field ? { field } : {}) } };
}

function resolveEnum(spec, value, index, field) {
  if (typeof value !== "string" || !spec.vocab.includes(value)) {
    // Never echo the offending value back into any report channel.
    return reject(index, "invalid_enum_value", field);
  }
  return value;
}

function resolveNumber(spec, value, index, field) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return reject(index, "invalid_number", field);
  }
  if (spec.kind === "int" && !Number.isInteger(value)) {
    return reject(index, "non_integer_count", field);
  }
  if (value < spec.min) return reject(index, "negative_value", field);
  return spec.bucketFn(value);
}

function resolveText(spec, value, index, field) {
  if (typeof value !== "string") return reject(index, "invalid_text_input", field);
  const { findings } = scanString(value);
  if (findings.length > 0) {
    // Free-text identity fields carrying URLs/secrets/paths are rejected
    // outright rather than silently classified away.
    return reject(index, findings[0], field);
  }
  return spec.classifyFn(value);
}

/**
 * Normalize one tenant-side observation into a GlobalLearningRecord candidate.
 *
 * @param {unknown} input tenant observation (plain object)
 * @param {{index?: number}} [ctx]
 * @returns {{status: "ok", record: Record<string, string|boolean>,
 *            provenance: Record<string, string>} |
 *           {status: "rejected", entry: {index: number, reason_code: string, field?: string}}}
 */
export function normalizeTenantRecord(input, ctx = {}) {
  const index = Number.isInteger(ctx.index) ? ctx.index : -1;

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return reject(index, "not_an_object");
  }

  // 1. Key allowlist. Unknown/forbidden keys reject the whole record so that
  //    near-miss names cannot smuggle identifiers through. The membership
  //    test must be OWN-property based: a plain `INPUT_SPECS[key]` lookup
  //    would resolve prototype-chain keys such as "__proto__" or
  //    "constructor" to inherited Object.prototype members and silently
  //    ignore them instead of rejecting (fail-closed).
  const present = new Set();
  for (const key of Object.keys(input)) {
    const spec = Object.hasOwn(INPUT_SPECS, key) ? INPUT_SPECS[key] : undefined;
    if (!spec) {
      const { reasonCode } = classifyInputKey(key);
      return reject(index, reasonCode, key);
    }
    present.add(key);
  }

  // 2. Required fields.
  for (const req of REQUIRED_INPUTS) {
    if (!present.has(req)) return reject(index, "missing_required_field", req);
  }

  // 3. Resolve every allowed field.
  /** @type {Record<string, string|boolean|undefined>} */
  const resolved = {};
  /** @type {Record<string, string>} */
  const provenance = {};
  for (const [key, spec] of Object.entries(INPUT_SPECS)) {
    if (!present.has(key)) continue;
    // First source for a GLR field wins: the pre-bucketed/enum form takes
    // precedence over raw magnitudes or raw names.
    if (Object.hasOwn(resolved, spec.to)) continue;
    let value = input[key];
    if (spec.kind === "enum") {
      value = resolveEnum(spec, value, index, key);
      provenance[spec.to] = "explicit";
    } else if (spec.kind === "boolean") {
      if (typeof value !== "boolean") return reject(index, "invalid_boolean", key);
      provenance[spec.to] = "explicit";
    } else if (spec.kind === "text") {
      value = resolveText(spec, value, index, key);
      provenance[spec.to] = "classified";
    } else {
      value = resolveNumber(spec, value, index, key);
      provenance[spec.to] = "bucketed";
    }
    if (value && typeof value === "object" && value.status === "rejected") {
      return value;
    }
    resolved[spec.to] = value;
  }

  // 4. Defaults. Every GLR field now has a value: either explicit, derived
  //    from a raw magnitude, or a coarse default — each traceable.
  for (const spec of Object.values(INPUT_SPECS)) {
    if (resolved[spec.to] === undefined && spec.default !== undefined) {
      resolved[spec.to] = spec.default;
      provenance[spec.to] = "defaulted";
    }
  }

  // 5. Build the record in canonical order (deterministic serialization).
  const record = {};
  for (const field of GLR_FIELD_ORDER) {
    if (!Object.hasOwn(resolved, field)) {
      return reject(index, "internal_resolution_gap", field);
    }
    record[field] = resolved[field];
  }

  return { status: "ok", record, provenance };
}
