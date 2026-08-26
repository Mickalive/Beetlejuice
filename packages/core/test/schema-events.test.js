import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VERSIONS,
  normalizeEvent,
  EVENT_TYPES,
  TenantLedger,
  BeetlejuiceCoreError,
  ErrorCodes,
} from '../src/index.js';
import { rawEvent } from './helpers.js';

test('every normalized event carries the four version stamps', () => {
  const event = normalizeEvent(rawEvent('task_started', 'T-1', {}), { seq: 1, eventId: 'evt-000001' });
  assert.equal(event.schema_version, VERSIONS.eventSchemaVersion);
  assert.equal(event.event_version, '1');
  assert.equal(event.collector_version, VERSIONS.collectorVersion);
  assert.equal(event.normalization_version, VERSIONS.normalizationVersion);
});

test('stored events are frozen and payload is deep-copied from adapter input', () => {
  const payload = { invocation_ref: 'MI-1', status: 'ok', cost: { known: true, micro_usd: 5 } };
  const raw = rawEvent('model_invocation_recorded', 'T-1', payload);
  const ledger = new TenantLedger('t');
  const stored = ledger.append(raw);
  assert.ok(Object.isFrozen(stored));
  assert.ok(Object.isFrozen(stored.payload));
  // Mutating the adapter's original object must not affect stored evidence.
  payload.cost.micro_usd = 999999;
  assert.equal(stored.payload.cost.micro_usd, 5);
});

test('unknown event types are rejected — the domain is never a provider run type', () => {
  assert.throws(
    () => normalizeEvent(rawEvent('github_action_run', 'T-1', {}), { seq: 1 }),
    (err) => err instanceof BeetlejuiceCoreError && err.code === ErrorCodes.UNKNOWN_EVENT_TYPE
  );
});

test('missing required fields are rejected per event type', () => {
  assert.throws(
    () =>
      normalizeEvent(
        rawEvent('ci_run_recorded', 'T-1', { status: 'passed' }), // no ci_ref, no cost
        { seq: 1 }
      ),
    (err) => err instanceof BeetlejuiceCoreError && err.code === ErrorCodes.MISSING_FIELD
  );
  assert.throws(
    () =>
      normalizeEvent(
        rawEvent('execution_finished', 'T-1', { execution_ref: 'E1', status: 'superseded' }), // missing target
        { seq: 1 }
      ),
    (err) => err instanceof BeetlejuiceCoreError && err.code === ErrorCodes.MISSING_FIELD
  );
});

test('failed model invocations require a failure classification', () => {
  assert.throws(
    () =>
      normalizeEvent(
        rawEvent('model_invocation_recorded', 'T-1', {
          invocation_ref: 'MI-1',
          status: 'error',
          cost: { known: true, micro_usd: 1 },
        }),
        { seq: 1 }
      ),
    (err) => err instanceof BeetlejuiceCoreError && err.code === ErrorCodes.MISSING_FIELD
  );
});

test('cost objects must be exactly measured or honestly unknown', () => {
  assert.throws(
    () =>
      normalizeEvent(
        rawEvent('tool_invocation_recorded', 'T-1', {
          tool_ref: 'TL-1',
          status: 'ok',
          cost: { known: false, guessed_micro_usd: 42 },
        }),
        { seq: 1 }
      ),
    (err) => err instanceof BeetlejuiceCoreError && err.code === ErrorCodes.BAD_FIELD_TYPE
  );
  assert.throws(
    () =>
      normalizeEvent(
        rawEvent('tool_invocation_recorded', 'T-1', {
          tool_ref: 'TL-1',
          status: 'ok',
          cost: { known: true, micro_usd: -5 },
        }),
        { seq: 1 }
      ),
      (err) => err instanceof BeetlejuiceCoreError && err.code === ErrorCodes.BAD_FIELD_TYPE
  );
  const okUnknown = normalizeEvent(
    rawEvent('tool_invocation_recorded', 'T-1', {
      tool_ref: 'TL-1',
      status: 'ok',
      cost: { known: false, reason: 'not observable' },
    }),
    { seq: 1 }
  );
  assert.deepEqual(okUnknown.payload.cost, { known: false, reason: 'not observable' });
});

test('forbidden payload and top-level fields are rejected', () => {
  const badPayload = rawEvent('task_started', 'T-1', {});
  badPayload.payload.repository = 'acme/x'; // GitHub concept outside source metadata
  assert.throws(
    () => normalizeEvent(badPayload, { seq: 1 }),
    (err) => err instanceof BeetlejuiceCoreError && err.code === ErrorCodes.FORBIDDEN_FIELD
  );
  const badTop = rawEvent('task_started', 'T-1', {});
  badTop.repository_id = '42';
  assert.throws(
    () => normalizeEvent(badTop, { seq: 1 }),
    (err) => err instanceof BeetlejuiceCoreError && err.code === ErrorCodes.FORBIDDEN_FIELD
  );
});

test('adapter metadata may carry platform specifics without becoming domain keys', () => {
  const raw = rawEvent('pull_request_created', 'T-1', { pr_ref: 'PR-9' }, {
    source: {
      adapter: 'github',
      ref: 'fixture://pr/9',
      meta: { repository: 'acme/private-project', pull_number: 9 },
    },
  });
  const event = normalizeEvent(raw, { seq: 3, eventId: 'evt-000003' });
  assert.equal(event.source.adapter, 'github');
  assert.equal(event.source.meta.pull_number, 9);
  // Domain keys stay vendor-neutral:
  assert.equal(event.payload.pr_ref, 'PR-9');
  assert.ok(!('repository' in event.payload));
});

test('ledger assigns monotonic seq and stable auto event ids; rejects duplicate explicit ids', () => {
  const ledger = new TenantLedger('t');
  const e1 = ledger.append(rawEvent('task_started', 'T-1', {}));
  const e2 = ledger.append(rawEvent('task_failed', 'T-1', {}));
  assert.equal(e1.seq, 1);
  assert.equal(e2.seq, 2);
  assert.equal(e1.event_id, 'evt-000001');
  assert.equal(e2.event_id, 'evt-000002');

  ledger.append(rawEvent('task_started', 'T-2', {}, { event_id: 'adapter-42' }));
  assert.throws(
    () => ledger.append(rawEvent('task_started', 'T-3', {}, { event_id: 'adapter-42' })),
    (err) => err instanceof BeetlejuiceCoreError && err.code === ErrorCodes.DUPLICATE_EVENT_ID
  );
});

test('canonical type list contains the MASTER_PROMPT §8 lifecycle vocabulary', () => {
  for (const t of [
    'task_started',
    'task_aborted',
    'task_failed',
    'pull_request_created',
    'pull_request_closed',
    'pull_request_merged',
    'revert_detected',
    'human_rework_recorded',
    'retry_recorded',
  ]) {
    assert.ok(Object.values(EVENT_TYPES).includes(t), `missing canonical type ${t}`);
  }
});
