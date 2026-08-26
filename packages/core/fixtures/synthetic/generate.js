/**
 * Deterministic synthetic dataset for WC-001/WC-004.
 *
 * Produces the complete canonical event stream for ten agentic tasks covering:
 * - accepted (merged PR), failed (closed unmerged / explicit failure),
 *   aborted, unresolved and reverted outcomes;
 * - transient retries (NOT waste — negative control);
 * - duplicated CI on identical equivalence keys (certain waste — positive);
 * - identical retries after deterministic failures (certain waste — positive);
 * - superseded executions (certain waste — positive);
 * - unknown-cost components (honest data-quality handling).
 *
 * The generator is fully scripted (no RNG): every cost, ref and timestamp is
 * fixed, so two runs produce byte-identical datasets and expected economics
 * can be asserted exactly (see test/fixtures-reproducibility.test.js).
 */

const BASE_ISO = '2026-08-01T00:00:00Z';

export function buildSyntheticEvents() {
  const baseMs = Date.parse(BASE_ISO);
  let cursor = 0;
  const at = (offsetMin = 0) => new Date(baseMs + (cursor + offsetMin) * 60000).toISOString();

  const events = [];
  const emit = (type, taskRef, payload, extra = {}) => {
    const event = {
      type,
      task_ref: taskRef,
      time: at(),
      payload,
      source: extra.source ?? { adapter: 'synthetic' },
    };
    if (extra.execution_ref !== undefined) event.execution_ref = extra.execution_ref;
    events.push(event);
    cursor += 1;
    return event;
  };

  const cost = (microUsd) => ({ known: true, micro_usd: microUsd });
  const UNKNOWN_HUMAN_COST = {
    known: false,
    reason: 'human review minutes not priceable from observed evidence',
  };

  // ---------------------------------------------------------------- TASK-001
  // Accepted: simple merged-PR success. Known cost 4,200,000 µ$ ($4.20).
  {
    const T = 'TASK-001';
    emit('task_started', T, {}, { source: { adapter: 'synthetic', ref: 'fixture://TASK-001', meta: { scenario: 'success_simple' } } });
    emit('execution_started', T, { execution_ref: 'EX-001-A', revision_key: 'rev-001a' }, { execution_ref: 'EX-001-A' });
    emit('model_invocation_recorded', T, { invocation_ref: 'MI-001-1', status: 'ok', cost: cost(2000000), model_class: 'frontier', tokens_in: 12000, tokens_out: 4000, latency_ms: 41000 }, { execution_ref: 'EX-001-A' });
    emit('model_invocation_recorded', T, { invocation_ref: 'MI-001-2', status: 'ok', cost: cost(1500000), model_class: 'frontier', tokens_in: 9000, tokens_out: 3100, latency_ms: 33000 }, { execution_ref: 'EX-001-A' });
    emit('tool_invocation_recorded', T, { tool_ref: 'TI-001-1', status: 'ok', cost: cost(100000), tool_class: 'file_edit' }, { execution_ref: 'EX-001-A' });
    emit('tool_invocation_recorded', T, { tool_ref: 'TI-001-2', status: 'ok', cost: cost(100000), tool_class: 'test_runner' }, { execution_ref: 'EX-001-A' });
    emit('tool_invocation_recorded', T, { tool_ref: 'TI-001-3', status: 'ok', cost: cost(100000), tool_class: 'linter' }, { execution_ref: 'EX-001-A' });
    emit('ci_run_recorded', T, { ci_ref: 'CI-001-1', status: 'passed', cost: cost(400000), equivalence_key: 'rev-001a::config-standard', revision_key: 'rev-001a', started_at: at(), finished_at: at(4), duration_ms: 240000 }, { execution_ref: 'EX-001-A' });
    cursor += 5;
    emit('execution_finished', T, { execution_ref: 'EX-001-A', status: 'completed' }, { execution_ref: 'EX-001-A' });
    emit('pull_request_created', T, { pr_ref: 'PR-001' }, {});
    emit('pull_request_merged', T, { pr_ref: 'PR-001' }, {});
  }

  // ---------------------------------------------------------------- TASK-002
  // Failed: agent delivered, PR closed unmerged. Cost 1,250,000 µ$ ($1.25).
  {
    const T = 'TASK-002';
    emit('task_started', T, {});
    emit('execution_started', T, { execution_ref: 'EX-002-A', revision_key: 'rev-002a' }, { execution_ref: 'EX-002-A' });
    emit('model_invocation_recorded', T, { invocation_ref: 'MI-002-1', status: 'ok', cost: cost(1000000), model_class: 'frontier' }, { execution_ref: 'EX-002-A' });
    emit('ci_run_recorded', T, { ci_ref: 'CI-002-1', status: 'failed', cost: cost(250000), equivalence_key: 'rev-002a::config-standard', revision_key: 'rev-002a', started_at: at(), finished_at: at(3), duration_ms: 180000 }, { execution_ref: 'EX-002-A' });
    cursor += 4;
    emit('execution_finished', T, { execution_ref: 'EX-002-A', status: 'completed' }, { execution_ref: 'EX-002-A' });
    emit('pull_request_created', T, { pr_ref: 'PR-002' }, {});
    emit('pull_request_closed', T, { pr_ref: 'PR-002' }, {});
  }

  // ---------------------------------------------------------------- TASK-003
  // Aborted mid-flight. Cost 800,000 µ$ ($0.80).
  {
    const T = 'TASK-003';
    emit('task_started', T, {});
    emit('execution_started', T, { execution_ref: 'EX-003-A', revision_key: 'rev-003a' }, { execution_ref: 'EX-003-A' });
    emit('model_invocation_recorded', T, { invocation_ref: 'MI-003-1', status: 'ok', cost: cost(800000), model_class: 'mid' }, { execution_ref: 'EX-003-A' });
    emit('execution_finished', T, { execution_ref: 'EX-003-A', status: 'aborted' }, { execution_ref: 'EX-003-A' });
    emit('task_aborted', T, {}, {});
  }

  // ---------------------------------------------------------------- TASK-004
  // Accepted after TRANSIENT retry (negative control: not certain waste).
  // Cost 2,700,000 µ$ ($2.70).
  {
    const T = 'TASK-004';
    emit('task_started', T, {});
    emit('execution_started', T, { execution_ref: 'EX-004-A', revision_key: 'rev-004a' }, { execution_ref: 'EX-004-A' });
    emit('model_invocation_recorded', T, { invocation_ref: 'MI-004-1', status: 'error', cost: cost(1200000), model_class: 'frontier', failure_class: 'network_timeout', attempt_equivalence_key: 'att-t4-implement' }, { execution_ref: 'EX-004-A' });
    emit('retry_recorded', T, { retry_of_ref: 'MI-004-1' }, {});
    emit('model_invocation_recorded', T, { invocation_ref: 'MI-004-2', status: 'ok', cost: cost(1200000), model_class: 'frontier', attempt_equivalence_key: 'att-t4-implement' }, { execution_ref: 'EX-004-A' });
    emit('ci_run_recorded', T, { ci_ref: 'CI-004-1', status: 'passed', cost: cost(300000), equivalence_key: 'rev-004a::config-standard', revision_key: 'rev-004a', started_at: at(), finished_at: at(3), duration_ms: 190000 }, { execution_ref: 'EX-004-A' });
    cursor += 4;
    emit('execution_finished', T, { execution_ref: 'EX-004-A', status: 'completed' }, { execution_ref: 'EX-004-A' });
    emit('pull_request_created', T, { pr_ref: 'PR-004' }, {});
    emit('pull_request_merged', T, { pr_ref: 'PR-004' }, {});
  }

  // ---------------------------------------------------------------- TASK-005
  // Accepted with DUPLICATED CI on identical equivalence key (positive control).
  // Cost 1,800,000 µ$; certain waste 400,000 µ$ (CI-005-2).
  {
    const T = 'TASK-005';
    emit('task_started', T, {});
    emit('execution_started', T, { execution_ref: 'EX-005-A', revision_key: 'rev-005a' }, { execution_ref: 'EX-005-A' });
    emit('model_invocation_recorded', T, { invocation_ref: 'MI-005-1', status: 'ok', cost: cost(1000000), model_class: 'frontier' }, { execution_ref: 'EX-005-A' });
    emit('ci_run_recorded', T, { ci_ref: 'CI-005-1', status: 'passed', cost: cost(400000), equivalence_key: 'rev-005a::config-standard', revision_key: 'rev-005a', started_at: at(), finished_at: at(4), duration_ms: 250000 }, { execution_ref: 'EX-005-A' });
    cursor += 5;
    emit('ci_run_recorded', T, { ci_ref: 'CI-005-2', status: 'passed', cost: cost(400000), equivalence_key: 'rev-005a::config-standard', revision_key: 'rev-005a', started_at: at(), finished_at: at(4), duration_ms: 260000 }, { execution_ref: 'EX-005-A' });
    cursor += 5;
    emit('execution_finished', T, { execution_ref: 'EX-005-A', status: 'completed' }, { execution_ref: 'EX-005-A' });
    emit('pull_request_created', T, { pr_ref: 'PR-005' }, {});
    emit('pull_request_merged', T, { pr_ref: 'PR-005' }, {});
  }

  // ---------------------------------------------------------------- TASK-006
  // Accepted after TWO identical retries following a DETERMINISTIC failure
  // (positive control). Known cost 3,900,000 µ$; certain waste 1,800,000 µ$
  // (MI-006-2, MI-006-3). Human credential fix has unpriceable cost.
  {
    const T = 'TASK-006';
    emit('task_started', T, {});
    emit('execution_started', T, { execution_ref: 'EX-006-A', revision_key: 'rev-006a' }, { execution_ref: 'EX-006-A' });
    emit('model_invocation_recorded', T, { invocation_ref: 'MI-006-1', status: 'error', cost: cost(900000), model_class: 'frontier', failure_class: 'auth_error', attempt_equivalence_key: 'att-t6-deploy-fix' }, { execution_ref: 'EX-006-A' });
    emit('retry_recorded', T, { retry_of_ref: 'MI-006-1' }, {});
    emit('model_invocation_recorded', T, { invocation_ref: 'MI-006-2', status: 'error', cost: cost(900000), model_class: 'frontier', failure_class: 'auth_error', attempt_equivalence_key: 'att-t6-deploy-fix' }, { execution_ref: 'EX-006-A' });
    emit('retry_recorded', T, { retry_of_ref: 'MI-006-2' }, {});
    emit('model_invocation_recorded', T, { invocation_ref: 'MI-006-3', status: 'error', cost: cost(900000), model_class: 'frontier', failure_class: 'auth_error', attempt_equivalence_key: 'att-t6-deploy-fix' }, { execution_ref: 'EX-006-A' });
    emit('human_intervention_recorded', T, { intervention_ref: 'HI-006-1', intervention_class: 'credential_fix', cost: UNKNOWN_HUMAN_COST }, { execution_ref: 'EX-006-A' });
    emit('model_invocation_recorded', T, { invocation_ref: 'MI-006-4', status: 'ok', cost: cost(900000), model_class: 'frontier', attempt_equivalence_key: 'att-t6-deploy-fix-v2' }, { execution_ref: 'EX-006-A' });
    emit('ci_run_recorded', T, { ci_ref: 'CI-006-1', status: 'passed', cost: cost(300000), equivalence_key: 'rev-006a::config-standard', revision_key: 'rev-006a', started_at: at(), finished_at: at(3), duration_ms: 170000 }, { execution_ref: 'EX-006-A' });
    cursor += 4;
    emit('execution_finished', T, { execution_ref: 'EX-006-A', status: 'completed' }, { execution_ref: 'EX-006-A' });
    emit('pull_request_created', T, { pr_ref: 'PR-006' }, {});
    emit('pull_request_merged', T, { pr_ref: 'PR-006' }, {});
  }

  // ---------------------------------------------------------------- TASK-007
  // Accepted; first execution SUPERSEDED by replacement (positive control).
  // Cost 2,750,000 µ$; certain waste 1,100,000 µ$ (MI-007-1 under EX-007-A).
  {
    const T = 'TASK-007';
    emit('task_started', T, {});
    emit('execution_started', T, { execution_ref: 'EX-007-A', revision_key: 'rev-007a' }, { execution_ref: 'EX-007-A' });
    emit('model_invocation_recorded', T, { invocation_ref: 'MI-007-1', status: 'ok', cost: cost(1100000), model_class: 'frontier' }, { execution_ref: 'EX-007-A' });
    emit('execution_finished', T, { execution_ref: 'EX-007-A', status: 'superseded', superseded_by_execution_ref: 'EX-007-B' }, { execution_ref: 'EX-007-A' });
    emit('execution_started', T, { execution_ref: 'EX-007-B', revision_key: 'rev-007b' }, { execution_ref: 'EX-007-B' });
    emit('model_invocation_recorded', T, { invocation_ref: 'MI-007-2', status: 'ok', cost: cost(1300000), model_class: 'frontier' }, { execution_ref: 'EX-007-B' });
    emit('ci_run_recorded', T, { ci_ref: 'CI-007-1', status: 'passed', cost: cost(350000), equivalence_key: 'rev-007b::config-standard', revision_key: 'rev-007b', started_at: at(), finished_at: at(3), duration_ms: 175000 }, { execution_ref: 'EX-007-B' });
    cursor += 4;
    emit('execution_finished', T, { execution_ref: 'EX-007-B', status: 'completed' }, { execution_ref: 'EX-007-B' });
    emit('pull_request_created', T, { pr_ref: 'PR-007' }, {});
    emit('pull_request_merged', T, { pr_ref: 'PR-007' }, {});
  }

  // ---------------------------------------------------------------- TASK-008
  // Accepted NEGATIVE CONTROLS bundle:
  // - transient retry twice (network_timeout) -> NOT certain waste;
  // - CI re-run AFTER a new revision (different equivalence key) -> NOT waste;
  // includes compute + validation kinds. Cost 3,060,000 µ$, waste 0.
  {
    const T = 'TASK-008';
    emit('task_started', T, {});
    emit('execution_started', T, { execution_ref: 'EX-008-A', revision_key: 'rev-008a' }, { execution_ref: 'EX-008-A' });
    emit('model_invocation_recorded', T, { invocation_ref: 'MI-008-1', status: 'ok', cost: cost(700000), model_class: 'frontier' }, { execution_ref: 'EX-008-A' });
    emit('model_invocation_recorded', T, { invocation_ref: 'MI-008-2', status: 'error', cost: cost(650000), model_class: 'frontier', failure_class: 'network_timeout', attempt_equivalence_key: 'att-t8-refactor' }, { execution_ref: 'EX-008-A' });
    emit('retry_recorded', T, { retry_of_ref: 'MI-008-2' }, {});
    emit('model_invocation_recorded', T, { invocation_ref: 'MI-008-3', status: 'ok', cost: cost(650000), model_class: 'frontier', attempt_equivalence_key: 'att-t8-refactor' }, { execution_ref: 'EX-008-A' });
    emit('compute_usage_recorded', T, { resource_ref: 'CU-008-1', cost: cost(140000), resource_class: 'sandbox_vm_minutes' }, { execution_ref: 'EX-008-A' });
    emit('validation_recorded', T, { validation_ref: 'VA-008-1', status: 'passed', cost: cost(70000), validation_class: 'typecheck' }, { execution_ref: 'EX-008-A' });
    emit('ci_run_recorded', T, { ci_ref: 'CI-008-1', status: 'failed', cost: cost(400000), equivalence_key: 'rev-008a::config-standard', revision_key: 'rev-008a', started_at: at(), finished_at: at(3), duration_ms: 160000 }, { execution_ref: 'EX-008-A' });
    cursor += 4;
    emit('ci_run_recorded', T, { ci_ref: 'CI-008-2', status: 'passed', cost: cost(450000), equivalence_key: 'rev-008b::config-standard', revision_key: 'rev-008b', started_at: at(), finished_at: at(4), duration_ms: 210000 }, { execution_ref: 'EX-008-A' });
    cursor += 5;
    emit('execution_finished', T, { execution_ref: 'EX-008-A', status: 'completed' }, { execution_ref: 'EX-008-A' });
    emit('pull_request_created', T, { pr_ref: 'PR-008' }, {});
    emit('pull_request_merged', T, { pr_ref: 'PR-008' }, {});
  }

  // ---------------------------------------------------------------- TASK-009
  // Unresolved: no terminal signal; cost stays visible, attribution partial.
  // Known cost 500,000 µ$ ($0.50) plus one unpriceable validation component.
  {
    const T = 'TASK-009';
    emit('task_started', T, {});
    emit('execution_started', T, { execution_ref: 'EX-009-A', revision_key: 'rev-009a' }, { execution_ref: 'EX-009-A' });
    emit('model_invocation_recorded', T, { invocation_ref: 'MI-009-1', status: 'ok', cost: cost(500000), model_class: 'mid' }, { execution_ref: 'EX-009-A' });
    emit('validation_recorded', T, { validation_ref: 'VA-009-1', status: 'skipped', cost: { known: false, reason: 'external audit priced outside observed evidence' }, validation_class: 'security_review' }, { execution_ref: 'EX-009-A' });
  }

  // --------------------------------------------------------------- TASK-010
  // Accepted then REVERTED shortly after merge; post-merge human rework with
  // unpriceable cost. Cost 2,000,000 µ$, certain waste 0 (revert alone is not
  // provably avoidable spend — it is an outcome quality flag, not certain waste).
  {
    const T = 'TASK-010';
    emit('task_started', T, {});
    emit('execution_started', T, { execution_ref: 'EX-010-A', revision_key: 'rev-010a' }, { execution_ref: 'EX-010-A' });
    emit('model_invocation_recorded', T, { invocation_ref: 'MI-010-1', status: 'ok', cost: cost(1600000), model_class: 'frontier' }, { execution_ref: 'EX-010-A' });
    emit('ci_run_recorded', T, { ci_ref: 'CI-010-1', status: 'passed', cost: cost(400000), equivalence_key: 'rev-010a::config-standard', revision_key: 'rev-010a', started_at: at(), finished_at: at(3), duration_ms: 180000 }, { execution_ref: 'EX-010-A' });
    cursor += 4;
    emit('execution_finished', T, { execution_ref: 'EX-010-A', status: 'completed' }, { execution_ref: 'EX-010-A' });
    emit('pull_request_created', T, { pr_ref: 'PR-010' }, {});
    emit('pull_request_merged', T, { pr_ref: 'PR-010' }, {});
    emit('human_rework_recorded', T, { rework_ref: 'HR-010-1' }, {});
    emit('revert_detected', T, { pr_ref: 'PR-010' }, {});
  }

  return events;
}

/** CLI: regenerate fixtures/synthetic/dataset.json deterministically. */
if (process.argv[1]) {
  const { fileURLToPath } = await import('node:url');
  if (fileURLToPath(import.meta.url) === process.argv[1]) {
    const { writeFileSync } = await import('node:fs');
    const outPath = new URL('./dataset.json', import.meta.url).pathname;
    writeFileSync(outPath, `${JSON.stringify(buildSyntheticEvents(), null, 2)}\n`);
    console.log(`wrote ${buildSyntheticEvents().length} events to ${outPath}`);
  }
}
