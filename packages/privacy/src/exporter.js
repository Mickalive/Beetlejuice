/**
 * Privacy gate + global exporter.
 *
 * Pipeline (each step versioned, see versions.js):
 *
 *   1. input-normalization  tenant observation -> abstract GLR candidate
 *                           (allowlist keys, bucket magnitudes, classify names,
 *                           reject unknown/forbidden/timestamp fields,
 *                           record generalization provenance)
 *   2. schema-validation    candidate must be a valid glr/1 record
 *   3. content-defense      scan every string value for secrets, hashes,
 *                           URLs, paths, emails, PR refs, raw content
 *   4. cohort-suppression   drop combinations rarer than the threshold;
 *                           admit at most `rows_per_combination_limit` rows
 *                           per distinct combination (single-source
 *                           inflation bound; excess -> over_combination_cap)
 *   5. purpose-binding      export only under ONE explicit consent purpose
 *                           with per-purpose policy floors
 *   5b. aggregate-statistics when publishing cohort counts, optional
 *                           differential privacy (seeded Laplace noise,
 *                           per-purpose epsilon ceilings, seed stays private)
 *   6. risk-summary         deterministic privacy_risk block explaining
 *                           suppressed/generalized fields and gate activity
 *
 * Request-shape mistakes (missing purpose, unknown purpose, missing license
 * acknowledgement, malformed container) throw `PrivacyExportError`.
 * Per-record problems are returned in `rejected[]` — the pipeline never
 * aborts on one bad row and never echoes offending values OR caller-supplied
 * key names back: rejection diagnostics carry only package-owned
 * closed-vocabulary field names; foreign keys are reported as
 * `field_redacted: true`.
 */

import { scanGlobalLearningRecord } from "./content.js";
import {
  ABSOLUTE_MINIMUM_COHORT,
  CONSENT_PURPOSES,
  PURPOSE_POLICIES,
} from "./purposes.js";
import {
  addPrivateNoiseToCohorts,
} from "./dp.js";
import { GLR_SCHEMA_VERSION } from "./vocab.js";
import { validateGlobalLearningRecord } from "./schema.js";
import {
  suppressRareCombinations,
  aggregateCohorts,
} from "./suppression.js";
import { summarizePrivacyRisk } from "./risk.js";
import { normalizeTenantRecord, redactRejectionField } from "./transform.js";
import { pipelineTrace } from "./versions.js";

/** Error thrown for invalid export REQUESTS (as opposed to bad records). */
export class PrivacyExportError extends Error {
  /**
   * @param {string} code machine-readable reason
   * @param {string} message human-readable explanation
   */
  constructor(code, message) {
    super(message);
    this.name = "PrivacyExportError";
    this.code = code;
  }
}

