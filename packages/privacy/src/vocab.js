/**
 * Controlled vocabularies for the GlobalLearningRecord (GLR).
 *
 * Every value that may appear in a global record is either drawn from one of
 * these frozen lists or produced by the coarse bucketing helpers in
 * `bucketing.js` (whose output labels are themselves listed here).
 * Free text never enters a GlobalLearningRecord.
 */

/** Version of the GlobalLearningRecord schema implemented by this package. */
export const GLR_SCHEMA_VERSION = "glr/1";

/** The only record kind exported to the global learning dataset in v1. */
export const RECORD_TYPE = Object.freeze(["agentic_task_summary"]);

/** Abstract task classes (semantic classification happens tenant-side). */
export const TASK_CLASS = Object.freeze([
  "bug_fix",
  "feature_addition",
  "refactoring",
  "dependency_upgrade",
  "test_authoring",
  "documentation",
  "ci_maintenance",
  "code_review",
  "incident_response",
  "other",
]);

/**
 * Coarse language families. Individual languages map into a family; anything
 * unrecognized maps to "other" (never the raw language or ecosystem name).
 */
export const LANGUAGE_FAMILY = Object.freeze([
  "python",
  "javascript_typescript",
  "jvm",
  "go",
  "rust",
  "c_cpp",
  "csharp_dotnet",
  "ruby",
  "php",
  "swift_kotlin",
  "shell",
  "sql",
  "other",
]);

/** Repository size buckets (tenant provides the bucket, never raw bytes). */
export const REPO_SIZE_BUCKET = Object.freeze([
  "xs",
  "s",
  "m",
  "l",
  "xl",
  "unknown",
]);

/** Dependency-complexity buckets (tenant-provided, pre-generalized). */
export const DEPENDENCY_COMPLEXITY = Object.freeze([
  "low",
  "medium",
  "high",
  "unknown",
]);

/** Files-touched buckets derived from a raw count by bucketFileCount(). */
export const FILE_COUNT_BUCKET = Object.freeze([
  "zero",
  "one",
  "2_to_3",
  "4_to_9",
  "10_to_99",
  "over_100",
  "unknown",
]);

/**
 * Agent families. Custom internal agent names are classified into a family;
 * anything unmapped becomes "custom" — the raw name is never echoed.
 */
export const AGENT_FAMILY = Object.freeze([
  "cli_coding_agent",
  "ide_assistant",
  "cloud_autonomous_agent",
  "ci_bot",
  "orchestrator_framework",
  "scripted_pipeline",
  "custom",
]);

/**
 * Model classes. Vendor model names are classified into a class; anything
 * unmapped becomes "other" — the raw model name is never echoed.
 */
export const MODEL_CLASS = Object.freeze([
  "frontier_reasoning",
  "standard_model",
  "small_fast_model",
  "local_open_weights",
  "non_llm_deterministic",
  "other",
]);

/** Orchestration patterns (abstract workflow shapes). */
export const ORCHESTRATION_PATTERN = Object.freeze([
  "single_agent",
  "multi_agent_pipeline",
  "human_in_the_loop",
  "scheduled_job",
  "unknown",
]);

/** Cost buckets derived from cost_usd by bucketCostUSD(). */
export const COST_BUCKET = Object.freeze([
  "zero",
  "under_1",
  "1_to_10",
  "10_to_100",
  "100_to_1000",
  "1000_to_10000",
  "over_10000",
  "unknown",
]);

/** Wall-clock duration buckets derived from duration_ms by bucketDurationMs(). */
export const DURATION_BUCKET = Object.freeze([
  "zero",
  "under_1s",
  "1s_to_60s",
  "1m_to_10m",
  "10m_to_60m",
  "1h_to_6h",
  "over_6h",
  "unknown",
]);

/** Token-volume buckets derived from tokens_total by bucketTokens(). */
export const TOKEN_BUCKET = Object.freeze([
  "zero",
  "under_1k",
  "1k_to_10k",
  "10k_to_100k",
  "100k_to_1m",
  "over_1m",
  "unknown",
]);

/** Tool-call-count buckets derived from tool_calls by bucketToolCalls(). */
export const TOOL_CALL_BUCKET = Object.freeze([
  "zero",
  "one",
  "2_to_5",
  "6_to_20",
  "over_20",
  "unknown",
]);

/** Retry-count buckets derived from retry_count by bucketRetryCount(). */
export const RETRY_BUCKET = Object.freeze([
  "zero",
  "one",
  "2_to_3",
  "over_3",
  "unknown",
]);

/** CI result as observed at task level (abstract; no run/job identifiers). */
export const CI_RESULT = Object.freeze([
  "passed",
  "failed",
  "mixed",
  "skipped",
  "none",
]);

/**
 * Canonical outcome vocabulary from AGENTS.md ("Outcome-first economics").
 * Stored lowercase; the exporter accepts exactly these tokens.
 */
export const OUTCOME = Object.freeze([
  "task_started",
  "task_aborted",
  "task_failed",
  "pr_created",
  "pr_closed",
  "pr_merged",
  "ci_passed",
  "ci_failed",
  "human_rework",
  "retry",
  "revert",
]);
