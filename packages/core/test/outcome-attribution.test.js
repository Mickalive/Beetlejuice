import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TenantLedger } from '../src/index.js';
import { buildSyntheticEvents } from '../fixtures/synthetic/generate.js';

const expected = JSON.parse(readFileSync(new URL('../fixtures/synthetic/expected.json', import.meta.url), 'utf8'));

function auditedFixture() {
  const ledger = new TenantLedger('fixture-tenant');
  ledger.appendAll(buildSyntheticEvents());
  return ledger.audit();
}

test('every fixture task attributes to the conservatively expected outcome', () => {
  const audit = auditedFixture();
  for (const task of audit.tasks) {
    const exp = expected.per_task[task.taskRef];
    assert.ok(exp, `unexpected task ${task.taskRef}`);
    assert.equal(task.outcome.kind, exp.outcome, `${task.taskRef} outcome`);
    assert.equal(task.outcome.reverted, exp.reverted, `${task.taskRef} revert flag`);
    assert.equal(task.outcome.attribution, exp.attribution, `${task.taskRef} attribution class`);
  }
});

test('attribution confidence distinguishes measured from partial', () => {
  const audit = auditedFixture();
  assert.deepEqual(audit.summary.dataQuality.outcomeAttribution, expected.dataQuality.outcomeAttribution);
});

test('reverted acceptance keeps the outcome accepted but flags quality loss', () => {
  const audit = auditedFixture();
  const t10 = audit.tasks.find((t) => t.taskRef === 'TASK-010');
  assert.equal(t10.outcome.kind, 'accepted');
  assert.equal(t10.outcome.reverted, true);
  assert.equal(t10.humanReworkEvents, 1);
  // A revert is an outcome-quality signal, not provably avoidable spend.
  assert.equal(audit.waste.findings.filter((f) => f.task_ref === 'TASK-010').length, 0);
});

test('retry and rework counters survive reconstruction', () => {
  const audit = auditedFixture();
  const t4 = audit.tasks.find((t) => t.taskRef === 'TASK-004');
  const t6 = audit.tasks.find((t) => t.taskRef === 'TASK-006');
  assert.equal(t4.retries, 1);
  assert.equal(t6.retries, 2);
});
