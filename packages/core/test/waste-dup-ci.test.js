import test from 'node:test';
import assert from 'node:assert/strict';
import { reconstructTasks, runWasteAnalysis } from '../src/index.js';
import { rawEvent, cost } from './helpers.js';
import { RULE_DUP_CI as RULE } from '../src/waste/rules/duplicate-ci.js';

function taskWithCiRuns(runs) {
  const events = [rawEvent('task_started', 'T-CI')];
  for (const run of runs) {
    events.push(
      rawEvent(
        'ci_run_recorded',
        'T-CI',
        {
          ci_ref: run.ref,
          status: run.status,
          cost: cost(run.costMicros),
          equivalence_key: run.key,
          ...(run.revision !== undefined ? { revision_key: run.revision } : {}),
          started_at: run.startedAt,
          finished_at: run.finishedAt,
        },
        run.execution_ref ? { execution_ref: run.execution_ref } : {}
      )
    );
  }
  return [...reconstructTasks(events).values()][0];
}

test('flags a CI re-run that started after an identical-key pass finished', () => {
  const task = taskWithCiRuns([
    { ref: 'CI-1', status: 'passed', costMicros: 400000, key: 'K1', revision: 'rev-a', startedAt: '2026-08-01T00:00:00Z', finishedAt: '2026-08-01T00:05:00Z' },
    { ref: 'CI-2', status: 'passed', costMicros: 400000, key: 'K1', revision: 'rev-a', startedAt: '2026-08-01T00:10:00Z', finishedAt: '2026-08-01T00:15:00Z' },
  ]);
  const { findings } = runWasteAnalysis([task], { rules: [RULE] });
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].evidence_refs, ['CI-2']);
  assert.equal(findings[0].wasted_micro_usd, 400000);
});

// Repair R3 regression (audit D3/E13): the rule used to ignore revision_key,
// letting an adapter that keys equivalence by workflow name alone report
// different-revision runs as "certain" duplicates.
test('same equivalence key but DIFFERENT revision keys is never a duplicate (R3 negative control)', () => {
  const task = taskWithCiRuns([
    { ref: 'CI-A1', status: 'passed', costMicros: 400000, key: 'build-and-test', revision: 'rev-A', startedAt: '2026-08-01T00:00:00Z', finishedAt: '2026-08-01T00:05:00Z' },
    { ref: 'CI-B1', status: 'passed', costMicros: 420000, key: 'build-and-test', revision: 'rev-B', startedAt: '2026-08-01T00:30:00Z', finishedAt: '2026-08-01T00:36:00Z' },
  ]);
  const { findings, certainlyAvoidableMicroUsd } = runWasteAnalysis([task], { rules: [RULE] });
  assert.equal(findings.length, 0);
  assert.equal(certainlyAvoidableMicroUsd, 0);
});

test('a revisioned run is never compared against an unrevised one (conservative partitioning)', () => {
  const task = taskWithCiRuns([
    { ref: 'CI-R1', status: 'passed', costMicros: 100000, key: 'K1', revision: 'rev-a', startedAt: '2026-08-01T00:00:00Z', finishedAt: '2026-08-01T00:05:00Z' },
    { ref: 'CI-U1', status: 'passed', costMicros: 100000, key: 'K1', startedAt: '2026-08-01T00:10:00Z', finishedAt: '2026-08-01T00:12:00Z' },
  ]);
  assert.equal(runWasteAnalysis([task], { rules: [RULE] }).findings.length, 0);
});

test('two unrevised runs on the same key remain comparable when timings prove repetition', () => {
  const task = taskWithCiRuns([
    { ref: 'CI-N1', status: 'passed', costMicros: 100000, key: 'K1', startedAt: '2026-08-01T00:00:00Z', finishedAt: '2026-08-01T00:05:00Z' },
    { ref: 'CI-N2', status: 'passed', costMicros: 100000, key: 'K1', startedAt: '2026-08-01T00:06:00Z', finishedAt: '2026-08-01T00:09:00Z' },
  ]);
  const { findings } = runWasteAnalysis([task], { rules: [RULE] });
  assert.deepEqual(findings.map((f) => f.evidence_refs[0]), ['CI-N2']);
});

test('does NOT flag overlapping re-runs — the agent could not have known the result yet', () => {
  const task = taskWithCiRuns([
    { ref: 'CI-1', status: 'passed', costMicros: 400000, key: 'K1', startedAt: '2026-08-01T00:00:00Z', finishedAt: '2026-08-01T00:05:00Z' },
    { ref: 'CI-2', status: 'passed', costMicros: 400000, key: 'K1', startedAt: '2026-08-01T00:03:00Z', finishedAt: '2026-08-01T00:08:00Z' },
  ]);
  const { findings } = runWasteAnalysis([task], { rules: [RULE] });
  assert.equal(findings.length, 0);
});

