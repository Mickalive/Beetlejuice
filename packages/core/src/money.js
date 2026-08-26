/**
 * Money is accounted as integer micro-USD (1 USD = 1_000_000 µ$).
 * Integer accounting keeps cost sums exact — no floating point drift — which
 * is a hard requirement for defensible waste findings and audit reports.
 */
export const MICROS_PER_USD = 1_000_000;

/** Convert a decimal USD amount to integer micro-USD (round-half-up). */
export function usd(amount) {
  if (!Number.isFinite(amount)) {
    throw new TypeError(`usd() expects a finite number, got ${amount}`);
  }
  return Math.round(amount * MICROS_PER_USD);
}

/** Format integer micro-USD as a human-readable USD string ("$3.30"). */
export function formatUsd(microUsd) {
  if (!Number.isInteger(microUsd) || microUsd < 0) {
    throw new TypeError(`formatUsd() expects a non-negative integer micro-usd amount, got ${microUsd}`);
  }
  const fixed = (microUsd / MICROS_PER_USD).toFixed(6);
  let [intPart, decPart] = fixed.split('.');
  decPart = decPart.replace(/0+$/, '');
  if (decPart.length < 2) decPart = decPart.padEnd(2, '0');
  return `$${intPart}.${decPart}`;
}
