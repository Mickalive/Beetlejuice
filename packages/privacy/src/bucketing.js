/**
 * Bucketing / generalization helpers.
 *
 * Raw magnitudes (cost, duration, tokens, counts) never reach the global
 * dataset: they are mapped onto coarse, published range buckets. The bucket
 * label vocabularies live in `vocab.js`; these functions are the only
 * sanctioned way to produce those labels from raw tenant-side numbers.
 *
 * All functions are pure and deterministic so exports remain reproducible.
 */

import {
  COST_BUCKET,
  DURATION_BUCKET,
  FILE_COUNT_BUCKET,
  RETRY_BUCKET,
  TOKEN_BUCKET,
  TOOL_CALL_BUCKET,
} from "./vocab.js";

/** @returns {boolean} true when v is a finite number (NaN/Infinity rejected). */
function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

/** @returns {boolean} true when v is an integer >= 0. */
function isNonNegativeInt(v) {
  return isFiniteNumber(v) && Number.isInteger(v) && v >= 0;
}

/**
 * Cost magnitude buckets (US dollars, coarse ranges).
 * @param {number} usd non-negative finite cost
 * @returns {(typeof COST_BUCKET)[number]}
 */
export function bucketCostUSD(usd) {
  if (!isFiniteNumber(usd)) return "unknown";
  if (usd < 0) return "unknown";
  if (usd === 0) return "zero";
  if (usd < 1) return "under_1";
  if (usd < 10) return "1_to_10";
  if (usd < 100) return "10_to_100";
  if (usd < 1000) return "100_to_1000";
  if (usd < 10000) return "1000_to_10000";
  return "over_10000";
}

/**
 * Wall-clock duration buckets from milliseconds.
 * @param {number} ms non-negative finite duration
 * @returns {(typeof DURATION_BUCKET)[number]}
 */
export function bucketDurationMs(ms) {
  if (!isFiniteNumber(ms)) return "unknown";
  if (ms < 0) return "unknown";
  if (ms === 0) return "zero";
  if (ms < 1000) return "under_1s";
  if (ms < 60000) return "1s_to_60s";
  if (ms < 600000) return "1m_to_10m";
  if (ms < 3600000) return "10m_to_60m";
  if (ms < 21600000) return "1h_to_6h";
  return "over_6h";
}

/**
 * Token-volume buckets.
 * @param {number} tokens non-negative integer token total
 * @returns {(typeof TOKEN_BUCKET)[number]}
 */
export function bucketTokens(tokens) {
  if (!isNonNegativeInt(tokens)) return "unknown";
  if (tokens === 0) return "zero";
  if (tokens < 1000) return "under_1k";
  if (tokens < 10000) return "1k_to_10k";
  if (tokens < 100000) return "10k_to_100k";
  if (tokens < 1000000) return "100k_to_1m";
  return "over_1m";
}

/**
 * Tool-invocation-count buckets.
 * @param {number} n non-negative integer tool-call count
 * @returns {(typeof TOOL_CALL_BUCKET)[number]}
 */
export function bucketToolCalls(n) {
  if (!isNonNegativeInt(n)) return "unknown";
  if (n === 0) return "zero";
  if (n === 1) return "one";
  if (n <= 5) return "2_to_5";
  if (n <= 20) return "6_to_20";
  return "over_20";
}

/**
 * Retry-count buckets. Exact small retry counts are kept coarse on purpose:
 * even small integers can become quasi-identifiers in combination.
 * @param {number} n non-negative integer retry count
 * @returns {(typeof RETRY_BUCKET)[number]}
 */
export function bucketRetryCount(n) {
  if (!isNonNegativeInt(n)) return "unknown";
  if (n === 0) return "zero";
  if (n === 1) return "one";
  if (n <= 3) return "2_to_3";
  return "over_3";
}

/**
 * Files-touched buckets.
 * @param {number} n non-negative integer count of files touched
 * @returns {(typeof FILE_COUNT_BUCKET)[number]}
 */
export function bucketFileCount(n) {
  if (!isNonNegativeInt(n)) return "unknown";
  if (n === 0) return "zero";
  if (n === 1) return "one";
  if (n <= 3) return "2_to_3";
  if (n <= 9) return "4_to_9";
  if (n <= 99) return "10_to_99";
  return "over_100";
}
