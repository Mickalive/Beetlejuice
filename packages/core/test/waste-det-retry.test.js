import test from 'node:test';
import assert from 'node:assert/strict';
import { reconstructTasks, runWasteAnalysis, RULE_DET_RETRY, DETERMINISTIC_FAILURE_CLASSES } from '../src/index.js';
import { rawEvent, cost, unknownCost } from './helpers.js';

function taskWithAttempts(attempts) {
  const events = [rawEvent('task_started', 'T-R')];
  for (const att of attempts) {
    if (att.retryOf) events.push(rawEvent('retry_recorded', 'T-R', { retry_of_ref: att.retryOf }));
    events.push(
      rawEvent('model_invocation_recorded', 'T-R', {
        invocation_ref: att.ref,
        status: att.status,
        cost: att.costKnown === false ? unknownCost(att.unknownReason ?? 'no billing evidence') : cost(att.costMicros),
        ...(att.status === 'error' ? { failure_class: att.failureClass } : {}),
        attempt_equivalence_key: att.key,
      })
    );
  }
  return [...reconstructTasks(events).values()][0];
}

const RULE = RULE_DET_RETRY;

test('same-class blind repeats after a deterministic failure are certainly avoidable; the first failure is not', () => {
  const task = taskWithAttempts([
    { ref: 'M1', status: 'error', failureClass: 'auth_error', costMicros: 900000, key: 'A1' },
    { ref: 'M2', status: 'error', failureClass: 'auth_error', costMicros: 900000, key: 'A1' },
    { ref: 'M3', status: 'error', failureClass: 'auth_error', costMicros: 900000, key: 'A1' },
  ]);
  const { findings, certainlyAvoidableMicroUsd } = runWasteAnalysis([task], { rules: [RULE] });
  assert.deepEqual(findings.map((f) => f.evidence_refs[0]), ['M2', 'M3']);
  assert.equal(certainlyAvoidableMicroUsd, 1800000);
});

// Repair R1 regression (audit D1/E11): the rule used to charge the invocation
// that SUCCEEDED — self-contradictory "certain" waste on a merged task.
test('a successful attempt is never charged as waste (R1 negative control)', () => {
  const task = taskWithAttempts([
    { ref: 'M1', status: 'error', failureClass: 'auth_error', costMicros: 400000, key: 'A1' },
    { ref: 'M2', status: 'ok', costMicros: 400000, key: 'A1' },
  ]);
  const { findings } = runWasteAnalysis([task], { rules: [RULE] });
  assert.equal(findings.length, 0, 'the attempt that succeeded must not be flagged');
});

test('a later success poisons certainty for the whole equivalence-key group (ambiguity => abstain)', () => {
  // M2 repeats a deterministic failure — but M3 then succeeds on the SAME key,
  // proving the failure was not deterministic. No defensible certain finding exists.
  const task = taskWithAttempts([
    { ref: 'M1', status: 'error', failureClass: 'permission_denied', costMicros: 900000, key: 'A1' },
    { ref: 'M2', status: 'error', failureClass: 'permission_denied', costMicros: 900000, key: 'A1' },
    { ref: 'M3', status: 'ok', costMicros: 900000, key: 'A1' },
  ]);
  const { findings } = runWasteAnalysis([task], { rules: [RULE] });
  assert.deepEqual(findings.map((f) => f.evidence_refs).flat(), []);
  assert.equal(runWasteAnalysis([task], { rules: [RULE] }).certainlyAvoidableMicroUsd, 0);
});

test('a success BEFORE the deterministic failure still disqualifies the group', () => {
  const task = taskWithAttempts([
    { ref: 'M1', status: 'ok', costMicros: 100000, key: 'A9' },
    { ref: 'M2', status: 'error', failureClass: 'invalid_request', costMicros: 100000, key: 'A9' },
    { ref: 'M3', status: 'error', failureClass: 'invalid_request', costMicros: 100000, key: 'A9' },
  ]);
  const { findings } = runWasteAnalysis([task], { rules: [RULE] });
  assert.equal(findings.length, 0);
});

// Repair EPI-1 regression (audit §5/E6-D1): a post-premise retry failing with
// a DIFFERENT failure class used to be charged anyway. Its own transient class
// is direct evidence that identical inputs do NOT reproduce identically under
// this key — the same epistemics that poisons duplicate-CI partitions (X1/G5).
test('a post-premise retry whose failure MODE disagrees poisons the whole group (EPI-1 negative control)', () => {
  const task = taskWithAttempts([
    { ref: 'M1', status: 'error', failureClass: 'auth_error', costMicros: 500000, key: 'A2' },
    { ref: 'M2', status: 'error', failureClass: 'network_timeout', costMicros: 500000, key: 'A2' },
    { ref: 'M3', status: 'error', failureClass: 'auth_error', costMicros: 500000, key: 'A2' },
  ]);
  const { findings, certainlyAvoidableMicroUsd } = runWasteAnalysis([task], { rules: [RULE] });
  // M2's transient failure disproves "identical inputs fail identically":
  // either the equivalence key is untrustworthy or the premise is wrong.
  // Under either reading no unit in this group stays certainly chargeable —
  // not even M3, which reproduced the established class.
  assert.deepEqual(findings.map((f) => f.evidence_refs).flat(), []);
  assert.equal(certainlyAvoidableMicroUsd, 0);
});

