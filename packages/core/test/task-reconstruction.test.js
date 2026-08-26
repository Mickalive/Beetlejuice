import test from 'node:test';
import assert from 'node:assert/strict';
import { TenantLedger, reconstructTasks, BeetlejuiceCoreError, ErrorCodes } from '../src/index.js';
import { rawEvent, cost, appendAcceptedTask } from './helpers.js';

test('projects a canonical stream into an AGENTIC_TASK aggregate with components nested under executions', () => {
  const ledger = new TenantLedger('t');
  appendAcceptedTask(ledger, 'T-A');
  const task = ledger.reconstruct().get('T-A');
  assert.equal(task.outcome.kind, 'accepted');
  assert.equal(task.executions.length, 1);
  const execution = task.executions[0];
  assert.equal(execution.status, 'completed');
  assert.equal(execution.components.modelInvocations.length, 1);
  assert.equal(execution.components.ciRuns.length, 1);
  assert.equal(task.pullRequests[0].merged, true);
});

test('outcome priority: merged beats closed; closed-without-merge is failed', () => {
  const ledger = new TenantLedger('t');
  // PR created -> closed -> merged (e.g. closed as draft, then merged).
  ledger.appendAll([
    rawEvent('task_started', 'T-1'),
    rawEvent('pull_request_created', 'T-1', { pr_ref: 'PR-X' }),
    rawEvent('pull_request_closed', 'T-1', { pr_ref: 'PR-X' }),
    rawEvent('pull_request_merged', 'T-1', { pr_ref: 'PR-X' }),
  ]);
  assert.equal(ledger.reconstruct().get('T-1').outcome.kind, 'accepted');

  ledger.appendAll([
    rawEvent('task_started', 'T-2'),
    rawEvent('pull_request_created', 'T-2', { pr_ref: 'PR-Y' }),
    rawEvent('pull_request_closed', 'T-2', { pr_ref: 'PR-Y' }),
  ]);
  const t2 = ledger.reconstruct().get('T-2');
  assert.equal(t2.outcome.kind, 'failed');
  assert.match(t2.outcome.detail, /closed without merge/);
});

test('an open PR is unresolved — never counted as success (conservative attribution)', () => {
  const ledger = new TenantLedger('t');
  ledger.appendAll([
    rawEvent('task_started', 'T-OPEN'),
    rawEvent('execution_started', 'T-OPEN', { execution_ref: 'E1' }, { execution_ref: 'E1' }),
    rawEvent('model_invocation_recorded', 'T-OPEN', { invocation_ref: 'MI-1', status: 'ok', cost: cost(1000) }, { execution_ref: 'E1' }),
    rawEvent('execution_finished', 'T-OPEN', { execution_ref: 'E1', status: 'completed' }, { execution_ref: 'E1' }),
    rawEvent('pull_request_created', 'T-OPEN', { pr_ref: 'PR-OPEN' }),
  ]);
  const task = ledger.reconstruct().get('T-OPEN');
  assert.equal(task.outcome.kind, 'unresolved');
  assert.equal(task.outcome.attribution, 'partial');
});

test('explicit terminal signals drive failed/aborted attribution', () => {
  const ledger = new TenantLedger('t');
  ledger.appendAll([
    rawEvent('task_started', 'T-1'),
    rawEvent('task_failed', 'T-1'),
  ]);
  assert.equal(ledger.reconstruct().get('T-1').outcome.kind, 'failed');

  ledger.appendAll([
    rawEvent('task_started', 'T-2'),
    rawEvent('task_aborted', 'T-2'),
  ]);
  assert.equal(ledger.reconstruct().get('T-2').outcome.kind, 'aborted');
});

test('no terminal signal means unresolved with partial attribution — never guessed', () => {
  const ledger = new TenantLedger('t');
  ledger.appendAll([
    rawEvent('task_started', 'T-1'),
    rawEvent('model_invocation_recorded', 'T-1', { invocation_ref: 'MI-1', status: 'ok', cost: cost(10) }),
  ]);
  const task = ledger.reconstruct().get('T-1');
  assert.equal(task.outcome.kind, 'unresolved');
  assert.equal(task.outcome.attribution, 'partial');
});

