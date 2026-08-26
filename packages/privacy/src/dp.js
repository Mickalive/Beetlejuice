/**
 * Differential privacy for PUBLISHED AGGREGATE statistics (MASTER_PROMPT.md §6:
 * "when publishing aggregate statistics, differential privacy where
 * appropriate").
 *
 * Cohort suppression alone does not protect published counts: an exact cohort
 * size is itself information, and repeated exact exports allow differencing
 * attacks across overlapping batches. This module adds calibrated Laplace
 * noise to cohort counts before they leave the gate.
 *
 * Engineering contract:
 *
 * - DETERMINISTIC. Noise draws come from a seeded PRNG; identical requests
 *   yield byte-identical exports (the package reproducibility invariant).
 *   The seed is a caller-private request parameter and is NEVER embedded in
 *   the export envelope: publishing it would enable exact de-noising.
 * - STABLE PER COHORT. A cohort's noise is derived from (seed, combination),
 *   not from batch position or run number. Exporting overlapping batches
 *   under one seed therefore reuses the same draw per cohort, so repeated
 *   releases cannot be averaged together to cancel the noise.
 * - HONEST SCOPE. Sensitivity 1 means: each individual RECORD changes any
 *   published count by at most ~e^epsilon in expectation (record-level DP).
 *   One tenant contributing many correlated rows gets weaker protection at
 *   the same epsilon; seed management (choice, storage, rotation) is the
 *   caller's responsibility. This is an engineering control — NOT legal
 *   anonymization and never marketed as such.
 * - INTEGER MATH ONLY. No Math.random(), no Date, no platform-dependent
 *   floats in the seeding path, so output reproduces across machines.
 */

/**
 * FNV-1a over UTF-8 bytes of a string, returning an unsigned 32-bit integer.
 * Used only to derive per-cohort noise draws from content — it is not an
 * identifier, never stored, and never exported.
 * @param {string} s
 * @returns {number} uint32
 */
export function fnv1a32(s) {
  let h = 0x811c9dc5;
  const bytes = new TextEncoder().encode(s);
  for (const byte of bytes) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 32-bit integer finalizer (murmur3 fmix) for avalanche behavior. */
function fmix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Deterministic seed material from the caller's private seed plus one cohort
 * key. Same inputs → same stream on every platform.
 *
 * @param {number|string} seed caller-private export seed
 * @param {string} cohortKey canonical JSON of the cohort combination
 * @returns {number} uint32 PRNG state
 */
export function cohortNoiseState(seed, cohortKey) {
  const seedPart =
    typeof seed === "number" ? seed >>> 0 : fnv1a32(String(seed));
  const mixed = fmix32((seedPart ^ fnv1a32(cohortKey)) >>> 0);
  return fmix32((mixed ^ 0x9e3779b9) >>> 0);
}

/**
 * mulberry32 PRNG: tiny, fast, deterministic, integer-state only.
 * @param {number} state uint32 seed state
 * @returns {() => number} function producing floats in [0, 1)
 */
export function mulberry32(state) {
  let a = state >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Laplace(0, b) draw from one uniform sample u ∈ [0, 1).
 * Inverse-CDF: X = -b · sign(u - ½) · ln(1 - 2|u - ½|); u = ½ maps to 0.
 * @param {number} u uniform in [0, 1)
 * @param {number} b scale (must be finite > 0)
 * @returns {number}
 */
export function laplaceFromUniform(u, b) {
  if (!Number.isFinite(b) || b <= 0) {
    throw new RangeError("laplace scale must be a positive finite number");
  }
  const centered = u - 0.5;
  if (centered === 0) return 0;
  const magnitude = -b * Math.sign(centered) * Math.log(1 - 2 * Math.abs(centered));
  if (!Number.isFinite(magnitude)) {
    // u was close enough to an endpoint that 1-2|u-½| underflowed to 0.
    // Clamp to a bounded tail instead of emitting ±Infinity.
    return magnitude > 0 ? Number.MAX_VALUE : -Number.MAX_VALUE;
  }
  return magnitude;
}

/**
 * Apply record-level Laplace mechanism to cohort counts.
 *
 * Each published `size` becomes round(trueSize + Laplace(0, sensitivity /
 * epsilon)), clamped at ≥ 0 (post-processing preserves the DP guarantee).
 * The input array must already be deterministically ordered (the exporter's
 * aggregateCohorts output is); order is preserved untouched.
 *
 * @param {{combination: Record<string, string|boolean>, size: number}[]} cohorts
 * @param {{
 *   epsilon: number,
 *   sensitivity?: number,
 *   seed: number|string,
 * }} params
 * @returns {{combination: Record<string, string|boolean>, size: number,
 *            exact_size_exposed: false}[]}
 */
export function addPrivateNoiseToCohorts(cohorts, params) {
  const { epsilon, seed } = params;
  const sensitivity = params.sensitivity ?? 1;
  if (!Number.isFinite(epsilon) || epsilon <= 0) {
    throw new RangeError("epsilon must be a positive finite number");
  }
  if (!Number.isInteger(sensitivity) || sensitivity <= 0) {
    throw new RangeError("sensitivity must be a positive integer");
  }
  if (
    (typeof seed !== "number" || !Number.isInteger(seed) || seed < 0) &&
    (typeof seed !== "string" || seed.length === 0)
  ) {
    throw new RangeError("seed must be a non-negative integer or non-empty string");
  }

  const scale = sensitivity / epsilon;
  return cohorts.map(({ combination, size }) => {
    const state = cohortNoiseState(seed, JSON.stringify(combination));
    const u = mulberry32(state)();
    const noisy = Math.round(size + laplaceFromUniform(u, scale));
    return {
      combination,
      size: Math.max(0, noisy),
      exact_size_exposed: false,
    };
  });
}
