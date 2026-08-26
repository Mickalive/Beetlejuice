/**
 * Adapter identity + version stamps (MASTER_PROMPT §16).
 *
 * Every canonical event produced by this adapter carries its provenance in
 * `source.meta` (the canonical envelope's version fields are stamped by the
 * core ledger at ingestion; see packages/core/src/events.js). Keeping the
 * collector/normalizer identity here makes historical re-ingestion
 * reproducible and auditable.
 */

/** Vendor-neutral schema this adapter emits into (canonical AGENTIC_TASK). */
export const CANONICAL_SCHEMA_VERSION = '1';

/** Adapter identifier used as `source.adapter` on every emitted event. */
export const ADAPTER_ID = 'github';

export const COLLECTOR_VERSION = 'beetlejuice-github-rest-collector@0.2.0';
export const NORMALIZATION_VERSION = 'beetlejuice-github-normalization@0.2.0';

/**
 * Canonical event vocabulary used by this adapter. Pinned to the canonical
 * core event schema (`packages/core/src/events.js`, eventSchemaVersion 1).
 * This list intentionally contains ONLY the types GitHub read-only evidence
 * can support; anything not observable via GitHub (model/tool invocations)
 * is simply never fabricated.
 */
export const EMITTED_EVENT_TYPES = Object.freeze([
  'task_started',
  'execution_started',
  'execution_finished',
  'ci_run_recorded',
  'validation_recorded',
  'pull_request_created',
  'pull_request_closed',
  'pull_request_merged',
]);
