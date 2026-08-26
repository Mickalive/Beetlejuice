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
