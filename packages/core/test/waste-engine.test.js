import test from 'node:test';
import assert from 'node:assert/strict';
import { reconstructTasks, runWasteAnalysis, DEFAULT_WASTE_RULES } from '../src/index.js';
import { rawEvent, cost } from './helpers.js';

test('overlapping rules never double count — claimed evidence is stripped from later candidates', () => {
  // EX-A is superseded by EX-B AND contains a duplicated CI pair.
  const events = [
    rawEvent('task_started', 'T-OV'),
    rawEvent('execution_started', 'T-OV', { execution_ref: 'EX-A' }, { execution_ref: 'EX-A' }),
    rawEvent('model_invocation_recorded', 'T-OV', { invocation_ref: 'M-1', status: 'ok', cost: cost(500000) }, { execution_ref: 'EX-A' }),
    rawEvent('ci_run_recorded', 'T-OV', {
      ci_ref: 'C-1',
      status: 'passed',
      cost: cost(300000),
      equivalence_key: 'K::std',
      revision_key: 'rev-x',
      started_at: '2026-08-01T00:00:00Z',
      finished_at: '2026-08-01T00:05:00Z',
    }, { execution_ref: 'EX-A' }),
    rawEvent('ci_run_recorded', 'T-OV', {
      ci_ref: 'C-2',
      status: 'passed',
      cost: cost(400000),
      equivalence_key: 'K::std',
      revision_key: 'rev-x',
      started_at: '2026-08-01T00:10:00Z',
      finished_at: '2026-08-01T00:15:00Z',
    }, { execution_ref: 'EX-A' }),
    rawEvent('execution_finished', 'T-OV', { execution_ref: 'EX-A', status: 'superseded', superseded_by_execution_ref: 'EX-B' }, { execution_ref: 'EX-A' }),
    rawEvent('execution_started', 'T-OV', { execution_ref: 'EX-B' }, { execution_ref: 'EX-B' }),
  ];
  const task = [...reconstructTasks(events).values()][0];

  const { findings, certainlyAvoidableMicroUsd, claimedEvidenceRefs } = runWasteAnalysis(task ? [task] : [], { rules: DEFAULT_WASTE_RULES });

  // DUP_CI claims C-2 first; the superseded rule keeps only its remaining units.
  const dup = findings.find((f) => f.rule_id === 'WASTE_DUP_CI_V1');
  const sup = findings.find((f) => f.rule_id === 'WASTE_EXEC_SUPERSEDED_V1');
  assert.ok(dup && sup);
  assert.deepEqual(dup.evidence_refs, ['C-2']);
  assert.equal(dup.wasted_micro_usd, 400000);
  assert.deepEqual([...sup.evidence_refs].sort(), ['C-1', 'M-1']);
  assert.equal(sup.wasted_micro_usd, 800000);

  // No unit is counted twice anywhere.
  const allUnits = findings.flatMap((f) => f.evidence_refs);
  assert.equal(new Set(allUnits).size, allUnits.length);
  assert.deepEqual(claimedEvidenceRefs, ['C-1', 'C-2', 'M-1']);
  assert.equal(certainlyAvoidableMicroUsd, 1200000);
  assert.equal(
    certainlyAvoidableMicroUsd,
    findings.reduce((a, f) => a + f.wasted_micro_usd, 0)
  );
});

