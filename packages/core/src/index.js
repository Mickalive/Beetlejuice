/**
 * @beetlejuice/core — public API surface.
 *
 * Vendor-neutral AGENTIC_TASK economics for Beetlejuice:
 *   canonical events -> tenant ledger -> task reconstruction ->
 *   cost accounting + outcome attribution -> certain-waste findings ->
 *   versioned canonical-core audit export.
 *
 * GitHub is adapter #1 and lives in its own package; nothing here knows about
 * it. No stable global customer/repo/developer identifier exists anywhere in
 * this module by design (see docs/MASTER_PROMPT.md §3).
 */
export { VERSIONS, eventVersionFor } from './versions.js';
export {
  EVENT_TYPES,
  CANONICAL_EVENT_TYPES,
  DETERMINISTIC_FAILURE_CLASSES,
  EXECUTION_STATUSES,
  CI_RUN_STATUSES,
  VALIDATION_STATUSES,
  INVOCATION_STATUSES,
  normalizeEvent,
  deepFreeze,
  isKnownCost,
  costMicroUsd,
} from './events.js';
export { BeetlejuiceCoreError, ErrorCodes, isBeetlejuiceCoreError } from './errors.js';
export { MICROS_PER_USD, usd, formatUsd } from './money.js';
export { reconstructTasks } from './task.js';
export {
  COST_KINDS,
  COST_EVIDENCE_STATES,
  costEvidenceState,
  emptyRollup,
  rollupTaskCost,
  verifyCostAccounting,
} from './economics/cost.js';
export { computeSummary } from './economics/metrics.js';
export {
  CORE_AUDIT_EXPORT_TYPE,
  CORE_AUDIT_EXPORT_VERSION,
  buildCoreAuditExport,
} from './export.js';
export { runWasteAnalysis, CONFIDENCE_CERTAIN } from './waste/engine.js';
export { DEFAULT_WASTE_RULES } from './waste/rules/index.js';
export { RULE_DUP_CI } from './waste/rules/duplicate-ci.js';
export { RULE_DET_RETRY } from './waste/rules/deterministic-retry.js';
export { RULE_EXEC_SUPERSEDED } from './waste/rules/superseded-execution.js';
export { RULE_EXEC_AFTER_ABORT } from './waste/rules/execution-after-abort.js';
export { TenantLedger } from './analytics/tenant.js';
