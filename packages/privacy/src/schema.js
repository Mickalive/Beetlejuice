/**
 * GlobalLearningRecord schema — closed world, versioned (glr/1).
 *
 * A valid record contains EXACTLY the fields below, each holding a value from
 * the controlled vocabulary for that field. There is no identifier field of
 * any kind and no free-text field; unknown or missing fields are rejected,
 * never silently dropped.
 */

import {
  AGENT_FAMILY,
  CI_RESULT,
  COST_BUCKET,
  DEPENDENCY_COMPLEXITY,
  DURATION_BUCKET,
  FILE_COUNT_BUCKET,
  GLR_SCHEMA_VERSION,
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

const enumField = (values) => Object.freeze({ kind: "enum", values });
const BOOLEAN_FIELD = Object.freeze({ kind: "boolean" });

/**
 * Canonical field order. Records are always built in this order so that
 * JSON serialization (and therefore cohort grouping) is deterministic.
 */
export const GLR_FIELD_ORDER = Object.freeze([
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
]);

/** Field specifications for the glr/1 schema. */
export const GLR_FIELD_SPECS = Object.freeze({
  record_type: enumField(RECORD_TYPE),
  task_class: enumField(TASK_CLASS),
  language_family: enumField(LANGUAGE_FAMILY),
  repo_size_bucket: enumField(REPO_SIZE_BUCKET),
  dependency_complexity: enumField(DEPENDENCY_COMPLEXITY),
  files_touched_bucket: enumField(FILE_COUNT_BUCKET),
  agent_family: enumField(AGENT_FAMILY),
  model_class: enumField(MODEL_CLASS),
  orchestration_pattern: enumField(ORCHESTRATION_PATTERN),
  cost_bucket: enumField(COST_BUCKET),
  duration_bucket: enumField(DURATION_BUCKET),
  token_bucket: enumField(TOKEN_BUCKET),
  tool_call_bucket: enumField(TOOL_CALL_BUCKET),
  retry_bucket: enumField(RETRY_BUCKET),
  ci_result: enumField(CI_RESULT),
  human_intervention: BOOLEAN_FIELD,
  outcome: enumField(OUTCOME),
});

const GLR_FIELD_SET = new Set(GLR_FIELD_ORDER);

/**
 * Patterns classifying forbidden INPUT keys. They are applied to keys that
 * are not part of the allowed tenant-input set, purely to produce precise
 * rejection reasons. Any non-allowed key is rejected regardless.
 *
 * A key matching one of these signals an attempt to smuggle linkable
 * identifiers or raw content toward the global dataset.
 */
export const FORBIDDEN_KEY_PATTERNS = [
  { code: "forbidden_customer_or_tenant_field", re: /customer|client|tenant|account|workspace|install(ation)?(_?id)?/i },
  { code: "forbidden_org_or_user_field", re: /organi[sz]ation|(^|_)org($|_)|user|developer|author|committ(er|ee)|reviewer|login|handle|identity|whoami/i },
  { code: "forbidden_repo_or_project_field", re: /repo(sitory)?(_?(name|id|url|slug))?|project|slug/i },
  { code: "forbidden_vcs_ref_field", re: /branch|commit|\bsha\b|sha\d|revision|^ref$|_ref$|tag(_name)?$|merge|head/i },
  { code: "forbidden_pr_or_issue_field", re: /pull(_request)?|(^|_)pr(_?(number|id))?$|issue(_?(number|id))?$|ticket/i },
  { code: "forbidden_network_identifier_field", re: /url|uri|link|domain|host(_name)?$|endpoint|^ip$|(^|_)ip(_|$)|addr(ess)?$|dns/i },
  { code: "forbidden_credential_field", re: /token|secret|api_?key|passw(or)?d|credential|signature|webhook|private_key|auth/i },
  { code: "forbidden_content_field", re: /prompt|completion|diff|patch|log|stack ?trace|message|text|title|body|description|comment|content|source|code/i },
  { code: "forbidden_filesystem_field", re: /path|file(name|path)?|^file$/i },
  { code: "forbidden_run_identifier_field", re: /run_?id|job_?id|workflow|check_?(suite|run)|build_?id|request_?id|correlation|session|device|finger ?print/i },
  { code: "forbidden_time_field", re: /timestamp|(^|_)at$|^date(time)?$|(^|_)date$|(^|_)time$|created|updated|started|ended/i },
  { code: "forbidden_pseudonym_field", re: /\bid\b|(^|_|)id($|_)|uuid|guid|hash|digest|pseudonym|fingerprint|nonce|salt/i },
];

/**
 * Classify why a key is not allowed as tenant input.
 * @param {string} key
 * @returns {{allowed: false, reasonCode: string}} always rejected
 */
export function classifyInputKey(key) {
  for (const { code, re } of FORBIDDEN_KEY_PATTERNS) {
    if (re.test(key)) return { allowed: false, reasonCode: code };
  }
  return { allowed: false, reasonCode: "unknown_input_field" };
}

/**
 * Validate an object against the glr/1 GlobalLearningRecord schema.
 *
 * @param {unknown} candidate
 * @returns {{ok: boolean, issues: {field?: string, code: string}[]}}
 *   issue codes: not_an_object, unexpected_field, missing_field,
 *   invalid_enum_value, invalid_boolean
 */
export function validateGlobalLearningRecord(candidate) {
  const issues = [];
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return { ok: false, issues: [{ code: "not_an_object" }] };
  }
  for (const field of GLR_FIELD_ORDER) {
    if (!Object.hasOwn(candidate, field)) {
      issues.push({ field, code: "missing_field" });
      continue;
    }
    const spec = GLR_FIELD_SPECS[field];
    const value = candidate[field];
    if (spec.kind === "boolean") {
      if (typeof value !== "boolean") {
        issues.push({ field, code: "invalid_boolean" });
      }
      continue;
    }
    if (typeof value !== "string" || !groupByValue(spec.values).has(value)) {
      issues.push({ field, code: "invalid_enum_value" });
    }
  }
  for (const key of Object.keys(candidate)) {
    if (!GLR_FIELD_SET.has(key)) {
      issues.push({ field: key, code: "unexpected_field" });
    }
  }
  return { ok: issues.length === 0, issues };
}

/** Small helper avoiding a Set rebuild per call while keeping O(1) lookups. */
const vocabCache = new WeakMap();
function groupByValue(values) {
  let set = vocabCache.get(values);
  if (!set) {
    set = new Set(values);
    vocabCache.set(values, set);
  }
  return set;
}

/**
 * @param {unknown} candidate
 * @returns {boolean} true when candidate is a structurally valid GLR.
 */
export function isValidGlobalLearningRecord(candidate) {
  return validateGlobalLearningRecord(candidate).ok;
}

export { GLR_SCHEMA_VERSION };