test('revert after merge flags the accepted outcome', () => {
  const ledger = new TenantLedger('t');
  appendAcceptedTask(ledger, 'T-R');
  ledger.appendAll([
    rawEvent('revert_detected', 'T-R', { pr_ref: 'PR-T-R' }, { time: '2026-08-02T00:00:00Z' }),
  ]);
  const task = ledger.reconstruct().get('T-R');
  assert.equal(task.outcome.kind, 'accepted');
  assert.equal(task.outcome.reverted, true);
});

test('supersession must reference a known, strictly later execution', () => {
  const unknownTarget = new TenantLedger('t');
  unknownTarget.appendAll([
    rawEvent('task_started', 'T-1'),
    rawEvent('execution_started', 'T-1', { execution_ref: 'E1' }, { execution_ref: 'E1' }),
    rawEvent('execution_finished', 'T-1', { execution_ref: 'E1', status: 'superseded', superseded_by_execution_ref: 'E-GHOST' }, { execution_ref: 'E1' }),
  ]);
  assert.throws(
    () => unknownTarget.reconstruct(),
    (err) => err instanceof BeetlejuiceCoreError && err.code === ErrorCodes.UNKNOWN_EXECUTION_REF
  );

  const backwardTarget = new TenantLedger('t');
  backwardTarget.appendAll([
    rawEvent('task_started', 'T-1'),
    rawEvent('execution_finished', 'T-1', { execution_ref: 'E-LATE', status: 'superseded', superseded_by_execution_ref: 'E-EARLY' }, { execution_ref: 'E-LATE' }),
    rawEvent('execution_started', 'T-1', { execution_ref: 'E-EARLY' }, { execution_ref: 'E-EARLY' }),
    rawEvent('execution_started', 'T-1', { execution_ref: 'E-LATE' }, { execution_ref: 'E-LATE' }),
  ]);
  assert.throws(
    () => backwardTarget.reconstruct(),
    (err) => err instanceof BeetlejuiceCoreError && err.code === ErrorCodes.BAD_SUPERSESSION
  );
});

test('duplicate component refs inside one task are rejected', () => {
  const ledger = new TenantLedger('t');
  ledger.appendAll([
    rawEvent('task_started', 'T-1'),
    rawEvent('model_invocation_recorded', 'T-1', { invocation_ref: 'MI-DUP', status: 'ok', cost: cost(1) }),
    rawEvent('model_invocation_recorded', 'T-1', { invocation_ref: 'MI-DUP', status: 'ok', cost: cost(1) }),
  ]);
  assert.throws(
    () => ledger.reconstruct(),
    (err) => err instanceof BeetlejuiceCoreError && err.code === ErrorCodes.DUPLICATE_COMPONENT_REF
  );
});

test('components referencing unannounced executions remain visible at task level', () => {
  const ledger = new TenantLedger('t');
  ledger.appendAll([
    rawEvent('task_started', 'T-1'),
    rawEvent('tool_invocation_recorded', 'T-1', { tool_ref: 'TL-ORPHAN', status: 'ok', cost: cost(7) }, { execution_ref: 'EX-GHOST' }),
  ]);
  const task = ledger.reconstruct().get('T-1');
  const totalTools = task.unassignedComponents.toolInvocations.reduce((a, c) => a + c.cost.micro_usd, 0);
  assert.equal(totalTools, 7);
});

test('reconstruction does not depend on adapter batching order', () => {
  const events = [
    rawEvent('pull_request_merged', 'T-Z', { pr_ref: 'PR-1' }, { time: '2026-08-01T00:05:00Z' }),
    rawEvent('task_started', 'T-Z', {}, { time: '2026-08-01T00:01:00Z' }),
    rawEvent('pull_request_created', 'T-Z', { pr_ref: 'PR-1' }, { time: '2026-08-01T00:03:00Z' }),
  ];
  const tasks = reconstructTasks(events);
  assert.equal(tasks.get('T-Z').outcome.kind, 'accepted');
});
