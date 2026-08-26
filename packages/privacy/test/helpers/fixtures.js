/**
 * Deterministic synthetic tenant fixtures for privacy tests.
 * All values are fictional and harmless; nothing here resembles a credential.
 */

/**
 * A valid tenant-side observation with all optional raw magnitudes.
 * @param {Record<string, unknown>} [overrides]
 */
export function tenantRecord(overrides = {}) {
  return {
    task_class: "bug_fix",
    language_family: "python",
    repo_size_bucket: "m",
    dependency_complexity: "medium",
    orchestration_pattern: "single_agent",
    files_touched_count: 4,
    agent_name: "night-coding-agent",
    model_name: "mid-size-model",
    cost_usd: 3.2,
    duration_ms: 420000,
    tokens_total: 54000,
    tool_calls: 7,
    retry_count: 0,
    ci_result: "passed",
    human_intervention: false,
    outcome: "pr_merged",
    ...overrides,
  };
}

/** Expected GLR for tenantRecord() defaults — documents the full mapping. */
export function expectedDefaultGlobalRecord() {
  return {
    record_type: "agentic_task_summary",
    task_class: "bug_fix",
    language_family: "python",
    repo_size_bucket: "m",
    dependency_complexity: "medium",
    files_touched_bucket: "4_to_9",
    agent_family: "cli_coding_agent",
    model_class: "standard_model",
    orchestration_pattern: "single_agent",
    cost_bucket: "1_to_10",
    duration_bucket: "1m_to_10m",
    token_bucket: "10k_to_100k",
    tool_call_bucket: "6_to_20",
    retry_bucket: "zero",
    ci_result: "passed",
    human_intervention: false,
    outcome: "pr_merged",
  };
}

/**
 * A batch of distinct abstract combinations (each variant differs from the
 * base in at least one dimension) so cohort tests have several groups.
 * @param {Record<string, unknown>[]} [extraVariants]
 */
export function mixedBatch(extraVariants = []) {
  return [
    tenantRecord(),
    tenantRecord({
      task_class: "feature_addition",
      cost_usd: 42.5,
      outcome: "pr_created",
    }),
    tenantRecord({
      task_class: "refactoring",
      cost_usd: 7.75,
      outcome: "pr_closed",
      human_intervention: true,
    }),
    tenantRecord({
      task_class: "documentation",
      duration_ms: 900000,
      outcome: "task_aborted",
      ci_result: "none",
    }),
    tenantRecord({ task_class: "ci_maintenance", outcome: "ci_failed", ci_result: "failed" }),
    ...extraVariants.map((v) => tenantRecord(v)),
  ];
}