test('a second DETERMINISTIC class after the premise also poisons the group (mode disagreement)', () => {
  // Two distinct "deterministic" classes on one attempt key are mutually
  // contradictory evidence: deterministic failures reproduce identically.
  const task = taskWithAttempts([
    { ref: 'M1', status: 'error', failureClass: 'auth_error', costMicros: 900000, key: 'A1' },
    { ref: 'M2', status: 'error', failureClass: 'auth_error', costMicros: 900000, key: 'A1' },
    { ref: 'M3', status: 'error', failureClass: 'billing_error', costMicros: 900000, key: 'A1' },
  ]);
  const { findings, certainlyAvoidableMicroUsd } = runWasteAnalysis([task], { rules: [RULE] });
  assert.deepEqual(findings.map((f) => f.evidence_refs).flat(), []);
  assert.equal(certainlyAvoidableMicroUsd, 0);
});

test('transient failures BEFORE the determinism premise never poison later same-class repeats', () => {
  const task = taskWithAttempts([
    { ref: 'M1', status: 'error', failureClass: 'network_timeout', costMicros: 500000, key: 'A3' },
    { ref: 'M2', status: 'error', failureClass: 'auth_error', costMicros: 500000, key: 'A3' },
    { ref: 'M3', status: 'error', failureClass: 'auth_error', costMicros: 500000, key: 'A3' },
  ]);
  const { findings, certainlyAvoidableMicroUsd } = runWasteAnalysis([task], { rules: [RULE] });
  // The premise starts at M2 (first classified deterministic failure); M3
  // reproduced it identically and is the only blind repeat.
  assert.deepEqual(findings.map((f) => f.evidence_refs[0]), ['M3']);
  assert.equal(certainlyAvoidableMicroUsd, 500000);
});

test('a post-premise error without an observable class fails closed (ambiguity => abstain)', () => {
  const task = taskWithAttempts([
    { ref: 'M1', status: 'error', failureClass: 'invalid_request', costMicros: 400000, key: 'A4' },
    { ref: 'M2', status: 'error', failureClass: undefined, costMicros: 400000, key: 'A4' },
  ]);
  // The event schema normally forbids this shape (failed invocations require
  // failure_class); the rule still defends the boundary when reached directly.
  const { findings } = runWasteAnalysis([task], { rules: [RULE] });
  assert.equal(findings.length, 0);
});

test('transient failures never produce certain-waste findings', () => {
  const task = taskWithAttempts([
    { ref: 'M1', status: 'error', failureClass: 'network_timeout', costMicros: 500000, key: 'B1' },
    { ref: 'M2', status: 'ok', costMicros: 500000, key: 'B1' },
  ]);
  assert.equal(runWasteAnalysis([task], { rules: [RULE] }).findings.length, 0);
});

test('unclassified failures abstain — no classification, no finding', () => {
  const task = taskWithAttempts([
    { ref: 'M1', status: 'error', failureClass: 'weird_unknown', costMicros: 500000, key: 'C1' },
    { ref: 'M2', status: 'ok', costMicros: 500000, key: 'C1' },
  ]);
  assert.equal(runWasteAnalysis([task], { rules: [RULE] }).findings.length, 0);
});

test('a retry under a NEW equivalence key is a fresh attempt, not certain waste', () => {
  const task = taskWithAttempts([
    { ref: 'M1', status: 'error', failureClass: 'invalid_request', costMicros: 700000, key: 'D1' },
    { ref: 'M2', status: 'ok', costMicros: 700000, key: 'D2-changed-payload' },
  ]);
  assert.equal(runWasteAnalysis([task], { rules: [RULE] }).findings.length, 0);
});

test('unquantified retries are reported as unquantified evidence, never guessed into dollars', () => {
  // Same deterministic class throughout (EPI-1): an unknown-cost repeat that
  // still reproduces the established class stays chargeable as unquantified.
  const task = taskWithAttempts([
    { ref: 'M1', status: 'error', failureClass: 'billing_error', costMicros: 123, key: 'E1' },
    { ref: 'M2', status: 'error', failureClass: 'billing_error', costKnown: false, key: 'E1' },
  ]);
  const { findings, certainlyAvoidableMicroUsd } = runWasteAnalysis([task], { rules: [RULE] });
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].evidence_refs, ['M2']);
  assert.deepEqual(findings[0].unquantified_evidence_refs, ['M2']);
  assert.equal(certainlyAvoidableMicroUsd, 0);
  assert.equal(findings[0].wasted_micro_usd, 0);
});

test('the deterministic class list stays conservative and explicit', () => {
  assert.deepEqual([...DETERMINISTIC_FAILURE_CLASSES].sort(), [
    'auth_error',
    'billing_error',
    'invalid_request',
    'permission_denied',
  ]);
});
