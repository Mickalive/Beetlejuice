/**
 * Actions workflow-job evidence (WC-002 build item "workflow runs/jobs/checks").
 *
 * Covers the mapper, the measured cost source with its by-construction
 * double-count guard, the canonical conformance of compute events, and the
 * collector/assembler parity of the data-minimized fetch decision.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleAudit } from '../src/map/audit.js';
import { buildNormalizedBundle } from '../src/bundle.js';
import { mapWorkflowJobs } from '../src/map/workflow-jobs.js';
import {
  UNKNOWN_COST_REASONS,
  actionsMeasuredCostSource,
  actionsJobBillableMinutes,
  actionsJobMultiplier,
  unavailableEvidenceCostSource,
} from '../src/cost-source.js';
import {
  fixtureEvidence,
  fixtureWorkflowRuns,
  fixtureUsageRecords,
  FIXTURE_RATE_USD_PER_MINUTE,
  sha,
  SCOPE_KEY,
} from './fixtures/synthetic-repo.js';

const runById = (id) => fixtureWorkflowRuns().find((r) => r.id === id);

function auditWith(costSourceOpts) {
  const evidence = fixtureEvidence();
  return assembleAudit(evidence, {
    ...(costSourceOpts ? { costSource: actionsMeasuredCostSource({ rateUsdPerMinute: FIXTURE_RATE_USD_PER_MINUTE, ...costSourceOpts }) } : {}),
  });
}

// --- billable-minute + multiplier arithmetic ---------------------------------

test('Actions billable minutes round UP per job (documented billing model)', () => {
  assert.equal(actionsJobBillableMinutes(0), 0);
  assert.equal(actionsJobBillableMinutes(1), 1);
  assert.equal(actionsJobBillableMinutes(30_000), 1); // 30s bills one minute
  assert.equal(actionsJobBillableMinutes(150_000), 3); // 2.5min -> 3
  assert.equal(actionsJobBillableMinutes(720_000), 12);
  assert.throws(() => actionsJobBillableMinutes(-5));
  assert.throws(() => actionsJobBillableMinutes(Number.NaN));
});

test('runner-label multiplier resolution is case-insensitive first-match', () => {
  const table = { 'windows-latest': 2, 'macos-14': 10 };
  assert.equal(actionsJobMultiplier(['ubuntu-latest'], table), 1);
  assert.equal(actionsJobMultiplier(['Ubuntu-Latest', 'windows-latest'], table), 2);
  assert.equal(actionsJobMultiplier(['self-hosted', 'MACOS-14'], table), 10);
  assert.equal(actionsJobMultiplier([], table), 1);
  assert.equal(actionsJobMultiplier(undefined, undefined), 1);
});

// --- measured cost source ------------------------------------------------------

test('measured job cost = ceil(minutes) x declared rate x label multiplier', () => {
  const src = actionsMeasuredCostSource({ rateUsdPerMinute: 0.008 });
  const res = src({
    kind: 'ci_workflow_job',
    runId: 9002,
    attempt: 1,
    jobId: 5201,
    labels: ['ubuntu-latest'],
    elapsedMs: 360_000,
  });
  assert.deepEqual(res, {
    known: true,
    micro_usd: 48_000,
    provenance: 'measured:actions_job_billable_minutes_x_configured_rate',
  });

  const windows = actionsMeasuredCostSource({
    rateUsdPerMinute: 0.008,
    labelMultipliers: { 'windows-latest': 2 },
  });
  assert.equal(
    windows({
      kind: 'ci_workflow_job',
      runId: 1,
      attempt: 1,
      jobId: 7,
      labels: ['Windows-Latest'],
      elapsedMs: 60_000,
    }).micro_usd,
    16_000
  );
});

test('run-level usage passthrough matches the dedicated usage source; jobs are guarded', () => {
  const src = actionsMeasuredCostSource({
    usageByAttempt: fixtureUsageRecords(),
    rateUsdPerMinute: FIXTURE_RATE_USD_PER_MINUTE,
  });
  const viaCombined = src({ kind: 'ci_workflow_run', runId: 9001, attempt: 1 });
  assert.equal(viaCombined.known, true);
  assert.equal(viaCombined.micro_usd, 120_000);

  // Guard FIRST: covered attempts never produce job money.
  const guarded = src({ kind: 'ci_workflow_job', runId: 9001, attempt: 1, jobId: 5101, elapsedMs: 720_000 });
  assert.equal(guarded.known, false);
  assert.equal(guarded.reason, UNKNOWN_COST_REASONS.JOB_COST_COVERED_BY_RUN_USAGE);
});

test('jobs without usable timing resolve to a precise unknown; config fails fast', () => {
  const src = actionsMeasuredCostSource({ rateUsdPerMinute: 0.008 });
  const noTiming = src({ kind: 'ci_workflow_job', runId: 1, attempt: 1, jobId: 9 });
  assert.equal(noTiming.known, false);
  assert.equal(noTiming.reason, UNKNOWN_COST_REASONS.NO_JOB_DURATION);

  assert.throws(() => actionsMeasuredCostSource({ rateUsdPerMinute: 0 }));
  assert.throws(() => actionsMeasuredCostSource({ rateUsdPerMinute: Number.NaN }));
  assert.throws(() => actionsMeasuredCostSource({ rateUsdPerMinute: 0.01, labelMultipliers: { bad: -1 } }));
  assert.throws(() => actionsMeasuredCostSource({ rateUsdPerMinute: 0.01, usageByAttempt: {} }));
});

test('the default seam source answers each kind with its own precise reason', () => {
  const src = unavailableEvidenceCostSource();
  assert.equal(src({ kind: 'ci_workflow_run' }).reason, UNKNOWN_COST_REASONS.NO_ACTIONS_USAGE_SUPPLIED);
  assert.equal(src({ kind: 'ci_workflow_job' }).reason, UNKNOWN_COST_REASONS.ACTIONS_JOBS_UNBILLED);
  assert.equal(src({ kind: 'check_run' }).reason, UNKNOWN_COST_REASONS.CHECK_RUNS_UNBILLED);
});

// --- mapper ---------------------------------------------------------------------

test('terminal correlated-run jobs become conforming compute events bound to revisions', () => {
  const run = runById(9002);
  const task = {
    taskRef: 't:pr:101',
    executionRefByRevision: new Map([[sha.pr101r3, `t:pr:101:rev:${sha.pr101r3}`]]),
  };
  const { records, excluded, pending } = mapWorkflowJobs({
    run,
    jobs: [
      {
        id: 5201,
        status: 'completed',
        started_at: '2026-07-03T11:42:00Z',
        completed_at: '2026-07-03T11:48:00Z',
        labels: ['ubuntu-latest'],
      },
    ],
    task,
    scope: { owner: 'acme-factory', repo: 'line-controller', key: SCOPE_KEY },
    costSource: unavailableEvidenceCostSource(),
    linkConfidence: 'inferred',
  });

  assert.equal(pending, 0);
  assert.deepEqual(excluded, []);
  const ev = records[0].event;
  assert.equal(ev.type, 'compute_usage_recorded');
  assert.equal(ev.task_ref, 't:pr:101');
  assert.equal(ev.execution_ref, `t:pr:101:rev:${sha.pr101r3}`);
  assert.equal(ev.event_id, `ev:${SCOPE_KEY}:wfjob:5201`);
  assert.equal(ev.source.ref, `${SCOPE_KEY}/actions/runs/9002/jobs`);
  assert.equal(ev.source.meta.link_confidence, 'inferred');
  assert.equal(ev.source.meta.execution_binding, 'revision');
  assert.equal(ev.payload.resource_ref, 'cmp:wfjob:5201');
  assert.equal(ev.payload.resource_class, 'github_actions_runner');
  assert.equal(ev.payload.cost.known, false);
  assert.equal(ev.payload.cost.reason, UNKNOWN_COST_REASONS.ACTIONS_JOBS_UNBILLED);
});

test('unknown-revision bindings stay task-level; pending/malformed jobs never emit', () => {
  const run = { id: 42, run_attempt: 3, head_sha: 'ffffffffffffffffffffffffffffffffffffffff' };
  const task = { taskRef: 't:pr:7', executionRefByRevision: new Map() };
  const { records, excluded, pending } = mapWorkflowJobs({
    run,
    jobs: [
      { id: 'not-a-number', status: 'completed' },
      { id: 81, status: 'queued' },
      { id: 82, status: 'completed', started_at: '2026-08-01T00:00:00Z', completed_at: '2026-08-01T00:01:00Z' },
    ],
    task,
    scope: { owner: 'o', repo: 'r', key: 'o/r' },
    costSource: unavailableEvidenceCostSource(),
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].event.execution_ref, undefined);
  assert.equal(records[0].event.source.meta.execution_binding, 'task_unassigned');
  assert.equal(pending, 1);
  assert.deepEqual(excluded.map((e) => e.reason), ['malformed_job_id']);
});

test('compute was consumed regardless of job conclusion or run-level CI mapping', () => {
  // Run 9004 is still in_progress and 9005's conclusion is unmapped — yet both
  // have terminal jobs whose compute belongs on the books.
  const { events, stats } = auditWith({});
  const fromPendingRun = events.find((e) => e.payload?.resource_ref === 'cmp:wfjob:5301');
  const fromNeutralRun = events.find((e) => e.payload?.resource_ref === 'cmp:wfjob:5401');
  assert.ok(fromPendingRun, 'in-progress run jobs must still carry their compute');
  assert.equal(fromPendingRun.task_ref, 't:pr:103'); // open/unresolved task
  assert.ok(fromNeutralRun, 'unmapped-conclusion run jobs must still carry their compute');
  assert.equal(fromNeutralRun.task_ref, 't:pr:102');

  assert.equal(stats.counts.workflow_jobs_seen, 6); // includes the in-progress job
  assert.equal(stats.counts.workflow_jobs_emitted, 5);
  assert.equal(stats.counts.workflow_jobs_pending_not_terminal, 1);
});

// --- seams ------------------------------------------------------------------------

test('audit totals combine run usage + uncovered job money exactly once each', () => {
  const { stats } = auditWith({ usageByAttempt: fixtureUsageRecords() });
  // 232_000 (runs) + 48_000 + 8_000 + 24_000 (jobs not covered by usage)
  assert.equal(stats.costs.known_micro_usd_total, 312_000);
  assert.equal(stats.counts.workflow_jobs_cost_known, 3);
  assert.equal(stats.counts.workflow_jobs_cost_unknown, 2); // guarded 9001@a1 pair
  assert.ok(stats.notes.some((n) => /double-counting/.test(n)));
});

test('bundle seam carries measured compute on the revision that caused it', () => {
  const bundle = buildNormalizedBundle(fixtureEvidence(), {
    costSource: actionsMeasuredCostSource({
      usageByAttempt: fixtureUsageRecords(),
      rateUsdPerMinute: FIXTURE_RATE_USD_PER_MINUTE,
    }),
  });
  const t101 = bundle.records.find((r) => r.task_id === 't:pr:101');
  const revR3 = t101.executions.find((e) => e.execution_id === `t:pr:101:rev:${sha.pr101r3}`);
  assert.deepEqual(revR3.components.compute, { basis: 'measured', amount_micro_usd: 48_000 });
  assert.equal(revR3.total_amount_micro_usd, 48_000); // ci unavailable for this revision

  // Single-revision tasks hold their bound compute directly on that revision;
  // multi-revision tasks roll unprovable bindings onto the surviving one.
  const t102 = bundle.records.find((r) => r.task_id === 't:pr:102');
  const last102 = t102.executions[t102.executions.length - 1];
  assert.deepEqual(last102.components.compute, { basis: 'measured', amount_micro_usd: 24_000 });

  const t103 = bundle.records.find((r) => r.task_id === 't:pr:103');
  const last103 = t103.executions[t103.executions.length - 1];
  assert.deepEqual(last103.components.compute, { basis: 'measured', amount_micro_usd: 8_000 });

  assert.equal(bundle.collection_stats.compute_cost_known, 3);
  assert.equal(bundle.collection_stats.compute_cost_unknown, 2);
  assert.equal(bundle.collection_stats.compute_cost_bound_to_revision_micro_usd_total, 80_000);
});
