import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TenantLedger } from '../src/index.js';
import { buildSyntheticEvents } from '../fixtures/synthetic/generate.js';

const datasetPath = new URL('../fixtures/synthetic/dataset.json', import.meta.url);
const expectedPath = new URL('../fixtures/synthetic/expected.json', import.meta.url);
const committedDataset = JSON.parse(readFileSync(datasetPath, 'utf8'));
const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));

test('generator output is byte-stable against the committed dataset fixture', () => {
  assert.deepEqual(buildSyntheticEvents(), committedDataset);
});

test('two independent generations produce identical event streams', () => {
  assert.deepEqual(buildSyntheticEvents(), buildSyntheticEvents());
});

test('fixture audit reproduces the hand-verified expected economics contract exactly', () => {
  const ledger = new TenantLedger('fixture-tenant');
  ledger.appendAll(committedDataset); // replay from the committed file, not the generator
  const audit = ledger.audit();

  assert.equal(audit.summary.dataQuality.eventCount, expected.event_count);

  assert.deepEqual(audit.summary.totals, expected.totals);

  assert.equal(audit.summary.cost.knownMicroUsd, expected.cost.knownMicroUsd);
  assert.equal(audit.summary.cost.unknownComponentCount, expected.cost.unknownComponentCount);
  assert.deepEqual(audit.summary.cost.byKindMicroUsd, expected.cost.byKindMicroUsd);
  assert.equal(audit.summary.cost.costPerAcceptedOutcomeMicroUsd, expected.cost.costPerAcceptedOutcomeMicroUsd);
  assert.equal(audit.summary.cost.accountingBalanced, true);

  assert.equal(audit.waste.findings.length, expected.waste.findingsCount);
  assert.equal(audit.waste.certainlyAvoidableMicroUsd, expected.waste.certainlyAvoidableMicroUsd);
  assert.deepEqual(audit.summary.waste.byRuleMicroUsd, expected.waste.byRuleMicroUsd);
  assert.deepEqual(audit.waste.findings.map((f) => f.finding_id), expected.waste.expectedFindingIds);

  for (const task of audit.tasks) {
    const exp = expected.per_task[task.taskRef];
    assert.ok(exp, `unexpected task ${task.taskRef}`);
    assert.equal(task.outcome.kind, exp.outcome);
    assert.equal(task.outcome.reverted, exp.reverted);
    assert.equal(task.outcome.attribution, exp.attribution);
    let wasteForTask = 0;
    for (const f of audit.waste.findings) {
      if (f.task_ref === task.taskRef) wasteForTask += f.wasted_micro_usd;
    }
    assert.equal(wasteForTask, exp.waste_micro_usd, `${task.taskRef} waste`);
  }

  // Waste ratio rounding policy: half-up at 6 decimals of the exact ratio.
  const exactRatio = expected.waste.certainlyAvoidableMicroUsd / expected.cost.knownMicroUsd;
  assert.equal(Math.round(exactRatio * 1e6) / 1e6, expected.waste.ratioOfKnownCost);
});
