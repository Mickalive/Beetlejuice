/**
 * @beetlejuice/github — read-only GitHub ingestion adapter (WC-002).
 *
 * Public surface:
 *  - collectHistory / assembleAudit : historical bootstrap audit
 *  - buildNormalizedBundle          : normalized v2 agentic_task bundle (seam A)
 *  - createGithubRestClient         : strictly-GET REST access (injectable)
 *  - createGithubAppAuth            : GitHub App -> installation token (P1)
 *  - verifyWebhookSignature         : P1 webhook verification
 *  - normalizeWebhookDelivery       : incremental delivery -> canonical events
 *  - cost sources                   : measured where supplied, honest unknowns
 */
export { ADAPTER_ID, COLLECTOR_VERSION, NORMALIZATION_VERSION, CANONICAL_SCHEMA_VERSION, EMITTED_EVENT_TYPES } from './versions.js';
export {
  GithubAdapterError,
  AdapterErrorCodes,
  invalidConfig,
  readOnlyViolation,
  upstreamError,
  badSignatureInput,
  signatureMismatch,
  isGithubAdapterError,
  redactSecret,
} from './errors.js';

export {
  repoScope,
  taskRefForPr,
  prRefFor,
  executionRefForRevision,
  ciRefFor,
  validationRefForCheckRun,
  eventId,
  apiRef,
} from './refs.js';

export {
  normalizePolicy,
  classifyPullRequest,
  classifyBranch,
  CONFIDENCE_MEASURED,
  CONFIDENCE_INFERRED,
  LINK_EXPLICIT,
  LINK_INFERRED,
  SUGGESTED_AGENTIC_ACTORS,
} from './policy.js';

export {
  MICROS_PER_USD,
  UNKNOWN_COST_REASONS,
  unknownCost,
  microUsdFromBillableMs,
  actionsUsageCostSource,
  unknownEverythingCostSource,
  composeCostSources,
} from './cost-source.js';

export { conformCanonicalEvent, githubSource } from './canonical.js';

export {
  createGithubRestClient,
  buildRequestUrl,
  parseLinkHeader,
  DEFAULT_PAGE_SIZE,
} from './collect/client.js';
export { collectHistory, DEFAULT_LIMITS } from './collect/history.js';

export {
  MAX_JWT_TTL_SECONDS,
  createAppJwt,
  createGithubAppAuth,
  privateKeyFromEnvString,
} from './app-auth.js';

export { assembleAudit } from './map/audit.js';
export { buildNormalizedBundle, BUNDLE_SCHEMA_VERSION } from './bundle.js';
export { buildPrIndex, entryForPullRequest } from './map/pr-index.js';
export { correlateWorkflowRun, mapWorkflowRun, mapCheckRuns, workflowPathToken } from './map/ci-evidence.js';
export { mapPullRequestTask } from './map/pr-tasks.js';

export { signWebhookPayload, verifyWebhookSignature, SIGNATURE_PREFIX } from './webhook/verify.js';
export { normalizeWebhookDelivery } from './webhook/normalize.js';
