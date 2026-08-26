/**
 * Cost-component accounting.
 *
 * Invariant (MASTER_PROMPT §22 critical cost test):
 *   inference + tools + CI + compute (+ validation + human) === total known cost
 *
 * Unknown costs are never guessed: they are excluded from measured totals and
 * surfaced as an explicit count so reports can state data quality honestly.
 */

export const COST_KINDS = Object.freeze(['inference', 'tools', 'ci', 'compute', 'validation', 'human']);

/**
 * Canonical cost-evidence states (audit LIVE-REPORT-ZERO-DOLLARS repair,
 * producer side). A headline that renders `$0.00` when no cost evidence was
 * ever supplied is technically honest but economically misleading; surfaces
 * should key off this state instead of re-deriving the distinction:
 *
 * - `measured`      — known spend > 0: render the amount.
 * - `measured_zero` — every observed component carried a SUPPLIED cost and
 *                     they sum to exactly zero: `$0.00` is genuinely measured.
 * - `unmeasured`    — representable spend is 0 AND unavailable components
 *                     exist: the total is NOT knowable from this evidence;
 *                     render "no measurable cost evidence supplied" instead
 *                     of `$0.00`.
 * - `none_observed` — zero cost-bearing components in the audit window.
 */
export const COST_EVIDENCE_STATES = Object.freeze(['measured', 'measured_zero', 'unmeasured', 'none_observed']);

/**
 * Derive the canonical evidence state from a rollup (or any object carrying
 * `knownMicroUsd`, `unknownComponentCount`, `totalComponents`).
 */
export function costEvidenceState({ knownMicroUsd, unknownComponentCount, totalComponents }) {
  for (const [field, value] of [
    ['knownMicroUsd', knownMicroUsd],
    ['unknownComponentCount', unknownComponentCount],
    ['totalComponents', totalComponents],
  ]) {
    if (!Number.isInteger(value) || value < 0) {
      throw new TypeError(`costEvidenceState requires non-negative integer ${field}`);
    }
  }
  if (totalComponents === 0) return 'none_observed';
  if (knownMicroUsd > 0) return 'measured';
  if (unknownComponentCount > 0) return 'unmeasured';
  return 'measured_zero';
}

export function emptyRollup() {
  return {
    currency: 'USD',
    unit: 'micro_usd',
    knownMicroUsd: 0,
    totalComponents: 0,
    unknownComponentCount: 0,
    byKindMicroUsd: Object.fromEntries(COST_KINDS.map((k) => [k, 0])),
    byKindComponentCount: Object.fromEntries(COST_KINDS.map((k) => [k, 0])),
  };
}

function addComponent(rollup, component) {
  rollup.totalComponents += 1;
  rollup.byKindComponentCount[component.kind] = (rollup.byKindComponentCount[component.kind] ?? 0) + 1;
  if (component.cost && component.cost.known === true) {
    rollup.knownMicroUsd += component.cost.micro_usd;
    rollup.byKindMicroUsd[component.kind] = (rollup.byKindMicroUsd[component.kind] ?? 0) + component.cost.micro_usd;
  } else {
    rollup.unknownComponentCount += 1;
  }
}

function* componentIterator(task) {
  for (const execution of task.executions) {
    for (const bucket of Object.values(execution.components)) {
      for (const component of bucket) yield component;
    }
  }
  for (const bucket of Object.values(task.unassignedComponents)) {
    for (const component of bucket) yield component;
  }
}

/** Roll up all cost-bearing components of a reconstructed task. */
export function rollupTaskCost(task) {
  const rollup = emptyRollup();
  for (const component of componentIterator(task)) {
    addComponent(rollup, component);
  }
  return deepFreezeCost(rollup);
}

function deepFreezeCost(rollup) {
  Object.freeze(rollup.byKindMicroUsd);
  Object.freeze(rollup.byKindComponentCount);
  return Object.freeze(rollup);
}

/**
 * Prove the accounting identity holds for a set of tasks:
 * sum(by kind) === total known cost, and every component is counted exactly once.
 */
export function verifyCostAccounting(tasks) {
  const total = emptyRollup();
  for (const task of tasks) {
    const r = rollupTaskCost(task);
    total.totalComponents += r.totalComponents;
    total.unknownComponentCount += r.unknownComponentCount;
    total.knownMicroUsd += r.knownMicroUsd;
    for (const kind of COST_KINDS) {
      total.byKindMicroUsd[kind] += r.byKindMicroUsd[kind] ?? 0;
      total.byKindComponentCount[kind] += r.byKindComponentCount[kind] ?? 0;
    }
  }
  const kindSum = COST_KINDS.reduce((acc, k) => acc + total.byKindMicroUsd[k], 0);
  return deepFreezeCost({
    ...total,
    balanced: kindSum === total.knownMicroUsd && total.totalComponents >= total.unknownComponentCount,
  });
}
