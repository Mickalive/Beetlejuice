import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TenantLedger,
  reconstructTasks,
  runWasteAnalysis,
  rollupTaskCost,
  DEFAULT_WASTE_RULES,
  RULE_EXEC_AFTER_ABORT,
} from '../src/index.js';
import { rawEvent, cost, unknownCost } from './helpers.js';

/**
 * WASTE_EXEC_AFTER_ABORT_V1 battery — "agents continuing after their objective
 * disappeared" (AGENTS.md certain-waste list; WC-004 family). Every guard has
 * a dedicated negative control; every charge is backed by exact evidence.
 */

/** Aborted task with an execution BEFORE the abort and one AFTER it. */
function appendAbortScenario(ledger, taskRef, { mergeAfter = false, failAfter = false, closePrAfter = false } = {}) {
  ledger.appendAll([
    rawEvent('task_started', taskRef),
    // EX-A starts while the objective still exists.
    rawEvent('execution_started', taskRef, { execution_ref: `EX-${taskRef}-A`, revision_key: 'rev-a' }, { execution_ref: `EX-${taskRef}-A` }),
    rawEvent('model_invocation_recorded', taskRef, { invocation_ref: `MI-${taskRef}-PRE`, status: 'ok', cost: cost(100000) }, { execution_ref: `EX-${taskRef}-A` }),
    rawEvent('execution_finished', taskRef, { execution_ref: `EX-${taskRef}-A`, status: 'aborted' }, { execution_ref: `EX-${taskRef}-A` }),
    rawEvent('task_aborted', taskRef),
    // EX-B starts strictly after the objective disappeared.
    rawEvent('execution_started', taskRef, { execution_ref: `EX-${taskRef}-B` }, { execution_ref: `EX-${taskRef}-B` }),
    rawEvent('model_invocation_recorded', taskRef, { invocation_ref: `MI-${taskRef}-POST`, status: 'ok', cost: cost(300000) }, { execution_ref: `EX-${taskRef}-B` }),
    rawEvent('tool_invocation_recorded', taskRef, { tool_ref: `TI-${taskRef}-POST`, status: 'ok', cost: unknownCost('unpriced tooling') }, { execution_ref: `EX-${taskRef}-B` }),
    rawEvent('execution_finished', taskRef, { execution_ref: `EX-${taskRef}-B`, status: 'completed' }, { execution_ref: `EX-${taskRef}-B` }),
    // Downstream contradiction evidence (each poisons certainty separately).
    ...(mergeAfter
      ? [
          rawEvent('pull_request_created', taskRef, { pr_ref: `PR-${taskRef}` }),
          rawEvent('pull_request_merged', taskRef, { pr_ref: `PR-${taskRef}` }),
        ]
      : []),
    ...(closePrAfter
      ? [
          rawEvent('pull_request_created', taskRef, { pr_ref: `PR-${taskRef}` }),
          rawEvent('pull_request_closed', taskRef, { pr_ref: `PR-${taskRef}` }),
        ]
      : []),
    ...(failAfter ? [rawEvent('task_failed', taskRef)] : []),
  ]);
}

