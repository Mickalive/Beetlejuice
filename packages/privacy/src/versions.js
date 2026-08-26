/**
 * Versioning of the privacy transformations.
 *
 * Engineering invariant (AGENTS.md): every event/transformation is versioned.
 * The exporter stamps its output with the exact pipeline trace so any
 * exported batch can be reproduced bit-for-bit from the same input and the
 * same transformation versions.
 */

/** Version of the tenant-input normalization rules. */
export const PRIVACY_NORMALIZATION_VERSION = "1.2.0";

/**
 * Ordered privacy pipeline steps with their individual versions.
 * Changing any step's logic requires bumping its version here.
 */
export const PRIVACY_TRANSFORM_VERSIONS = Object.freeze({
  // 1.2.0: caller-controlled foreign key names are redacted from rejection
  // diagnostics (envelope-wide no-echo invariant).
  "input-normalization": "1.2.0",
  "schema-validation": "1.0.0",
  "content-defense": "1.0.0",
  // 1.1.0: per-combination admission caps — rows beyond the effective
  // rows_per_combination_limit are suppressed (over_combination_cap),
  // bounding single-source inflation of any abstract combination.
  "cohort-suppression": "1.1.0",
  "purpose-binding": "1.0.0",
  "differential-privacy": "1.0.0", // seeded Laplace noise on published aggregates
  "risk-summary": "1.0.0", // WC-003 privacy-risk result explaining the gate
});

/**
 * The canonical, ordered pipeline trace embedded in every export envelope.
 * @returns {{id: string, version: string}[]}
 */
export function pipelineTrace() {
  return Object.entries(PRIVACY_TRANSFORM_VERSIONS).map(([id, version]) => ({
    id,
    version,
  }));
}