// Repair A2 regression (audit E9): the product consumer requires per-unit
// evidence_units on every finding; core now serializes them by construction.
test('every finding serializes evidence_units with ref/kind/micro_usd/quantified (A2 seam contract)', () => {
  const events = [
    rawEvent('task_started', 'T-U'),
    rawEvent('model_invocation_recorded', 'T-U', { invocation_ref: 'MI-Q', status: 'ok', cost: cost(250000) }),
    rawEvent('ci_run_recorded', 'T-U', {
      ci_ref: 'CI-Q1',
      status: 'passed',
      cost: cost(100000),
      equivalence_key: 'q::std',
      started_at: '2026-08-01T00:00:00Z',
      finished_at: '2026-08-01T00:02:00Z',
    }),
    rawEvent('ci_run_recorded', 'T-U', {
      ci_ref: 'CI-Q2',
      // X1 repair note: this repeat must be `passed` — a non-passed post-pass
      // repeat disproves determinism and the dup-CI rule now abstains for the
      // partition, leaving no finding to exercise this contract with.
      status: 'passed',
      cost: cost(150000),
      equivalence_key: 'q::std',
      started_at: '2026-08-01T00:05:00Z',
      finished_at: '2026-08-01T00:07:00Z',
    }),
  ];
  const task = [...reconstructTasks(events).values()][0];
  const { findings } = runWasteAnalysis([task]);
  assert.ok(findings.length >= 1);
  for (const finding of findings) {
    assert.ok(Array.isArray(finding.evidence_units), 'evidence_units array is required');
    assert.equal(finding.evidence_units.length, finding.evidence_refs.length);
    let unitSum = 0;
    for (const unit of finding.evidence_units) {
      assert.equal(typeof unit.ref, 'string');
      assert.equal(typeof unit.kind, 'string');
      assert.ok(Number.isInteger(unit.micro_usd) && unit.micro_usd >= 0);
      assert.equal(typeof unit.quantified, 'boolean');
      if (!unit.quantified) {
        assert.equal(unit.micro_usd, 0);
        assert.ok(finding.unquantified_evidence_refs.includes(unit.ref));
      }
      unitSum += unit.micro_usd;
    }
    assert.equal(unitSum, finding.wasted_micro_usd, 'units must sum exactly to the finding amount');
  }
});

test('analysis is deterministic: identical input yields identical finding ids and order', () => {
  const events = [
    rawEvent('task_started', 'T-D'),
    rawEvent('execution_started', 'T-D', { execution_ref: 'E' }, { execution_ref: 'E' }),
    rawEvent('model_invocation_recorded', 'T-D', { invocation_ref: 'X1', status: 'error', cost: cost(100), failure_class: 'auth_error', attempt_equivalence_key: 'k' }, { execution_ref: 'E' }),
    rawEvent('model_invocation_recorded', 'T-D', { invocation_ref: 'X2', status: 'error', cost: cost(100), failure_class: 'auth_error', attempt_equivalence_key: 'k' }, { execution_ref: 'E' }),
  ];
  const t1 = [...reconstructTasks(events).values()][0];
  const t2 = [...reconstructTasks(events).values()][0];
  const r1 = runWasteAnalysis([t1]);
  const r2 = runWasteAnalysis([t2]);
  assert.deepEqual(r1.findings, r2.findings);
  assert.deepEqual(r1.claimedEvidenceRefs, r2.claimedEvidenceRefs);
});

test('waste analysis results are frozen — consumers cannot tamper with findings', () => {
  const events = [
    rawEvent('task_started', 'T-Z'),
    rawEvent('model_invocation_recorded', 'T-Z', { invocation_ref: 'Z1', status: 'error', cost: cost(100), failure_class: 'auth_error', attempt_equivalence_key: 'k' }),
    rawEvent('model_invocation_recorded', 'T-Z', { invocation_ref: 'Z2', status: 'error', cost: cost(100), failure_class: 'auth_error', attempt_equivalence_key: 'k' }),
  ];
  const task = [...reconstructTasks(events).values()][0];
  const result = runWasteAnalysis([task]);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.findings[0]));
  assert.throws(() => {
    result.certainlyAvoidableMicroUsd = 999999;
  }, TypeError);
});

test('custom rule sets are supported without touching the default registry', () => {
  const task = [...reconstructTasks([rawEvent('task_started', 'T-C')]).values()][0];
  const onlyDup = { id: 'TEST_ONLY', version: 1, detect: () => [] };
  const result = runWasteAnalysis([task], { rules: [onlyDup] });
  assert.deepEqual(result.findings, []);
  assert.equal(result.certainlyAvoidableMicroUsd, 0);
});