test('P1: execution started strictly after the abort is charged exactly, pre-abort work is not', () => {
  const ledger = new TenantLedger('t-abort');
  appendAbortScenario(ledger, 'T-AB');
  const task = [...reconstructTasks(ledger.events()).values()][0];

  assert.equal(task.outcome.kind, 'aborted');
  assert.ok(Number.isInteger(task.abortedSeq), 'aggregate must expose the abort position');

  const { findings } = runWasteAnalysis([task]);
  const mine = findings.filter((f) => f.rule_id === RULE_EXEC_AFTER_ABORT.id);
  assert.equal(mine.length, 1);
  const finding = mine[0];

  assert.equal(finding.confidence, 'certain');
  assert.equal(finding.task_ref, 'T-AB');
  assert.equal(finding.rule_version, 1);
  // Only the post-abort execution's components are charged.
  assert.deepEqual([...finding.evidence_refs].sort(), ['MI-T-AB-POST', 'TI-T-AB-POST']);
  assert.equal(finding.wasted_micro_usd, 300000); // known part only
  assert.deepEqual(finding.evidence_units, [
    { ref: 'MI-T-AB-POST', kind: 'inference', micro_usd: 300000, quantified: true },
    { ref: 'TI-T-AB-POST', kind: 'tools', micro_usd: 0, quantified: false },
  ]);
  assert.deepEqual(finding.unquantified_evidence_refs, ['TI-T-AB-POST']);

  // Explanation cites both refs, the abort epistemics and stays worded within
  // the evidence (no invented completion claims — WORD-1 lesson).
  assert.match(finding.explanation, /T-AB/);
  assert.match(finding.explanation, /EX-T-AB-B/);
  assert.match(finding.explanation, /AFTER that abort signal/);
  assert.match(finding.explanation, /avoidable/);
  assert.ok(!/ran to completion/i.test(finding.explanation));
  assert.ok(finding.recommendation.length > 10);

  // Pre-abort components stay uncharged by this rule (and no other rule
  // charges them here).
  assert.ok(!finding.evidence_refs.includes('MI-T-AB-PRE'));
});

test('P2: multiple post-abort executions produce deterministic per-execution findings', () => {
  const ledger = new TenantLedger('t-multi');
  ledger.appendAll([
    rawEvent('task_started', 'T-Multi'),
    rawEvent('task_aborted', 'T-Multi'),
    rawEvent('execution_started', 'T-Multi', { execution_ref: 'EX-1' }, { execution_ref: 'EX-1' }),
    rawEvent('model_invocation_recorded', 'T-Multi', { invocation_ref: 'M-A', status: 'ok', cost: cost(111000) }, { execution_ref: 'EX-1' }),
    rawEvent('execution_started', 'T-Multi', { execution_ref: 'EX-2' }, { execution_ref: 'EX-2' }),
    rawEvent('compute_usage_recorded', 'T-Multi', { resource_ref: 'CU-B', cost: cost(222000) }, { execution_ref: 'EX-2' }),
  ]);
  const task = [...reconstructTasks(ledger.events()).values()][0];
  const r1 = runWasteAnalysis([task]);
  const r2 = runWasteAnalysis([task]);

  const ids = r1.findings.map((f) => f.finding_id);
  assert.deepEqual(ids, [`${RULE_EXEC_AFTER_ABORT.id}/T-Multi/1`, `${RULE_EXEC_AFTER_ABORT.id}/T-Multi/2`]);
  assert.deepEqual(r2.findings.map((f) => f.finding_id), ids); // deterministic
  assert.equal(r1.certainlyAvoidableMicroUsd, 333000);
  assert.deepEqual(r1.findings[0].evidence_refs, ['M-A']);
  assert.deepEqual(r1.findings[1].evidence_refs, ['CU-B']);
});

test('G2 corollary: without observable event ordering (unstamped seq) the rule abstains — never guesses', () => {
  // Degenerate path: reconstruction over raw adapter events that never went
  // through a tenant ledger carries no seq positions. Ordering is therefore
  // UNOBSERVABLE, so certainty is impossible and the rule must stay silent.
  const unstamped = [
    rawEvent('task_started', 'T-NOS'),
    rawEvent('task_aborted', 'T-NOS'),
    rawEvent('execution_started', 'T-NOS', { execution_ref: 'EX-N' }, { execution_ref: 'EX-N' }),
    rawEvent('model_invocation_recorded', 'T-NOS', { invocation_ref: 'M-N', status: 'ok', cost: cost(5000) }, { execution_ref: 'EX-N' }),
  ];
  const task = [...reconstructTasks(unstamped).values()][0];
  assert.equal(task.outcome.kind, 'aborted');
  assert.equal(task.abortedSeq, null);
  assert.deepEqual(runWasteAnalysis([task], { rules: [RULE_EXEC_AFTER_ABORT] }).findings, []);
});

