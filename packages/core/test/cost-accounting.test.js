import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TenantLedger,
  rollupTaskCost,
  verifyCostAccounting,
  COST_KINDS,
  computeSummary,
} from '../src/index.js';
import { buildSyntheticEvents } from '../fixtures/synthetic/generate.js';

const expected = JSON.parse(readFileSync(new URL('../fixtures/synthetic/expected.json', import.meta.url), 'utf8'));

function fixtureTasks() {
  const ledger = new TenantLedger('fixture-tenant');
  ledger.appendAll(buildSyntheticEvents());
  return ledger.tasks();
}

// MASTER_PROMPT §22 critical cost test:
// represented inference + tools + CI + compute (+ validation + human) = total.
test('cost accounting identity holds exactly across the whole fixture', () => {
  const tasks = fixtureTasks();
  const accounting = verifyCostAccounting(tasks);
  assert.equal(accounting.balanced, true);
  assert.equal(accounting.knownMicroUsd, expected.cost.knownMicroUsd);
  assert.deepEqual(accounting.byKindMicroUsd, expected.cost.byKindMicroUsd);

  const kindSum = COST_KINDS.reduce((acc, k) => acc + accounting.byKindMicroUsd[k], 0);
  assert.equal(kindSum, accounting.knownMicroUsd, 'sum of represented components must equal total cost');
});

test('unknown costs are excluded from totals but never hidden', () => {
  const tasks = fixtureTasks();
  const accounting = verifyCostAccounting(tasks);
  assert.equal(accounting.unknownComponentCount, expected.cost.unknownComponentCount);

  // TASK-009 carries the unpriceable validation; its known cost excludes it.
  const t9 = tasks.find((t) => t.taskRef === 'TASK-009');
  const r9 = rollupTaskCost(t9);
  assert.equal(r9.unknownComponentCount, 1);
  assert.equal(r9.knownMicroUsd, 500000);
});

test('per-task cost rollups match the hand-verified fixture contract', () => {
  const tasks = fixtureTasks();
  for (const [taskRef, exp] of Object.entries(expected.per_task)) {
    const task = tasks.find((t) => t.taskRef === taskRef);
    assert.ok(task, `missing fixture task ${taskRef}`);
    const rollup = rollupTaskCost(task);
    assert.equal(rollup.knownMicroUsd, exp.known_micro_usd, `${taskRef} known cost`);
  }
});

test('computeSummary reports the first-screen economics with exact integers', () => {
  const ledger = new TenantLedger('t');
  ledger.appendAll(buildSyntheticEvents());
  const audit = ledger.audit();
  const summary = audit.summary;

  assert.equal(summary.totals.tasks, expected.totals.tasks);
  assert.equal(summary.totals.accepted, expected.totals.accepted);
  assert.equal(summary.totals.failed, expected.totals.failed);
  assert.equal(summary.totals.aborted, expected.totals.aborted);
  assert.equal(summary.totals.unresolved, expected.totals.unresolved);
  assert.equal(summary.totals.acceptedWithRevert, expected.totals.acceptedWithRevert);
  assert.equal(summary.totals.withHumanRework, expected.totals.withHumanRework);

  assert.equal(summary.cost.knownMicroUsd, expected.cost.knownMicroUsd);
  assert.equal(summary.cost.unknownComponentCount, expected.cost.unknownComponentCount);
  assert.equal(summary.cost.costPerAcceptedOutcomeMicroUsd, expected.cost.costPerAcceptedOutcomeMicroUsd);
  assert.equal(summary.cost.accountingBalanced, true);
  assert.equal(summary.waste.certainlyAvoidableMicroUsd, expected.waste.certainlyAvoidableMicroUsd);
  assert.equal(summary.waste.ratioOfKnownCost, expected.waste.ratioOfKnownCost);
  assert.equal(summary.dataQuality.eventCount, expected.event_count);
});

test('cost per accepted outcome divides ALL measured cost by accepted outcomes (honest economics)', () => {
  // 22,960,000 µ$ across 7 accepted outcomes = exactly 3,280,000 µ$ each.
  // Failed/aborted/unresolved spend stays in the numerator on purpose.
  const ledger = new TenantLedger('t');
  ledger.appendAll(buildSyntheticEvents());
  const summary = ledger.audit().summary;
  assert.equal(
    summary.cost.costPerAcceptedOutcomeMicroUsd,
    Math.round(22960000 / 7)
  );
});

test('zero accepted outcomes yields null cost-per-accepted instead of a fake number', () => {
  const ledger = new TenantLedger('t');
  ledger.appendAll([
    { type: 'task_started', task_ref: 'T-X', time: '2026-08-01T00:00:00Z', payload: {} },
    { type: 'model_invocation_recorded', task_ref: 'T-X', payload: { invocation_ref: 'MI-1', status: 'ok', cost: { known: true, micro_usd: 100 } } },
  ]);
  const summary = computeSummary({ tasks: ledger.tasks(), waste: { findings: [], certainlyAvoidableMicroUsd: 0 }, eventCount: ledger.size });
  assert.equal(summary.cost.costPerAcceptedOutcomeMicroUsd, null);
});
