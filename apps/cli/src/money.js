// Money helpers for the product surface.
//
// Canonical accounting unit is the INTEGER MICRO-USD (1 USD = 1_000_000 µ$),
// matching packages/core exactly so canonical-core exports flow through this
// surface with zero conversion loss. Rounding happens only at presentation.
//
// Display policy:
// - amounts that are exact cent multiples render as "$X.YY";
// - sub-cent precision is preserved honestly ("$0.012345") instead of hidden;
// - derived ratios (cost per successful outcome) are rounded half-up to the
//   cent FOR DISPLAY ONLY via roundHalfUpToCent(), while their exact values
//   stay in the report JSON.

export const MICROS_PER_USD = 1_000_000;

/** Round a positive number half-up to the nearest integer. */
export function roundHalfUp(value) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value + 0.5);
}

/** Round an integer micro-USD amount half-up to the nearest whole cent. */
export function roundHalfUpToCent(microUsd) {
  const value = Number(microUsd);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value / 10_000 + 0.5) * 10_000;
}

/**
 * Format integer micro-USD as a USD display string without rounding.
 * Exact cent multiples -> "$28.57"; sub-cent precision is kept visible.
 * @param {number} microUsd non-negative integer
 */
export function formatMicroUsd(microUsd) {
  if (!Number.isInteger(microUsd) || microUsd < 0) {
    throw new TypeError(`formatMicroUsd() expects a non-negative integer micro-usd amount, got ${microUsd}`);
  }
  if (microUsd % 10_000 === 0) {
    const cents = microUsd / 10_000;
    const dollars = Math.floor(cents / 100);
    const rem = String(cents % 100).padStart(2, "0");
    return `$${dollars}.${rem}`;
  }
  const fixed = (microUsd / MICROS_PER_USD).toFixed(6);
  let [intPart, decPart] = fixed.split(".");
  decPart = decPart.replace(/0+$/, "");
  if (decPart.length < 2) decPart = decPart.padEnd(2, "0");
  return `$${intPart}.${decPart}`;
}

/** Format a possibly fractional micro-USD figure for display after half-up cent rounding. */
export function formatMicroUsdDisplay(microUsd) {
  return formatMicroUsd(roundHalfUpToCent(microUsd));
}

/** Format an integer with thousands separators (display only). */
export function formatCount(value) {
  return String(Math.max(0, Math.round(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