test('P3: end-to-end through the default registry via TenantLedger.audit()', () => {
  const ledger = new TenantLedger('t-abort-e2e');
  appendAbortScenario(ledger, 'T-E2E');
  const audit = ledger.audit(); // default rules

  const finding = audit.waste.findings.find((f) => f.rule_id === RULE_EXEC_AFTER_ABORT.id);
  assert.ok(finding, 'default rule set must include the post-abort rule');
  assert.equal(audit.summary.totals.aborted, 1);
  assert.equal(audit.summary.waste.byRuleMicroUsd[RULE_EXEC_AFTER_ABORT.id], 300000);

  // Export seam carries the finding + evidence units losslessly.
  const envelope = JSON.parse(JSON.stringify(ledger.exportCoreAudit({ producer: 'abort-e2e' })));
  const exported = envelope.audit.waste.findings.find((f) => f.rule_id === RULE_EXEC_AFTER_ABORT.id);
  assert.deepEqual(exported.evidence_units, finding.evidence_units);
});

test('P4: overlap strip — duplicated CI inside a post-abort execution is claimed once, with the sharper explanation', () => {
  const ledger = new TenantLedger('t-abort-overlap');
  ledger.appendAll([
    rawEvent('task_started', 'T-OV2'),
    rawEvent('task_aborted', 'T-OV2'),
    rawEvent('execution_started', 'T-OV2', { execution_ref: 'EX-P' }, { execution_ref: 'EX-P' }),
    rawEvent('model_invocation_recorded', 'T-OV2', { invocation_ref: 'M-P', status: 'ok', cost: cost(500000) }, { execution_ref: 'EX-P' }),
    rawEvent('ci_run_recorded', 'T-OV2', {
      ci_ref: 'C-1',
      status: 'passed',
      cost: cost(300000),
      equivalence_key: 'K::std',
      revision_key: 'rev-p',
      started_at: '2026-08-01T00:00:00Z',
      finished_at: '2026-08-01T00:05:00Z',
    }, { execution_ref: 'EX-P' }),
    rawEvent('ci_run_recorded', 'T-OV2', {
      ci_ref: 'C-2',
      status: 'passed',
      cost: cost(400000),
      equivalence_key: 'K::std',
      revision_key: 'rev-p',
      started_at: '2026-08-01T00:10:00Z',
      finished_at: '2026-08-01T00:15:00Z',
    }, { execution_ref: 'EX-P' }),
  ]);
  const task = [...reconstructTasks(ledger.events()).values()][0];
  const { findings, certainlyAvoidableMicroUsd } = runWasteAnalysis([task], { rules: DEFAULT_WASTE_RULES });

  const dup = findings.find((f) => f.rule_id === 'WASTE_DUP_CI_V1');
  const abort = findings.find((f) => f.rule_id === RULE_EXEC_AFTER_ABORT.id);
  assert.ok(dup && abort, 'both rules fire on their own share of the evidence');
  assert.deepEqual(dup.evidence_refs, ['C-2']); // sharper rule claims the re-run
  assert.deepEqual([...abort.evidence_refs].sort(), ['C-1', 'M-P']); // remainder only

  // No double counting anywhere; totals equal the exact sum.
  const allRefs = findings.flatMap((f) => f.evidence_refs);
  assert.equal(new Set(allRefs).size, allRefs.length);
  assert.equal(certainlyAvoidableMicroUsd, 1200000);
  assert.equal(certainlyAvoidableMicroUsd, findings.reduce((a, f) => a + f.wasted_micro_usd, 0));
});

