// Producer-side helper for the normalized-input seam (audit finding A7).
//
// The v2 bundle envelope was documented before any producer existed, so the
// "--input real mode" acceptance path could never ingest genuinely produced
// data. This module closes the gap from the product side: ANY adapter (GitHub
// is #1) or tenant pipeline can wrap already-normalized `agentic_task`
// records into the exact versioned envelope the surface consumes, using the
// SAME validator consumers run — the contract is enforced by construction,
// not by prose.
//
// Boundary: this helper NEVER accepts raw provider payloads. Records must be
// canonical vendor-neutral agentic_task records; the validator rejects raw
// provider markers anywhere in the output.

import { validateNormalizedBundle } from "./schema.js";

/** Version of this producer helper (report provenance can cite it). */
export const BUNDLE_BUILDER_VERSION = "1.0.0";

/**
 * Build a schema-v2 normalized bundle from canonical agentic_task records.
 *
 * Round-trip guarantee: the returned envelope passes validateNormalizedBundle()
 * or this function throws — a consumer can never receive an envelope this
 * producer would itself reject.
 *
 * @param {Array} records canonical agentic_task records (see docs/NORMALIZED_INPUT.md)
 * @param {object} options
 * @param {string} options.collector_version required provenance of the collecting adapter
 * @param {string} [options.normalization_version="1"] required provenance of the normalization pass
 * @returns {object} frozen plain-JSON bundle envelope (schema_version "2")
 */
export function buildNormalizedBundle(records, { collector_version, normalization_version = "1" }) {
  if (!Array.isArray(records)) {
    throw new TypeError("buildNormalizedBundle() expects an array of agentic_task records");
  }
  if (typeof collector_version !== "string" || collector_version.length === 0) {
    throw new TypeError(
      "buildNormalizedBundle() requires a non-empty collector_version (versioned collector provenance)"
    );
  }
  if (typeof normalization_version !== "string" || normalization_version.length === 0) {
    throw new TypeError("normalization_version must be a non-empty string");
  }
  if (records.length === 0) {
    throw new TypeError("buildNormalizedBundle() requires at least one agentic_task record");
  }

  const bundle = {
    schema_version: "2",
    normalization_version,
    collector_version,
    records: [...records],
  };

  const validation = validateNormalizedBundle(bundle);
  if (!validation.ok) {
    const error = new Error(
      `buildNormalizedBundle() refused to produce an invalid envelope (${validation.errors.length} error(s)); first: ${validation.errors[0].path}: ${validation.errors[0].message}`
    );
    error.code = "INVALID_NORMALIZED_RECORDS";
    error.validation_errors = validation.errors;
    throw error;
  }
  return bundle;
}
