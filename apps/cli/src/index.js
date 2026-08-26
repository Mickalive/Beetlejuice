// Public API of the Beetlejuice product surface (@beetlejuice/product-cli).
//
// Reusable by the CLI today and by a future dashboard/server without
// re-implementing economics, waste detection or rendering. Everything here
// operates on canonical normalized records or canonical-core exports only —
// never on raw provider payloads.

export {
  validateNormalizedBundle,
  CANONICAL_SCHEMA_VERSION,
  OUTCOME_STATUSES,
  V1_OUTCOME_STATUS_ALIASES,
  COST_BASES,
  COMPONENT_KEYS,
  FAILURE_CATEGORIES,
} from "./schema.js";

export { migrateNormalizedBundleV1ToV2 } from "./migrate.js";
export { buildNormalizedBundle, BUNDLE_BUILDER_VERSION } from "./bundle.js";
export {
  validateCoreAuditExport,
  deriveUnquantifiedEvidenceUnits,
  CORE_AUDIT_EXPORT_TYPE,
  CORE_AUDIT_EXPORT_VERSION,
} from "./core_audit.js";

export { summarizeEconomics, buildTaskLedger } from "./economics.js";
export {
  detectCertainWaste,
  RULE_VERSIONS,
  WASTE_RULE_ORDER,
  CANONICAL_RULE_CLASSES,
} from "./waste.js";
export {
  buildAuditReport,
  buildReportFromCoreAudit,
  REPORT_VERSION,
} from "./audit.js";
export { renderMarkdownReport, renderJsonReport } from "./report/markdown.js";
export { loadSyntheticFixture, loadLegacyV1Fixture } from "./synthetic.js";
export { runCli, printHelp } from "./demo.js";
export {
  runGithubReadOnly,
  parseOwnerRepo,
  GITHUB_TOKEN_ENV,
  REAL_GITHUB_MODE,
} from "./github_mode.js";
