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
 *
 * Additionally, admission per distinct combination can be capped
 * (`maxPerCombination`): cohort floors alone are launderable by one source
 * duplicating rows within a single batch, so the gate bounds how many rows
 * ONE export may contribute to any single combination.
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
 * `threshold` times in the batch, and admit at most `maxPerCombination` rows
 * per distinct combination.
 *
 * The cap closes a laundering hole in pure k-anonymity: a single source
 * could otherwise push any near-unique combination past the floor by
 * submitting k duplicate rows in one batch. Rows beyond the cap are
 * SUPPRESSED with `over_combination_cap` (never silently dropped and never
 * admitted), so `accepted + suppressed === candidates.length` still holds.
 * All members of a group are byte-identical by construction (the grouping
 * key is the full record), so which copies are admitted is irrelevant and
 * the outcome stays independent of input order.
 *
 * One entry is emitted PER SUPPRESSED RECORD (all sharing the group's
 * explanation) so callers can conserve record counts.
 *
 * @param {Record<string, string|boolean>[]} candidates schema-valid records
 * @param {{threshold?: number, maxPerCombination?: number}} [options]
 *   `maxPerCombination` omitted/undefined disables capping for direct
 *   low-level use; the exporter always passes an effective policy cap.
 * @returns {{
 *   admitted: Record<string, string|boolean>[],
 *   suppressed: {reason_code: "below_cohort_threshold"|"over_combination_cap", cohort_size: number, threshold: number, rows_per_combination_limit?: number, combination: Record<string, string|boolean>}[],
 * }}
 */
export function suppressRareCombinations(candidates, options = {}) {
  const threshold = options.threshold ?? 1;
  /** @type {number} */
  let cap = Infinity;
  if (options.maxPerCombination !== undefined) {
    if (
      !Number.isInteger(options.maxPerCombination) ||
      options.maxPerCombination < 1
    ) {
      throw new TypeError(
        "maxPerCombination must be a positive integer when provided",
      );
    }
    cap = options.maxPerCombination;
  }
  const groups = groupByCombination(candidates);

  const admitted = [];
  const suppressed = [];
  for (const [, members] of groups) {
    if (members.length >= threshold) {
      admitted.push(...members.slice(0, cap));
      for (const member of members.slice(cap)) {
        suppressed.push({
          reason_code: "over_combination_cap",
          cohort_size: members.length,
          threshold,
          rows_per_combination_limit: cap,
          combination: member,
        });
      }
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
