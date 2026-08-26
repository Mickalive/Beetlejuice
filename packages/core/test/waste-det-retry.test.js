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

test('blind repeats after a deterministic failure are certainly avoidable; the first failure is not', () => {
  const task = taskWithAttempts([
    { ref: 'M1', status: 'error', failureClass: 'auth_error', costMicros: 900000, key: 'A1' },
    { ref: 'M2', status: 'error', failureClass: 'auth_error', costMicros: 900000, key: 'A1' },
    { ref: 'M3', status: 'error', failureClass: 'billing_error', costMicros: 900000, key: 'A1' },
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

test('attempts after the first deterministic failure are charged even when their own class differs', () => {
  const task = taskWithAttempts([
    { ref: 'M1', status: 'error', failureClass: 'auth_error', costMicros: 500000, key: 'A2' },
    { ref: 'M2', status: 'error', failureClass: 'network_timeout', costMicros: 500000, key: 'A2' },
    { ref: 'M3', status: 'error', failureClass: 'auth_error', costMicros: 500000, key: 'A2' },
  ]);
  const { findings } = runWasteAnalysis([task], { rules: [RULE] });
  // M1 = information. M2 and M3 repeated identical inputs after a
  // deterministic failure — both provably could not succeed.
  assert.deepEqual(findings.map((f) => f.evidence_refs[0]), ['M2', 'M3']);
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
  const task = taskWithAttempts([
    { ref: 'M1', status: 'error', failureClass: 'billing_error', costMicros: 123, key: 'E1' },
    { ref: 'M2', status: 'error', failureClass: 'network_timeout', costKnown: false, key: 'E1' },
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
