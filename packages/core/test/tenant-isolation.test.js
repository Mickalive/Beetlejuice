import test from 'node:test';
import assert from 'node:assert/strict';
import { TenantLedger, BeetlejuiceCoreError, ErrorCodes } from '../src/index.js';
import { rawEvent, cost, appendAcceptedTask } from './helpers.js';

test('two tenant ledgers are isolated by construction — no shared state, no global ids', () => {
  const ledgerA = new TenantLedger('tenant-a');
  const ledgerB = new TenantLedger('tenant-b');

  // Both tenants use the SAME local task ref; analytics must never cross.
  appendAcceptedTask(ledgerA, 'TASK-SHARED-REF');
  ledgerB.appendAll([
    rawEvent('task_started', 'TASK-SHARED-REF'),
    rawEvent('model_invocation_recorded', 'TASK-SHARED-REF', { invocation_ref: 'MI-B-1', status: 'ok', cost: cost(555) }),
  ]);

  const auditA = ledgerA.audit();
  const auditB = ledgerB.audit();

  assert.equal(auditA.tasks.length, 1);
  assert.equal(auditB.tasks.length, 1);
  assert.equal(auditA.summary.cost.knownMicroUsd, 1400000);
  assert.equal(auditB.summary.cost.knownMicroUsd, 555);
  assert.notEqual(auditA.summary.cost.knownMicroUsd, auditB.summary.cost.knownMicroUsd);

  // The core stores only the caller-supplied opaque scope handle and derives
  // no global identity from it.
  assert.equal(ledgerA.tenantKey, 'tenant-a');
  assert.equal(ledgerB.tenantKey, 'tenant-b');
});

test('stored evidence is frozen: returned events cannot be tampered with', () => {
  const ledger = new TenantLedger('t');
  const stored = ledger.append(rawEvent('task_started', 'T-1', {}));
  assert.ok(Object.isFrozen(stored));
  assert.ok(Object.isFrozen(stored.payload));
  assert.throws(() => {
    stored.task_ref = 'T-EVIL';
  }, TypeError);
});

// Repair R5 regression (audit D5): events() used to return the LIVE internal
// array — a caller could push phantom events and corrupt the next audit.
test('events() returns a frozen snapshot; mutating it cannot corrupt audits', () => {
  const ledger = new TenantLedger('t');
  appendAcceptedTask(ledger, 'T-F');
  assert.equal(ledger.size, 7);

  const view = ledger.events();
  assert.ok(Object.isFrozen(view), 'events() snapshot must be frozen');
  assert.equal(view.length, 7);

  let mutationFailed = false;
  try {
    view.push({ bogus: true });
  } catch {
    mutationFailed = true; // frozen arrays throw in strict mode
  }
  if (!mutationFailed) {
    // Non-strict fallback would silently no-op on frozen arrays.
    assert.equal(view.length, 7, 'push on a frozen snapshot must not grow it');
  }
  assert.equal(ledger.size, 7, 'ledger internals are untouched');

  // Even if a caller keeps a stale snapshot reference, later appends and
  // audits operate only on internal state.
  ledger.append(rawEvent('task_started', 'T-G', {}));
  assert.equal(ledger.events().length, 8);
  const audit = ledger.audit();
  assert.equal(audit.tasks.length, 2);
  for (const task of audit.tasks) {
    assert.ok(typeof task.taskRef === 'string' && task.taskRef.length > 0, 'no phantom task refs');
  }
});

test('reconstructed aggregates are frozen too', () => {
  const ledger = new TenantLedger('t');
  appendAcceptedTask(ledger, 'T-F');
  const task = ledger.reconstruct().get('T-F');
  assert.ok(Object.isFrozen(task));
  assert.ok(Object.isFrozen(task.outcome));
  assert.throws(() => {
    task.outcome.kind = 'accepted'; // even when it already is
  }, TypeError);
});

test('interleaved appends across tenants keep independent monotonic sequences', () => {
  const a = new TenantLedger('a');
  const b = new TenantLedger('b');
  const e1 = a.append(rawEvent('task_started', 'T-1', {}));
  const f1 = b.append(rawEvent('task_started', 'T-1', {}));
  const e2 = a.append(rawEvent('task_failed', 'T-1', {}));
  assert.equal(e1.seq, 1);
  assert.equal(e2.seq, 2);
  assert.equal(f1.seq, 1); // B's sequence starts at its own 1
});

test('duplicate component refs in one ledger do not leak into another ledger’s reconstruction', () => {
  const good = new TenantLedger('good');
  appendAcceptedTask(good, 'T-G');

  const bad = new TenantLedger('bad');
  bad.appendAll([
    rawEvent('task_started', 'T-B'),
    rawEvent('model_invocation_recorded', 'T-B', { invocation_ref: 'DUP', status: 'ok', cost: cost(1) }),
    rawEvent('model_invocation_recorded', 'T-B', { invocation_ref: 'DUP', status: 'ok', cost: cost(1) }),
  ]);

  assert.throws(() => bad.reconstruct(), (err) => err instanceof BeetlejuiceCoreError && err.code === ErrorCodes.DUPLICATE_COMPONENT_REF);
  // The healthy tenant still reconstructs fine afterwards.
  assert.equal(good.reconstruct().get('T-G').outcome.kind, 'accepted');
});