test('P5: superseded post-abort execution is claimed by supersession; replacement by this rule', () => {
  const ledger = new TenantLedger('t-abort-super');
  ledger.appendAll([
    rawEvent('task_started', 'T-SUP'),
    rawEvent('task_aborted', 'T-SUP'),
    rawEvent('execution_started', 'T-SUP', { execution_ref: 'EX-S1' }, { execution_ref: 'EX-S1' }),
    rawEvent('model_invocation_recorded', 'T-SUP', { invocation_ref: 'M-S1', status: 'ok', cost: cost(700000) }, { execution_ref: 'EX-S1' }),
    rawEvent('execution_finished', 'T-SUP', { execution_ref: 'EX-S1', status: 'superseded', superseded_by_execution_ref: 'EX-S2' }, { execution_ref: 'EX-S1' }),
    rawEvent('execution_started', 'T-SUP', { execution_ref: 'EX-S2' }, { execution_ref: 'EX-S2' }),
    rawEvent('model_invocation_recorded', 'T-SUP', { invocation_ref: 'M-S2', status: 'ok', cost: cost(600000) }, { execution_ref: 'EX-S2' }),
  ]);
  const task = [...reconstructTasks(ledger.events()).values()][0];
  const { findings, certainlyAvoidableMicroUsd } = runWasteAnalysis([task], { rules: DEFAULT_WASTE_RULES });

  const sup = findings.find((f) => f.rule_id === 'WASTE_EXEC_SUPERSEDED_V1');
  const abort = findings.find((f) => f.rule_id === RULE_EXEC_AFTER_ABORT.id);
  assert.deepEqual(sup?.evidence_refs, ['M-S1'], 'supersession claims the superseded execution fully');
  assert.deepEqual(abort?.evidence_refs, ['M-S2'], 'post-abort rule charges only the unclaimed replacement');

  const allRefs = findings.flatMap((f) => f.evidence_refs);
  assert.equal(new Set(allRefs).size, allRefs.length);
  assert.equal(certainlyAvoidableMicroUsd, 1300000);
});

// ---------------------------------------------------------------------------
// Negative controls — ambiguity never becomes certain waste here.
// ---------------------------------------------------------------------------

test('N1: execution started before the abort is never charged, even if it kept running', () => {
  const ledger = new TenantLedger('t-pre');
  ledger.appendAll([
    rawEvent('task_started', 'T-PRE'),
    rawEvent('execution_started', 'T-PRE', { execution_ref: 'EX-X' }, { execution_ref: 'EX-X' }),
    rawEvent('model_invocation_recorded', 'T-PRE', { invocation_ref: 'M-X', status: 'ok', cost: cost(900000) }, { execution_ref: 'EX-X' }),
    rawEvent('task_aborted', 'T-PRE'),
  ]);
  const task = [...reconstructTasks(ledger.events()).values()][0];
  assert.equal(task.outcome.kind, 'aborted');
  assert.deepEqual(runWasteAnalysis([task]).findings, []);
});

test('N2: a later merged PR (accepted outcome) proves the objective outlived the abort — whole task abstains', () => {
  const ledger = new TenantLedger('t-merge');
  appendAbortScenario(ledger, 'T-MRG', { mergeAfter: true });
  const task = [...reconstructTasks(ledger.events()).values()][0];
  assert.equal(task.outcome.kind, 'accepted'); // attribution hierarchy outranks abort
  const { findings } = runWasteAnalysis([task], { rules: DEFAULT_WASTE_RULES });
  assert.equal(findings.find((f) => f.rule_id === RULE_EXEC_AFTER_ABORT.id), undefined);
});

test('N3: a later explicit failure signal (failed outcome) abstains the whole task', () => {
  const ledger = new TenantLedger('t-fail');
  appendAbortScenario(ledger, 'T-FAIL', { failAfter: true });
  const task = [...reconstructTasks(ledger.events()).values()][0];
  assert.equal(task.outcome.kind, 'failed');
  const { findings } = runWasteAnalysis([task], { rules: DEFAULT_WASTE_RULES });
  assert.equal(findings.find((f) => f.rule_id === RULE_EXEC_AFTER_ABORT.id), undefined);
});

test('N4: a closed-unmerged PR after the abort (failed outcome) abstains the whole task', () => {
  const ledger = new TenantLedger('t-close');
  appendAbortScenario(ledger, 'T-CLO', { closePrAfter: true });
  const task = [...reconstructTasks(ledger.events()).values()][0];
  assert.equal(task.outcome.kind, 'failed');
  const { findings } = runWasteAnalysis([task], { rules: DEFAULT_WASTE_RULES });
  assert.equal(findings.find((f) => f.rule_id === RULE_EXEC_AFTER_ABORT.id), undefined);
});