test('different equivalence keys are never duplicates', () => {
  const task = taskWithCiRuns([
    { ref: 'CI-1', status: 'passed', costMicros: 400000, key: 'rev-a::std', startedAt: '2026-08-01T00:00:00Z', finishedAt: '2026-08-01T00:05:00Z' },
    { ref: 'CI-2', status: 'passed', costMicros: 450000, key: 'rev-b::std', startedAt: '2026-08-01T00:10:00Z', finishedAt: '2026-08-01T00:14:00Z' },
  ]);
  const { findings } = runWasteAnalysis([task], { rules: [RULE] });
  assert.equal(findings.length, 0);
});

test('missing timestamps or keys make the rule abstain rather than guess', () => {
  const noTimes = taskWithCiRuns([
    { ref: 'CI-1', status: 'passed', costMicros: 100000, key: 'K1' },
    { ref: 'CI-2', status: 'passed', costMicros: 100000, key: 'K1' },
  ]);
  assert.equal(runWasteAnalysis([noTimes], { rules: [RULE] }).findings.length, 0);

  const noKey = taskWithCiRuns([
    { ref: 'CI-1', status: 'passed', costMicros: 100000, key: undefined, startedAt: '2026-08-01T00:00:00Z', finishedAt: '2026-08-01T00:01:00Z' },
    { ref: 'CI-2', status: 'passed', costMicros: 100000, key: undefined, startedAt: '2026-08-01T00:02:00Z', finishedAt: '2026-08-01T00:03:00Z' },
  ]);
  assert.equal(runWasteAnalysis([noKey], { rules: [RULE] }).findings.length, 0);
});

test('every post-pass repeat on the same key is flagged exactly once each', () => {
  const task = taskWithCiRuns([
    { ref: 'CI-1', status: 'passed', costMicros: 300000, key: 'K1', startedAt: '2026-08-01T00:00:00Z', finishedAt: '2026-08-01T00:04:00Z' },
    { ref: 'CI-2', status: 'passed', costMicros: 300000, key: 'K1', startedAt: '2026-08-01T00:05:00Z', finishedAt: '2026-08-01T00:09:00Z' },
    { ref: 'CI-3', status: 'passed', costMicros: 250000, key: 'K1', startedAt: '2026-08-01T00:10:00Z', finishedAt: '2026-08-01T00:12:00Z' },
  ]);
  const { findings, certainlyAvoidableMicroUsd } = runWasteAnalysis([task], { rules: [RULE] });
  assert.deepEqual(findings.map((f) => f.evidence_refs[0]), ['CI-2', 'CI-3']);
  assert.equal(certainlyAvoidableMicroUsd, 550000);
});

// Repair X1 regression (audit E14-X1): a post-pass repeat that itself FAILED
// disproves the determinism premise — "its result could not differ" is
// empirically false when it did differ (passed -> failed). The rule used to
// charge such repeats with confidence=certain; now the whole partition abstains.
test('a post-pass repeat that FAILED is never certain waste — the partition abstains (X1 negative control)', () => {
  // Exact audit E14-X1 replica: identical key + revision, second run failed.
  const task = taskWithCiRuns([
    { ref: 'C1', status: 'passed', costMicros: 1000000, key: 'K1', revision: 'rev-a', startedAt: '2026-08-01T00:00:00Z', finishedAt: '2026-08-01T00:14:00Z' },
    { ref: 'C2', status: 'failed', costMicros: 1000000, key: 'K1', revision: 'rev-a', startedAt: '2026-08-01T00:24:00Z', finishedAt: '2026-08-01T00:38:00Z' },
  ]);
  const { findings, certainlyAvoidableMicroUsd } = runWasteAnalysis([task], { rules: [RULE] });
  assert.deepEqual(findings.map((f) => f.evidence_refs).flat(), []);
  assert.equal(certainlyAvoidableMicroUsd, 0);
});

test('cancelled and timed-out post-pass repeats also disprove determinism for their partition', () => {
  for (const poisonStatus of ['cancelled', 'timed_out']) {
    const task = taskWithCiRuns([
      { ref: `P1-${poisonStatus}`, status: 'passed', costMicros: 200000, key: 'KX', revision: 'rev-x', startedAt: '2026-08-01T00:00:00Z', finishedAt: '2026-08-01T00:04:00Z' },
      { ref: `P2-${poisonStatus}`, status: poisonStatus, costMicros: 200000, key: 'KX', revision: 'rev-x', startedAt: '2026-08-01T00:10:00Z', finishedAt: '2026-08-01T00:15:00Z' },
    ]);
    const result = runWasteAnalysis([task], { rules: [RULE] });
    assert.deepEqual(result.findings.map((f) => f.evidence_refs).flat(), [], `${poisonStatus} repeat must not be charged`);
    assert.equal(result.certainlyAvoidableMicroUsd, 0, `${poisonStatus} repeat must not produce spend`);
  }
});

