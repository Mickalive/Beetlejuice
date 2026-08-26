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
 *   4. cohort-suppression   drop combinations rarer than the threshold
 *   5. purpose-binding      export only under ONE explicit consent purpose
 *                           with per-purpose policy floors
 *   6. risk-summary         deterministic privacy_risk block explaining
 *                           suppressed/generalized fields and gate activity
 *
 * Request-shape mistakes (missing purpose, unknown purpose, missing license
 * acknowledgement, malformed container) throw `PrivacyExportError`.
 * Per-record problems are returned in `rejected[]` — the pipeline never
 * aborts on one bad row and never echoes offending values back.
 */

import { scanGlobalLearningRecord } from "./content.js";
import {
  ABSOLUTE_MINIMUM_COHORT,
  CONSENT_PURPOSES,
  PURPOSE_POLICIES,
} from "./purposes.js";
import { GLR_SCHEMA_VERSION } from "./vocab.js";
import { validateGlobalLearningRecord } from "./schema.js";
import {
  suppressRareCombinations,
  aggregateCohorts,
} from "./suppression.js";
import { summarizePrivacyRisk } from "./risk.js";
import { normalizeTenantRecord } from "./transform.js";
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
 * Export privacy-safe global learning records.
 *
 * @param {{
 *   records: unknown[],
 *   purpose: string,
 *   licenseAcknowledged?: boolean,
 *   cohortThreshold?: number,
 *   aggregateOnly?: boolean,
 * }} request
 * @returns {{
 *   export_kind: "beetlejuice.global_learning_export",
 *   glr_schema_version: string,
 *   purpose: string,
 *   license_acknowledged: boolean,
 *   cohort_threshold: number,
 *   transformations: {id: string, version: string}[],
 *   counts: {provided: number, accepted: number, suppressed: number, rejected: number},
 *   privacy_risk: ReturnType<typeof summarizePrivacyRisk>,
 *   accepted?: Record<string, string|boolean>[],
 *   cohorts?: {combination: Record<string, string|boolean>, size: number}[],
 *   suppressed: {reason_code: string, cohort_size: number, threshold: number, combination: Record<string, string|boolean>}[],
 *   rejected: {index: number, reason_code: string, field?: string}[],
 * }}
 */
export function exportGlobalLearningRecords(request = {}) {
  const {
    records,
    purpose,
    licenseAcknowledged = false,
    cohortThreshold,
    aggregateOnly = false,
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

  if (!Array.isArray(records)) {
    throw new PrivacyExportError(
      "INVALID_RECORDS_CONTAINER",
      "records must be an array of tenant observations.",
    );
  }
  const k = effectiveCohortThreshold(purpose, cohortThreshold);

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
      : suppressRareCombinations(candidateRecords, { threshold: k });

  rejected.sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0));

  // --- risk-summary (deterministic explanation of what the gate did) ---
  const privacyRisk = summarizePrivacyRisk({
    provided: records.length,
    candidates,
    admittedCount: suppression.admitted.length,
    suppressedCount: suppression.suppressed.length,
    rejected,
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
      rejected: rejected.length,
    },
    privacy_risk: privacyRisk,
    suppressed: suppression.suppressed,
    rejected,
  };

  if (aggregateOnly) {
    envelope.cohorts = aggregateCohorts(candidateRecords, { threshold: k });
  } else {
    envelope.accepted = suppression.admitted;
  }

  // Deterministic key order for byte-identical serialization.
  return JSON.parse(JSON.stringify(envelope));
}
