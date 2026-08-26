/**
 * @beetlejuice/privacy — executable privacy boundary for the Beetlejuice
 * global learning dataset.
 *
 * Public API:
 * - `exportGlobalLearningRecords` — the privacy gate + exporter pipeline.
 * - `PrivacyExportError` — request-shape errors.
 * - `mapAuditTaskToPrivacyInput` — canonical tenant audit aggregate ->
 *   privacy-gate input (producer side of the audit->global seam).
 * - `normalizeTenantRecord` — tenant observation -> GLR candidate (bucketing,
 *   classification, allowlist rejection, generalization provenance).
 * - `validateGlobalLearningRecord` / `isValidGlobalLearningRecord` — glr/1
 *   schema validation.
 * - `suppressRareCombinations` / `aggregateCohorts` — rare-combination defense.
 * - `summarizePrivacyRisk` — deterministic explanation of suppressed and
 *   generalized fields for each export (WC-003 privacy-risk result).
 * - bucketing + classification helpers, vocabularies, purposes, versions.
 *
 * Design invariants (AGENTS.md / docs/MASTER_PROMPT.md):
 * - Unlinkable by default: no stable or deterministic identifier of any
 *   customer/org/repo/developer/branch/commit/PR/issue may enter a record.
 *   Hashes and pseudonyms are LINKABLE, not anonymous — they are rejected.
 * - No raw magnitudes, no raw content, no exact timestamps.
 * - Fail-closed: unknown fields and suspicious values reject the record;
 *   nothing is silently dropped.
 * - Deterministic and versioned: identical input yields byte-identical output.
 */

export {
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

export {
  HIGH_ENTROPY_BITS,
  HIGH_ENTROPY_MIN_LENGTH,
  MAX_LITERAL_LENGTH,
  scanGlobalLearningRecord,
  scanString,
  shannonEntropy,
} from "./content.js";

export {
  bucketCostUSD,
  bucketDurationMs,
  bucketFileCount,
  bucketRetryCount,
  bucketTokens,
  bucketToolCalls,
} from "./bucketing.js";

export { classifyAgentFamily, classifyModelClass } from "./classify.js";

export {
  FORBIDDEN_KEY_PATTERNS,
  GLR_FIELD_ORDER,
  GLR_FIELD_SPECS,
  classifyInputKey,
  isValidGlobalLearningRecord,
  validateGlobalLearningRecord,
} from "./schema.js";

export {
  GENERALIZATION_KINDS,
  normalizeTenantRecord,
} from "./transform.js";

export {
  AUDIT_MAPPING_VERSION,
  AUDIT_OUTCOME_KINDS,
  deriveCiResult,
  mapAuditTaskToPrivacyInput,
  mapOutcome,
} from "./audit-mapping.js";

export {
  aggregateCohorts,
  combinationKey,
  suppressRareCombinations,
} from "./suppression.js";

export {
  ABSOLUTE_MINIMUM_COHORT,
  CONSENT_PURPOSES,
  EXTERNAL_RESEARCH_DATA_LICENSING,
  GLOBAL_BENCHMARK_CONTRIBUTION,
  PRODUCT_TELEMETRY,
  PURPOSE_POLICIES,
} from "./purposes.js";

export {
  PRIVACY_RISK_LEVELS,
  summarizePrivacyRisk,
} from "./risk.js";

export {
  PRIVACY_NORMALIZATION_VERSION,
  PRIVACY_TRANSFORM_VERSIONS,
  pipelineTrace,
} from "./versions.js";

export {
  PrivacyExportError,
  effectiveCohortThreshold,
  exportGlobalLearningRecords,
} from "./exporter.js";