test('a non-passed run BEFORE the first pass also poisons the partition (disagreement anywhere)', () => {
  // F1 ran "identical inputs" and failed before any pass existed; the later
  // passed -> passed repetition therefore rests on already-disproven
  // determinism and can never be charged as certain.
  const task = taskWithCiRuns([
    { ref: 'F1', status: 'failed', costMicros: 150000, key: 'KF', revision: 'rev-f', startedAt: '2026-08-01T00:00:00Z', finishedAt: '2026-08-01T00:03:00Z' },
    { ref: 'F2', status: 'passed', costMicros: 150000, key: 'KF', revision: 'rev-f', startedAt: '2026-08-01T00:06:00Z', finishedAt: '2026-08-01T00:10:00Z' },
    { ref: 'F3', status: 'passed', costMicros: 150000, key: 'KF', revision: 'rev-f', startedAt: '2026-08-01T00:20:00Z', finishedAt: '2026-08-01T00:25:00Z' },
  ]);
  const { findings } = runWasteAnalysis([task], { rules: [RULE] });
  assert.equal(findings.length, 0);
});

test('partition poisoning is scoped: a clean sibling equivalence-key partition still yields findings', () => {
  // K-BAD/rev-bad contains a post-pass failure -> abstains.
  // K-OK/rev-ok is all-passed with a provable post-pass rerun -> charged.
  const events = [];
  const mk = (ref, key, rev, status, startMin, finishMin, micros) =>
    rawEvent(
      'ci_run_recorded',
      'T-SCOPE',
      {
        ci_ref: ref,
        status,
        cost: cost(micros),
        equivalence_key: key,
        ...(rev !== undefined ? { revision_key: rev } : {}),
        started_at: `2026-08-01T00:${String(startMin).padStart(2, '0')}:00Z`,
        finished_at: `2026-08-01T00:${String(finishMin).padStart(2, '0')}:00Z`,
      }
    );
  events.push(rawEvent('task_started', 'T-SCOPE'));
  events.push(mk('BAD-1', 'K-BAD', 'rev-bad', 'passed', 0, 4, 100000));
  events.push(mk('BAD-2', 'K-BAD', 'rev-bad', 'failed', 10, 14, 100000));
  events.push(mk('OK-1', 'K-OK', 'rev-ok', 'passed', 20, 24, 120000));
  events.push(mk('OK-2', 'K-OK', 'rev-ok', 'passed', 30, 34, 120000));
  const task = [...reconstructTasks(events).values()][0];
  const { findings, certainlyAvoidableMicroUsd } = runWasteAnalysis([task], { rules: [RULE] });
  assert.deepEqual(findings.map((f) => f.evidence_refs[0]), ['OK-2']);
  assert.equal(certainlyAvoidableMicroUsd, 120000);
});

test('revisions isolate repetition analysis inside one task across executions too', () => {
  // Same workflow re-run per execution; only the SAME-revision re-run is waste.
  const ledgerEvents = [
    rawEvent('task_started', 'T-MR'),
    rawEvent('execution_started', 'T-MR', { execution_ref: 'E1', revision_key: 'r1' }, { execution_ref: 'E1' }),
    rawEvent('ci_run_recorded', 'T-MR', {
      ci_ref: 'C-E1',
      status: 'passed',
      cost: cost(200000),
      equivalence_key: 'suite::std',
      revision_key: 'r1',
      started_at: '2026-08-01T00:00:00Z',
      finished_at: '2026-08-01T00:04:00Z',
    }, { execution_ref: 'E1' }),
    rawEvent('ci_run_recorded', 'T-MR', {
      ci_ref: 'C-E2',
      status: 'passed',
      cost: cost(200000),
      equivalence_key: 'suite::std',
      revision_key: 'r2',
      started_at: '2026-08-01T00:20:00Z',
      finished_at: '2026-08-01T00:24:00Z',
    }, { execution_ref: 'E1' }),
  ];
  const task = [...reconstructTasks(ledgerEvents).values()][0];
  const { findings } = runWasteAnalysis([task], { rules: [RULE] });
  assert.equal(findings.length, 0);
});
