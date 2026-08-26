/** Shared helpers for core tests. */
import { TenantLedger } from '../src/index.js';

/**
 * Minimal raw-event factory mirroring what adapters submit.
 */
export function rawEvent(type, taskRef, payload = {}, extra = {}) {
  const event = {
    type,
    task_ref: taskRef,
    time: extra.time ?? '2026-08-01T00:00:00Z',
    payload,
  };
  if (extra.execution_ref !== undefined) event.execution_ref = extra.execution_ref;
  if (extra.event_id !== undefined) event.event_id = extra.event_id;
  if (extra.source !== undefined) event.source = extra.source;
  return event;
}

export const cost = (microUsd) => ({ known: true, micro_usd: microUsd });
export const unknownCost = (reason) => ({ known: false, reason });

export function makeLedger(tenantKey = 'test-tenant') {
  return new TenantLedger(tenantKey);
}

/**
 * Build a small accepted task with one execution, one model invocation,
 * one CI run and a merged PR.
 */
export function appendAcceptedTask(ledger, taskRef, { modelCost = 1000000, ciCost = 400000 } = {}) {
  ledger.appendAll([
    rawEvent('task_started', taskRef),
    rawEvent('execution_started', taskRef, { execution_ref: `EX-${taskRef}-A`, revision_key: `rev-${taskRef}` }, { execution_ref: `EX-${taskRef}-A` }),
    rawEvent('model_invocation_recorded', taskRef, { invocation_ref: `MI-${taskRef}-1`, status: 'ok', cost: cost(modelCost) }, { execution_ref: `EX-${taskRef}-A` }),
    rawEvent(
      'ci_run_recorded',
      taskRef,
      {
        ci_ref: `CI-${taskRef}-1`,
        status: 'passed',
        cost: cost(ciCost),
        equivalence_key: `rev-${taskRef}::std`,
        revision_key: `rev-${taskRef}`,
        started_at: '2026-08-01T00:10:00Z',
        finished_at: '2026-08-01T00:14:00Z',
      },
      { execution_ref: `EX-${taskRef}-A` }
    ),
    rawEvent('execution_finished', taskRef, { execution_ref: `EX-${taskRef}-A`, status: 'completed' }, { execution_ref: `EX-${taskRef}-A` }),
    rawEvent('pull_request_created', taskRef, { pr_ref: `PR-${taskRef}` }),
    rawEvent('pull_request_merged', taskRef, { pr_ref: `PR-${taskRef}` }),
  ]);
}
