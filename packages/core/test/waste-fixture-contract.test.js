import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runWasteAnalysis, reconstructTasks } from '../src/index.js';
import { buildSyntheticEvents } from '../fixtures/synthetic/generate.js';

const expected = JSON.parse(readFileSync(new URL('../fixtures/synthetic/expected.json', import.meta.url), 'utf8'));

function analyzeFixture() {
  const tasks = [...reconstructTasks(buildSyntheticEvents()).values()].sort((a, b) => (a.taskRef < b.taskRef ? -1 : 1));
  return { tasks, analysis: runWasteAnalysis(tasks) };
}

test('fixture positive controls produce exactly the expected certain findings', () => {
  const { analysis } = analyzeFixture();
  assert.deepEqual(
    analysis.findings.map((f) => f.finding_id),
    expected.waste.expectedFindingIds
  );
  assert.equal(analysis.certainlyAvoidableMicroUsd, expected.waste.certainlyAvoidableMicroUsd);
});

test('every finding matches the hand-verified per-finding evidence contract', () => {
  const { analysis } = analyzeFixture();
  const byId = new Map(analysis.findings.map((f) => [f.finding_id, f]));
  for (const exp of expected.waste.expectedFindings) {
    const finding = byId.get(exp.finding_id);
    assert.ok(finding, `missing expected finding ${exp.finding_id}`);
    assert.equal(finding.rule_id, exp.rule_id);
    assert.equal(finding.task_ref, exp.task_ref);
    assert.equal(finding.confidence, exp.confidence);
    assert.equal(finding.wasted_micro_usd, exp.wasted_micro_usd);
    assert.deepEqual(finding.evidence_refs, exp.evidence_refs);
    assert.deepEqual(finding.evidence_units, exp.evidence_units);
    assert.deepEqual(finding.unquantified_evidence_refs, exp.unquantified_evidence_refs);
  }
});

test('every finding is fully explainable and carries tenant-scope evidence only', () => {
  const { analysis } = analyzeFixture();
  for (const f of analysis.findings) {
    assert.equal(f.confidence, 'certain');
    assert.ok(f.wasted_micro_usd > 0);
    assert.ok(f.evidence_refs.length > 0);
    for (const ref of f.evidence_refs) {
      // Evidence refs are component refs scoped inside the tenant's own task.
      assert.match(ref, /^(MI|TI|CI|CU|VA|HI)-/, `unexpected evidence ref ${ref}`);
    }
    assert.ok(f.explanation.length > 40, 'explanation must be substantive');
    assert.match(f.explanation, /avoidable/);
    assert.ok(f.recommendation.length > 10);
    assert.equal(f.rule_version, 1);
  }
});

test('no finding is emitted for ambiguous or clean tasks', () => {
  const { analysis } = analyzeFixture();
  const flaggedTasks = new Set(analysis.findings.map((f) => f.task_ref));
  // Negative controls: transient retry (T4), new-revision CI rerun + transient retry (T8),
  // clean success (T1), revert-only (T10).
  for (const clean of ['TASK-001', 'TASK-004', 'TASK-008', 'TASK-010']) {
    assert.ok(!flaggedTasks.has(clean), `${clean} must not be flagged`);
  }
});
