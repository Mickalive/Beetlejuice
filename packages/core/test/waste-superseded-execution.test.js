import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TenantLedger, runWasteAnalysis, reconstructTasks, RULE_EXEC_SUPERSEDED, rollupTaskCost } from '../src/index.js';
import { buildSyntheticEvents } from '../fixtures/synthetic/generate.js';

const expected = JSON.parse(readFileSync(new URL('../fixtures/synthetic/expected.json', import.meta.url), 'utf8'));

test('superseded execution cost is attributed as certain waste in the fixture', () => {
  const tasks = [...reconstructTasks(buildSyntheticEvents()).values()];
  const t7 = tasks.find((t) => t.taskRef === 'TASK-007');
  const { findings } = runWasteAnalysis([t7], { rules: [RULE_EXEC_SUPERSEDED] });
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].evidence_refs, ['MI-007-1']);
  assert.equal(findings[0].wasted_micro_usd, expected.per_task['TASK-007'].waste_micro_usd);
  assert.match(findings[0].explanation, /EX-007-A/);
  assert.match(findings[0].explanation, /EX-007-B/);
  assert.match(findings[0].explanation, /\$1\.10/);
});

test('superseded executions without components yield no empty findings', () => {
  const ledger = new TenantLedger('t');
  ledger.appendAll([
    { type: 'task_started', task_ref: 'T-E', time: '2026-08-01T00:00:00Z', payload: {} },
    { type: 'execution_started', task_ref: 'T-E', payload: { execution_ref: 'E1' }, execution_ref: 'E1' },
    { type: 'execution_finished', task_ref: 'T-E', payload: { execution_ref: 'E1', status: 'superseded', superseded_by_execution_ref: 'E2' }, execution_ref: 'E1' },
    { type: 'execution_started', task_ref: 'T-E', payload: { execution_ref: 'E2' }, execution_ref: 'E2' },
  ]);
  const t = ledger.reconstruct().get('T-E');
  const e1 = t.executions.find((x) => x.executionRef === 'E1');
  assert.equal(e1.status, 'superseded');
  assert.equal(runWasteAnalysis([t], { rules: [RULE_EXEC_SUPERSEDED] }).findings.length, 0);
});

test('unknown-cost components inside a superseded execution are reported but unquantified', () => {
  const ledger = new TenantLedger('t');
  ledger.appendAll([
    { type: 'task_started', task_ref: 'T-U', time: '2026-08-01T00:00:00Z', payload: {} },
    { type: 'execution_started', task_ref: 'T-U', payload: { execution_ref: 'E1' }, execution_ref: 'E1' },
    { type: 'tool_invocation_recorded', task_ref: 'T-U', execution_ref: 'E1', payload: { tool_ref: 'TL-X', status: 'ok', cost: { known: false, reason: 'no pricing evidence' } } },
    { type: 'execution_finished', task_ref: 'T-U', payload: { execution_ref: 'E1', status: 'superseded', superseded_by_execution_ref: 'E2' }, execution_ref: 'E1' },
    { type: 'execution_started', task_ref: 'T-U', payload: { execution_ref: 'E2' }, execution_ref: 'E2' },
  ]);
  const t = ledger.reconstruct().get('T-U');
  const rollup = rollupTaskCost(t);
  assert.equal(rollup.unknownComponentCount, 1);
  const { findings } = runWasteAnalysis([t], { rules: [RULE_EXEC_SUPERSEDED] });
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].unquantified_evidence_refs, ['TL-X']);
  assert.equal(findings[0].wasted_micro_usd, 0);
});

test('completed or failed executions are never claimed by the supersession rule', () => {
  const ledger = new TenantLedger('t');
  ledger.appendAll([
    { type: 'task_started', task_ref: 'T-C', time: '2026-08-01T00:00:00Z', payload: {} },
    { type: 'execution_started', task_ref: 'T-C', payload: { execution_ref: 'E1' }, execution_ref: 'E1' },
    { type: 'model_invocation_recorded', task_ref: 'T-C', execution_ref: 'E1', payload: { invocation_ref: 'MI-C1', status: 'ok', cost: { known: true, micro_usd: 500 } } },
    { type: 'execution_finished', task_ref: 'T-C', payload: { execution_ref: 'E1', status: 'failed', failure_class: 'agent_error' }, execution_ref: 'E1' },
  ]);
  const t = ledger.reconstruct().get('T-C');
  assert.equal(runWasteAnalysis([t], { rules: [RULE_EXEC_SUPERSEDED] }).findings.length, 0);
});
