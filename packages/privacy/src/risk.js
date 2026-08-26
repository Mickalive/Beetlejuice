/**
 * Privacy-risk summary — the explanatory result demanded by WC-003:
 * "privacy-risk result explaining suppressed/generalized fields".
 *
 * For every export, this module aggregates WHAT the gate did:
 *
 * - `generalized_fields`: per GLR field, how many candidate records had the
 *   value produced by bucketing a raw magnitude (`bucketed`), classifying a
 *   raw name (`classified`), or filling an absent input with a coarse
 *   default (`defaulted`). Fully explicit fields are omitted entirely.
 * - `rejected_reasons`: aggregated rejection reason codes with counts,
 *   sorted deterministically. No offending key or value is ever echoed.
 * - `risk_level`: a coarse operational signal derived ONLY from gate
 *   outcomes (never from record contents):
 *     high   — identifier/content smuggling was attempted and blocked
 *              (reason codes starting with `forbidden_` or ending with
 *              `_detected`);
 *     medium — the gate altered or dropped records (suppression or benign
 *              rejections such as malformed rows);
 *     low    — every provided record was admitted without suppression.
 *
 * This is an operational signal about gate activity. It is NOT a claim of
 * anonymity and must never be marketed as legal anonymization.
 */

export const PRIVACY_RISK_LEVELS = Object.freeze(["low", "medium", "high"]);

/** Kinds of generalization reported per field (mirrors transform.js). */
export const GENERALIZATION_KINDS = Object.freeze([
  "explicit",
  "bucketed",
  "classified",
  "defaulted",
]);

function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Build the deterministic privacy-risk summary for one export run.
 *
 * @param {{
 *   provided: number,
 *   candidates: {record: Record<string, string|boolean>, provenance: Record<string, string>}[],
 *   admittedCount: number,
 *   suppressedCount: number,
 *   rejected: {index: number, reason_code: string, field?: string}[],
 * }} run
 * @returns {{
 *   risk_level: (typeof PRIVACY_RISK_LEVELS)[number],
 *   provided_records: number,
 *   candidate_records: number,
 *   admitted_records: number,
 *   suppressed_records: number,
 *   rejected_records: number,
 *   rejected_reasons: {reason_code: string, count: number}[],
 *   generalized_fields: Record<string, Record<string, number>>,
 * }}
 */
export function summarizePrivacyRisk(run) {
  const { provided, candidates, admittedCount, suppressedCount, rejected } = run;

  // 1. Generalization provenance, aggregated over all normalized candidates
  //    (admitted or later suppressed — generalization happened regardless).
  /** @type {Map<string, Map<string, number>>} */
  const byField = new Map();
  for (const { provenance } of candidates) {
    for (const [field, kind] of Object.entries(provenance)) {
      if (kind === "explicit") continue;
      let kinds = byField.get(field);
      if (!kinds) {
        kinds = new Map();
        byField.set(field, kinds);
      }
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    }
  }

  /** @type {Record<string, Record<string, number>>} */
  const generalized_fields = {};
  for (const field of [...byField.keys()].sort(compareStrings)) {
    const kinds = byField.get(field);
    const counts = {};
    for (const kind of GENERALIZATION_KINDS) {
      if (kind === "explicit") continue;
      const n = kinds.get(kind);
      if (n) counts[kind] = n;
    }
    if (Object.keys(counts).length > 0) generalized_fields[field] = counts;
  }

  // 2. Rejection reasons, aggregated and canonically ordered.
  /** @type {Map<string, number>} */
  const reasonCounts = new Map();
  for (const entry of rejected) {
    reasonCounts.set(
      entry.reason_code,
      (reasonCounts.get(entry.reason_code) ?? 0) + 1,
    );
  }
  const rejected_reasons = [...reasonCounts.entries()]
    .sort((a, b) => compareStrings(a[0], b[0]))
    .map(([reason_code, count]) => ({ reason_code, count }));

  // 3. Coarse risk level from gate outcomes only.
  const smugglingAttempt = rejected_reasons.some(
    ({ reason_code }) =>
      reason_code.startsWith("forbidden_") || reason_code.endsWith("_detected"),
  );
  const risk_level = smugglingAttempt
    ? "high"
    : suppressedCount > 0 || rejected.length > 0
      ? "medium"
      : "low";

  return {
    risk_level,
    provided_records: provided,
    candidate_records: candidates.length,
    admitted_records: admittedCount,
    suppressed_records: suppressedCount,
    rejected_records: rejected.length,
    rejected_reasons,
    generalized_fields,
  };
}
