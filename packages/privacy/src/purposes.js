/**
 * Consent-purpose separation (MASTER_PROMPT.md §13).
 *
 * Product telemetry, global benchmark contribution and external
 * research/data licensing are separate rights surfaces. A batch can only be
 * exported under ONE declared purpose, and each purpose carries its own
 * minimum cohort threshold. Purpose is never inferred: it must be passed
 * explicitly on every export request.
 */

export const PRODUCT_TELEMETRY = "PRODUCT_TELEMETRY";
export const GLOBAL_BENCHMARK_CONTRIBUTION = "GLOBAL_BENCHMARK_CONTRIBUTION";
export const EXTERNAL_RESEARCH_DATA_LICENSING =
  "EXTERNAL_RESEARCH_DATA_LICENSING";

/** All valid consent purposes, as a frozen list. */
export const CONSENT_PURPOSES = Object.freeze([
  PRODUCT_TELEMETRY,
  GLOBAL_BENCHMARK_CONTRIBUTION,
  EXTERNAL_RESEARCH_DATA_LICENSING,
]);

/**
 * Per-purpose export policy.
 *
 * - `minimumCohort`: floor for the rare-combination suppression threshold.
 *   Callers may raise the threshold but never lower it below this floor.
 * - `maximumEpsilon`: CEILING for differential-privacy noise requests on
 *   published aggregate statistics. Lower epsilon = more noise = stronger
 *   protection, so callers may lower epsilon freely but never exceed this
 *   ceiling — the exact inverse of the cohort floor.
 * - `requiresLicenseAcknowledgement`: the external research / data-licensing
 *   surface may only be used when the caller explicitly acknowledges that a
 *   licensing right exists for this data (installation alone never grants it).
 */
export const PURPOSE_POLICIES = Object.freeze({
  [PRODUCT_TELEMETRY]: Object.freeze({
    minimumCohort: 5,
    maximumEpsilon: 5,
    requiresLicenseAcknowledgement: false,
  }),
  [GLOBAL_BENCHMARK_CONTRIBUTION]: Object.freeze({
    minimumCohort: 5,
    maximumEpsilon: 2,
    requiresLicenseAcknowledgement: false,
  }),
  [EXTERNAL_RESEARCH_DATA_LICENSING]: Object.freeze({
    minimumCohort: 25,
    maximumEpsilon: 1,
    requiresLicenseAcknowledgement: true,
  }),
});

/**
 * Absolute lowest cohort size any purpose may use. k=1 would admit unique
 * records, which is never acceptable for a global dataset.
 */
export const ABSOLUTE_MINIMUM_COHORT = 2;

/**
 * Absolute highest epsilon any purpose allows. Epsilon above this would make
 * per-record influence effectively unbounded; there is no request shape that
 * can negotiate past it.
 */
export const ABSOLUTE_MAXIMUM_EPSILON = 5;