function compareKeys(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Effective cohort threshold: caller may raise it, never lower it below the
 * purpose's policy floor.
 */
export function effectiveCohortThreshold(purpose, requested) {
  const floor = PURPOSE_POLICIES[purpose].minimumCohort;
  if (requested === undefined) return floor;
  if (!Number.isInteger(requested) || requested < ABSOLUTE_MINIMUM_COHORT) {
    throw new PrivacyExportError(
      "INVALID_COHORT_THRESHOLD",
      `cohortThreshold must be an integer >= ${ABSOLUTE_MINIMUM_COHORT}`,
    );
  }
  return Math.max(floor, requested);
}

/**
 * Effective per-combination admission cap for one export request: callers
 * may TIGHTEN it (fewer duplicate rows per distinct combination) but never
 * exceed the purpose's policy ceiling — the same inverse relationship as
 * epsilon. Without a cap, a single source could launder any near-unique
 * combination past the cohort floor by submitting k identical rows.
 */
export function effectiveMaxRowsPerCombination(purpose, requested) {
  const ceiling = PURPOSE_POLICIES[purpose].maximumRowsPerCombination;
  if (requested === undefined) return ceiling;
  if (!Number.isInteger(requested) || requested < 1) {
    throw new PrivacyExportError(
      "INVALID_ROWS_PER_COMBINATION",
      "maxRowsPerCombination must be a positive integer.",
    );
  }
  return Math.min(ceiling, requested);
}

/**
 * Validate a caller-private differential-privacy seed.
 * Accepted shapes: non-negative safe integer, or non-empty string.
 * The seed is never echoed into the export envelope.
 *
 * @param {unknown} seed
 * @returns {number|string} normalized seed
 */
function validatedDpSeed(seed) {
  if (
    typeof seed === "number" &&
    Number.isInteger(seed) &&
    seed >= 0 &&
    seed <= Number.MAX_SAFE_INTEGER
  ) {
    return seed;
  }
  if (
    typeof seed === "string" &&
    seed.length > 0 &&
    seed.trim().length > 0
  ) {
    return seed;
  }
  throw new PrivacyExportError(
    "INVALID_DP_SEED",
    "dpSeed must be a non-negative integer or a non-empty string; it stays caller-private and is never published.",
  );
}

/**
 * Effective epsilon for differentially private aggregate publication:
 * caller may LOWER it (more noise, stronger protection) but never exceed the
 * purpose's policy ceiling — the exact inverse of the cohort threshold floor.
 */
export function effectiveEpsilon(purpose, requested) {
  const ceiling = PURPOSE_POLICIES[purpose].maximumEpsilon;
  if (requested === undefined) return ceiling;
  if (typeof requested !== "number" || !Number.isFinite(requested) || requested <= 0) {
    throw new PrivacyExportError(
      "INVALID_EPSILON",
      "epsilon must be a positive finite number.",
    );
  }
  return Math.min(ceiling, requested);
}

/**
 * Export privacy-safe global learning records.
 *
 * @param {{
 *   records: unknown[],
 *   purpose: string,
 *   licenseAcknowledged?: boolean,
 *   cohortThreshold?: number,
 *   maxRowsPerCombination?: number,
 *   aggregateOnly?: boolean,
 *   differentialPrivacy?: boolean,
 *   epsilon?: number,
 *   dpSeed?: number|string,
 * }} request
 * @returns {{
 *   export_kind: "beetlejuice.global_learning_export",
 *   glr_schema_version: string,
 *   purpose: string,
 *   license_acknowledged: boolean,
 *   cohort_threshold: number,
 *   rows_per_combination_limit?: number,
 *   transformations: {id: string, version: string}[],
 *   counts: {provided: number, accepted: number, suppressed: number, rejected: number},
 *   privacy_risk: ReturnType<typeof summarizePrivacyRisk>,
 *   accepted?: Record<string, string|boolean>[],
 *   cohorts?: {combination: Record<string, string|boolean>, size: number}[],
 *   aggregate_mode?: "exact"|"differential_private",
 *   differential_privacy?: {mechanism: "laplace", epsilon: number, sensitivity: number},
 *   suppressed: {reason_code: string, cohort_size: number, threshold: number, rows_per_combination_limit?: number, combination: Record<string, string|boolean>}[],
 *   rejected: {index: number, reason_code: string, field?: string, field_redacted?: true}[],
 * }}
 */
export function exportGlobalLearningRecords(request = {}) {
  const {
    records,
    purpose,
    licenseAcknowledged = false,
    cohortThreshold,
    maxRowsPerCombination,
    aggregateOnly = false,
    differentialPrivacy = false,
    epsilon,
    dpSeed,
  } = request;

  // --- purpose-binding (request shape) ---
  if (typeof purpose !== "string" || purpose.length === 0) {
    throw new PrivacyExportError(
      "PURPOSE_REQUIRED",
      "An explicit consent purpose is required for every global export.",
    );
  }
  if (!CONSENT_PURPOSES.includes(purpose)) {
    throw new PrivacyExportError(
      "UNKNOWN_PURPOSE",
      "purpose must be one of the declared consent purposes.",
    );
  }
  const policy = PURPOSE_POLICIES[purpose];
  if (policy.requiresLicenseAcknowledgement && licenseAcknowledged !== true) {
    throw new PrivacyExportError(
      "LICENSE_ACKNOWLEDGEMENT_REQUIRED",
      "External research / data-licensing exports require an explicit licence acknowledgement; installation alone never grants that right.",
    );
  }

  // --- aggregate-statistics publication mode (request shape) ---
  // Differential privacy applies to PUBLISHED AGGREGATES only; row-level
  // exports have no meaningful per-record noise contract. DP parameters
  // without the flag are rejected rather than silently ignored: an operator
  // must never believe counts were noised when they were not.
  if (!differentialPrivacy && (epsilon !== undefined || dpSeed !== undefined)) {
    throw new PrivacyExportError(
      "DP_NOT_ENABLED",
      "epsilon/dpSeed require differentialPrivacy: true; refusing to silently drop privacy parameters.",
    );
  }
  let normalizedDpSeed;
  if (differentialPrivacy) {
    if (!aggregateOnly) {
      throw new PrivacyExportError(
        "DP_REQUIRES_AGGREGATE_MODE",
        "differentialPrivacy applies only to aggregateOnly exports; row-level exports are gated by cohort suppression instead.",
      );
    }
    if (dpSeed === undefined) {
      throw new PrivacyExportError(
        "DP_SEED_REQUIRED",
        "differentialPrivacy requires an explicit caller-private dpSeed; it is never inferred and never published.",
      );
    }
    normalizedDpSeed = validatedDpSeed(dpSeed);
  }
  const effectiveEps = differentialPrivacy
    ? effectiveEpsilon(purpose, epsilon)
    : undefined;

  if (!Array.isArray(records)) {
    throw new PrivacyExportError(
      "INVALID_RECORDS_CONTAINER",
      "records must be an array of tenant observations.",
    );
  }
  const k = effectiveCohortThreshold(purpose, cohortThreshold);
  // Row-level admission cap (single-source inflation bound). Published
  // aggregates are intentionally NOT capped: their counts are protected by
  // the cohort floor plus optional differential privacy, and clamping them
  // would corrupt benchmark statistics.
  const rowCap = aggregateOnly
    ? undefined
    : effectiveMaxRowsPerCombination(purpose, maxRowsPerCombination);

  // --- input-normalization + schema-validation + content-defense ---
  /** @type {{record: Record<string, string|boolean>, provenance: Record<string, string>}[]} */
  const candidates = [];
  /** @type {{index: number, reason_code: string, field?: string}[]} */
  const rejected = [];
  records.forEach((input, index) => {
    const normalized = normalizeTenantRecord(input, { index });
    if (normalized.status === "rejected") {
      rejected.push(normalized.entry);
      return;
    }
    const structural = validateGlobalLearningRecord(normalized.record);
    if (!structural.ok) {
      rejected.push({
        index,
        reason_code: structural.issues[0].code,
        ...(structural.issues[0].field ? { field: structural.issues[0].field } : {}),
      });
      return;
    }
    const scan = scanGlobalLearningRecord(normalized.record);
    if (!scan.ok) {
      rejected.push({
        index,
        field: scan.field,
        reason_code: scan.findings[0],
      });
      return;
    }
    candidates.push({
      record: normalized.record,
      provenance: normalized.provenance,
    });
  });

  // --- cohort-suppression ---
  const candidateRecords = candidates.map((c) => c.record);
  const suppression =
    aggregateOnly
      ? {
          admitted: [],
          suppressed: suppressRareCombinations(candidateRecords, { threshold: k }).suppressed,
        }
      : suppressRareCombinations(candidateRecords, {
          threshold: k,
          maxPerCombination: rowCap,
        });

  // Defense in depth: no caller-controlled string may reach the envelope,
  // not even as a rejection diagnostic. `normalizeTenantRecord` already
  // redacts foreign key names; this sweep guarantees the invariant holds for
  // every entry regardless of which stage produced it (e.g. content-defense
  // or schema-validation) and cannot regress silently. Key insertion order
  // is fixed so serialization stays byte-stable.
  const sanitizedRejected = rejected.map(({ index, reason_code, ...rest }) => ({
    index,
    reason_code: typeof reason_code === "string" ? reason_code : "invalid_rejection_shape",
    ...redactRejectionField(rest.field),
  }));
  sanitizedRejected.sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));

  // --- risk-summary (deterministic explanation of what the gate did) ---
  const privacyRisk = summarizePrivacyRisk({
    provided: records.length,
    candidates,
    admittedCount: suppression.admitted.length,
    suppressedCount: suppression.suppressed.length,
    rejected: sanitizedRejected,
  });

  const envelope = {
    export_kind: "beetlejuice.global_learning_export",
    glr_schema_version: GLR_SCHEMA_VERSION,
    purpose,
    license_acknowledged: licenseAcknowledged,
    cohort_threshold: k,
    transformations: pipelineTrace(),
    counts: {
      provided: records.length,
      accepted: suppression.admitted.length,
      suppressed: suppression.suppressed.length,
      rejected: sanitizedRejected.length,
    },
    privacy_risk: privacyRisk,
    suppressed: suppression.suppressed,
    rejected: sanitizedRejected,
  };

  if (aggregateOnly) {
    const exact = aggregateCohorts(candidateRecords, { threshold: k });
    if (differentialPrivacy) {
      envelope.aggregate_mode = "differential_private";
      envelope.cohorts = addPrivateNoiseToCohorts(exact, {
        epsilon: effectiveEps,
        sensitivity: 1,
        seed: normalizedDpSeed,
      });
      // Mechanism disclosure WITHOUT the seed: publishing the seed would let
      // any consumer subtract the noise and recover exact counts.
      envelope.differential_privacy = {
        mechanism: "laplace",
        epsilon: effectiveEps,
        sensitivity: 1,
      };
    } else {
      envelope.aggregate_mode = "exact";
      envelope.cohorts = exact;
    }
  } else {
    envelope.rows_per_combination_limit = rowCap;
    envelope.accepted = suppression.admitted;
  }

  // Deterministic key order for byte-identical serialization.
  return JSON.parse(JSON.stringify(envelope));
}