test('N5: a post-abort execution without components produces no candidate', () => {
  const ledger = new TenantLedger('t-empty');
  ledger.appendAll([
    rawEvent('task_started', 'T-EMP'),
    rawEvent('task_aborted', 'T-EMP'),
    rawEvent('execution_started', 'T-EMP', { execution_ref: 'EX-NOCOST' }, { execution_ref: 'EX-NOCOST' }),
    rawEvent('execution_finished', 'T-EMP', { execution_ref: 'EX-NOCOST', status: 'completed' }, { execution_ref: 'EX-NOCOST' }),
  ]);
  const task = [...reconstructTasks(ledger.events()).values()][0];
  assert.equal(task.outcome.kind, 'aborted');
  assert.deepEqual(runWasteAnalysis([task], { rules: [RULE_EXEC_AFTER_ABORT] }).findings, []);
});

test('N6: unassigned components are never attributed to post-abort work (no provable start)', () => {
  const ledger = new TenantLedger('t-unassigned');
  ledger.appendAll([
    rawEvent('task_started', 'T-UN'),
    rawEvent('task_aborted', 'T-UN'),
    rawEvent('model_invocation_recorded', 'T-UN', { invocation_ref: 'M-FLOAT', status: 'ok', cost: cost(123000) }),
  ]);
  const task = [...reconstructTasks(ledger.events()).values()][0];
  assert.equal(task.outcome.kind, 'aborted');
  assert.equal(task.unassignedComponents.modelInvocations.length, 1);
  assert.deepEqual(runWasteAnalysis([task], { rules: [RULE_EXEC_AFTER_ABORT] }).findings, []);
  // The money stays visible in accounting regardless of chargeability.
  const rollup = rollupTaskCost(task);
  assert.equal(rollup.knownMicroUsd, 123000);
  assert.equal(rollup.byKindMicroUsd.inference, 123000);
});

test('N7: between two abort signals is ambiguous — only starts after the LAST abort are charged', () => {
  const ledger = new TenantLedger('t-reabort');
  ledger.appendAll([
    rawEvent('task_started', 'T-RE'),
    rawEvent('task_aborted', 'T-RE'), // first abort
    rawEvent('execution_started', 'T-RE', { execution_ref: 'EX-W1' }, { execution_ref: 'EX-W1' }),
    rawEvent('model_invocation_recorded', 'T-RE', { invocation_ref: 'M-W1', status: 'ok', cost: cost(10000) }, { execution_ref: 'EX-W1' }),
    rawEvent('task_aborted', 'T-RE'), // re-abort: window before it is ambiguous
    rawEvent('execution_started', 'T-RE', { execution_ref: 'EX-W2' }, { execution_ref: 'EX-W2' }),
    rawEvent('model_invocation_recorded', 'T-RE', { invocation_ref: 'M-W2', status: 'ok', cost: cost(20000) }, { execution_ref: 'EX-W2' }),
  ]);
  const task = [...reconstructTasks(ledger.events()).values()][0];
  assert.equal(task.outcome.kind, 'aborted');
  const { findings } = runWasteAnalysis([task], { rules: [RULE_EXEC_AFTER_ABORT] });
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].evidence_refs, ['M-W2'], 'only the start after the LAST abort is provably doomed');
});

test('N8: all-unquantified units still emit an honest $0 finding with unquantified refs', () => {
  const ledger = new TenantLedger('t-unq');
  ledger.appendAll([
    rawEvent('task_started', 'T-UQ'),
    rawEvent('task_aborted', 'T-UQ'),
    rawEvent('execution_started', 'T-UQ', { execution_ref: 'EX-UQ' }, { execution_ref: 'EX-UQ' }),
    rawEvent('validation_recorded', 'T-UQ', { validation_ref: 'V-UQ', status: 'skipped', cost: unknownCost('external audit unpriced') }, { execution_ref: 'EX-UQ' }),
  ]);
  const task = [...reconstructTasks(ledger.events()).values()][0];
  const { findings } = runWasteAnalysis([task], { rules: [RULE_EXEC_AFTER_ABORT] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].wasted_micro_usd, 0);
  assert.deepEqual(findings[0].unquantified_evidence_refs, ['V-UQ']);
  assert.match(findings[0].explanation, /unquantified evidence/);
});
