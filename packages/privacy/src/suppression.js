/**
 * Rare-combination / cohort suppression (k-anonymity style).
 *
 * Removing names is not enough: a combination of abstract dimensions can be
 * so rare that it still identifies one source. Before anything is admitted
 * to the global dataset, records are grouped by their full quasi-identifier
 * combination and every group smaller than the cohort threshold is either
 * further generalized upstream or suppressed here.
 *
 * The grouping key is derived ONLY from the record's own abstract content —
 * there is no stored id, no pseudonym and no hash acting as a join key.
 */

import { validateGlobalLearningRecord } from "./schema.js";

/**
 * Deterministic grouping key for a candidate record.
 * Records are flat objects with canonical field order, so JSON serialization
 * is stable. Callers must pass schema-valid records.
 *
 * @param {Record<string, string|boolean>} record
 * @returns {string}
 */
export function combinationKey(record) {
  const check = validateGlobalLearningRecord(record);
  if (!check.ok) {
    throw new TypeError("combinationKey requires a schema-valid GLR candidate");
  }
  return JSON.stringify(record);
}

/** Compare JSON strings without locale-dependent collation. */
function compareKeys(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function groupByCombination(records) {
  /** @type {Map<string, Record<string, string|boolean>[]>} */
  const groups = new Map();
  for (const record of records) {
    const key = combinationKey(record);
    const bucket = groups.get(key);
    if (bucket) bucket.push(record);
    else groups.set(key, [record]);
  }
  return groups;
}

/**
 * Suppress every record whose exact abstract combination occurs fewer than
 * `threshold` times in the batch. One entry is emitted PER SUPPRESSED RECORD
 * (all sharing the group's explanation) so callers can conserve record
 * counts: accepted + suppressed + rejected === provided.
 *
 * @param {Record<string, string|boolean>[]} candidates schema-valid records
 * @param {{threshold?: number}} [options]
 * @returns {{
 *   admitted: Record<string, string|boolean>[],
 *   suppressed: {reason_code: "below_cohort_threshold", cohort_size: number, threshold: number, combination: Record<string, string|boolean>}[],
 * }}
 */
export function suppressRareCombinations(candidates, options = {}) {
  const threshold = options.threshold ?? 1;
  const groups = groupByCombination(candidates);

  const admitted = [];
  const suppressed = [];
  for (const [, members] of groups) {
    if (members.length >= threshold) {
      admitted.push(...members);
    } else {
      for (const member of members) {
        suppressed.push({
          reason_code: "below_cohort_threshold",
          cohort_size: members.length,
          threshold,
          combination: member,
        });
      }
    }
  }

  // Canonical ordering keeps exports byte-identical across runs regardless
  // of input order.
  admitted.sort((a, b) => compareKeys(JSON.stringify(a), JSON.stringify(b)));
  suppressed.sort((a, b) => compareKeys(JSON.stringify(a.combination), JSON.stringify(b.combination)));

  return { admitted, suppressed };
}

/**
 * Aggregate view for downstream learning: only combinations meeting the
 * threshold are emitted, as counts. This supports aggregate-statistics use
 * cases where individual rows should not exist at all.
 *
 * @param {Record<string, string|boolean>[]} candidates
 * @param {{threshold?: number}} [options]
 * @returns {{combination: Record<string, string|boolean>, size: number}[]}
 */
export function aggregateCohorts(candidates, options = {}) {
  const threshold = options.threshold ?? 1;
  const groups = groupByCombination(candidates);
  const out = [];
  for (const [key, members] of groups) {
    if (members.length >= threshold) {
      out.push({ combination: members[0], size: members.length });
    }
  }
  out.sort((a, b) => compareKeys(JSON.stringify(a.combination), JSON.stringify(b.combination)));
  return out;
}
