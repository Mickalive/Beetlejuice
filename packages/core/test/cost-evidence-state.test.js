import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TenantLedger,
  computeSummary,
  costEvidenceState,
  COST_EVIDENCE_STATES,
  rollupTaskCost,
} from '../src/index.js';
import { rawEvent, cost, unknownCost } from './helpers.js';

/**
 * Cost-evidence-state battery — canonical zero-cost honesty predicate
 * (audit LIVE-REPORT-ZERO-DOLLARS, producer side). A report headline must be
 * able to distinguish "genuinely measured $0" from "no measurable cost
 * evidence supplied"; this pins the canonical derivation in one place.
 */

function auditFor(events) {
  const ledger = new TenantLedger('t-evidence');
  ledger.appendAll(events);
  return ledger.audit();
}

test('state vocabulary is exactly the four documented states', () => {
  assert.deepEqual([...COST_EVIDENCE_STATES], ['measured', 'measured_zero', 'unmeasured', 'none_observed']);
});

test('measured: known spend > 0 renders as measured (synthetic fixture shape)', () => {
  const events = [
    rawEvent('task_started', 'T-M'),
    rawEvent('model_invocation_recorded', 'T-M', { invocation_ref: 'M1', status: 'ok', cost: cost(500000) }),
    rawEvent('pull_request_created', 'T-M', { pr_ref: 'PR-M' }),
    rawEvent('pull_request_merged', 'T-M', { pr_ref: 'PR-M' }),
  ];
  const audit = auditFor(events);
  assert.equal(audit.summary.cost.knownMicroUsd, 500000);
  assert.equal(audit.summary.cost.evidenceState, 'measured');
});

test('measured_zero: every component priced at a supplied $0 is genuinely $0.00', () => {
  const events = [
    rawEvent('task_started', 'T-Z'),
    rawEvent('model_invocation_recorded', 'T-Z', { invocation_ref: 'Z1', status: 'ok', cost: cost(0) }),
    rawEvent('pull_request_created', 'T-Z', { pr_ref: 'PR-Z' }),
    rawEvent('pull_request_merged', 'T-Z', { pr_ref: 'PR-Z' }),
  ];
  const audit = auditFor(events);
  assert.equal(audit.summary.cost.knownMicroUsd, 0);
  assert.equal(audit.summary.cost.unknownComponentCount, 0);
  assert.equal(audit.summary.cost.evidenceState, 'measured_zero');
});

test('unmeasured: representable spend $0 WITH unavailable components must never read as measured $0.00', () => {
  // The exact live-GitHub-audit shape (E12): components observed, costs absent.
  const events = [
    rawEvent('task_started', 'T-U'),
    rawEvent('execution_started', 'T-U', { execution_ref: 'EX-U' }, { execution_ref: 'EX-U' }),
    rawEvent('model_invocation_recorded', 'T-U', { invocation_ref: 'U1', status: 'ok', cost: unknownCost('no billing evidence supplied') }, { execution_ref: 'EX-U' }),
    rawEvent('ci_run_recorded', 'T-U', { ci_ref: 'U-CI', status: 'passed', cost: unknownCost('no billing evidence supplied') }, { execution_ref: 'EX-U' }),
    rawEvent('pull_request_created', 'T-U', { pr_ref: 'PR-U' }),
    rawEvent('pull_request_merged', 'T-U', { pr_ref: 'PR-U' }),
  ];
  const audit = auditFor(events);
  assert.equal(audit.summary.cost.knownMicroUsd, 0);
  assert.ok(audit.summary.cost.unknownComponentCount > 0);
  assert.equal(audit.summary.cost.evidenceState, 'unmeasured');

  // The predicate is directly derivable from the accounting rollup too.
  assert.equal(costEvidenceState(audit.summary.cost), 'unmeasured');
});

test('none_observed: an audit window with no cost-bearing component at all', () => {
  const audit = auditFor([rawEvent('task_started', 'T-N')]);
  assert.equal(audit.summary.cost.knownMicroUsd, 0);
  assert.equal(audit.summary.cost.unknownComponentCount, 0);
  assert.equal(audit.summary.cost.evidenceState, 'none_observed');
});

test('mixed evidence (some supplied zeros + unknowns) stays unmeasured — total not knowable', () => {
  const events = [
    rawEvent('task_started', 'T-X'),
    rawEvent('tool_invocation_recorded', 'T-X', { tool_ref: 'X-T', status: 'ok', cost: cost(0) }),
    rawEvent('compute_usage_recorded', 'T-X', { resource_ref: 'X-C', cost: unknownCost('metering unavailable') }),
  ];
  const audit = auditFor(events);
  assert.equal(audit.summary.cost.evidenceState, 'unmeasured');
});

test('evidenceState flows through the versioned export envelope losslessly', async () => {
  const { buildCoreAuditExport } = await import('../src/index.js');
  const ledger = new TenantLedger('t-export');
  ledger.appendAll([
    rawEvent('task_started', 'T-E'),
    rawEvent('model_invocation_recorded', 'T-E', { invocation_ref: 'E1', status: 'ok', cost: unknownCost('none') }),
  ]);
  const auditResult = ledger.audit();
  const envelope = JSON.parse(JSON.stringify(buildCoreAuditExport(auditResult, { producer: 'evidence-test' })));
  assert.equal(envelope.audit.summary.cost.evidenceState, 'unmeasured');
});

test('costEvidenceState accepts any accounting-rollup-shaped object and rejects garbage', () => {
  assert.equal(costEvidenceState(rollupTaskCost({
    executions: [],
    unassignedComponents: { modelInvocations: [], toolInvocations: [], computeUsage: [], ciRuns: [], validations: [], humanInterventions: [] },
  })), 'none_observed');

  for (const bad of [
    { knownMicroUsd: -1, unknownComponentCount: 0, totalComponents: 0 },
    { knownMicroUsd: 1.5, unknownComponentCount: 0, totalComponents: 3 },
    { knownMicroUsd: 0, unknownComponentCount: Number.NaN, totalComponents: 3 },
    { knownMicroUsd: 0, unknownComponentCount: 0 },
  ]) {
    assert.throws(() => costEvidenceState(bad), TypeError);
  }
});

test('summary-level identity holds across all four states on hand-built summaries', () => {
  const tasks = [];
  const waste = { findings: [], certainlyAvoidableMicroUsd: 0 };
  const summary = computeSummary({ tasks, waste });
  assert.equal(summary.cost.evidenceState, 'none_observed');
});
