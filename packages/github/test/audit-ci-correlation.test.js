import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleAudit } from '../src/map/audit.js';
import { actionsUsageCostSource, UNKNOWN_COST_REASONS } from '../src/cost-source.js';
import { LINK_EXPLICIT, LINK_INFERRED } from '../src/policy.js';
import {
  fixtureEvidence,
  fixtureUsageRecords,
  FIXTURE_RATE_USD_PER_MINUTE,
  sha,
} from './fixtures/synthetic-repo.js';

function auditWith(usage) {
  const costSource =
    usage === undefined
      ? undefined
      : actionsUsageCostSource({ usageByAttempt: usage, rateUsdPerMinute: FIXTURE_RATE_USD_PER_MINUTE });
  return assembleAudit(fixtureEvidence(), { ...(costSource ? { costSource } : {}) });
}

const ciOf = (events, runId, attempt) =>
  events.find((e) => e.type === 'ci_run_recorded' && e.event_id === `ev:acme-factory/line-controller:wfrun:${runId}@a${attempt}`);

test('explicit GitHub links correlate with measured confidence', () => {
  const { events } = auditWith(fixtureUsageRecords());
  const ev = ciOf(events, 9001, 1);
  assert.equal(ev.source.meta.link_confidence, LINK_EXPLICIT);
  assert.equal(ev.task_ref, 't:pr:101');
});

test('stale explicit links degrade honestly to inferred via branch+SHA evidence', () => {
  const { events, stats } = auditWith(fixtureUsageRecords());
  const ev = ciOf(events, 9002, 1); // pull_requests: [999] (not ingested)
  assert.equal(ev.source.meta.link_confidence, LINK_INFERRED);
  assert.equal(ev.task_ref, 't:pr:101');
  assert.equal(stats.counts.workflow_runs_linked_explicit, 2);
  assert.equal(stats.counts.workflow_runs_linked_inferred, 1);
});

test('uncorrelatable CI is excluded with a precise reason, never force-attached', () => {
  const { stats } = auditWith(fixtureUsageRecords());
  assert.equal(stats.counts.workflow_runs_excluded_by_reason.no_agentic_pr_link, 1);
  assert.equal(stats.counts.workflow_runs_pending_not_terminal, 1);
  assert.equal(stats.counts.workflow_runs_excluded_by_reason['unmapped_ci_conclusion:neutral'], 1);
  assert.equal(stats.counts.workflow_runs_emitted, 3);
});

test('revision binding attaches runs to the matching execution; equivalence keys are evidence tokens', () => {
  const { events } = auditWith(fixtureUsageRecords());
  const a1 = ciOf(events, 9001, 1);
  assert.equal(a1.execution_ref, `t:pr:101:rev:${sha.pr101r2}`);
  assert.equal(a1.payload.revision_key, sha.pr101r2);
  assert.equal(
    a1.payload.equivalence_key,
    `wf:.github/workflows/ci.yml@sha:${sha.pr101r2}`
  );

  // Re-run of the same workflow on identical inputs shares ONE equivalence key
  // and ONE revision — exactly what WASTE_DUP_CI_V1 requires to reason.
  const a2 = ciOf(events, 9001, 2);
  assert.equal(a2.payload.equivalence_key, a1.payload.equivalence_key);
  assert.equal(a2.payload.revision_key, a1.payload.revision_key);
  assert.notEqual(a2.payload.ci_ref, a1.payload.ci_ref);
});

test('CI timing derives duration from upstream timestamps', () => {
  const { events } = auditWith(fixtureUsageRecords());
  const ev = ciOf(events, 9001, 1);
  assert.equal(ev.payload.started_at, '2026-07-02T10:10:00Z');
  assert.equal(ev.payload.finished_at, '2026-07-02T10:25:00Z');
  assert.equal(ev.payload.duration_ms, 900_000);
});

test('measured CI costs come only from operator-supplied usage + explicit rate', () => {
  const { events, stats } = auditWith(fixtureUsageRecords());
  const a1 = ciOf(events, 9001, 1);
  assert.deepEqual(a1.payload.cost, { known: true, micro_usd: 120_000 });
  const a2 = ciOf(events, 9001, 2);
  assert.equal(a2.payload.cost.micro_usd, 112_000);

  // Run 9002 has no usage record: honest unknown, counted with its reason.
  const unmeasured = ciOf(events, 9002, 1);
  assert.equal(unmeasured.payload.cost.known, false);
  assert.equal(unmeasured.payload.cost.reason, UNKNOWN_COST_REASONS.NO_ACTIONS_USAGE_SUPPLIED);

  assert.equal(stats.costs.known_micro_usd_total, 232_000);
  assert.equal(stats.costs.unknown_by_reason[UNKNOWN_COST_REASONS.NO_ACTIONS_USAGE_SUPPLIED], 1);
});

test('without operator usage every CI cost stays explicitly unknown', () => {
  const { events, stats } = auditWith(undefined);
  for (const ev of events.filter((e) => e.type === 'ci_run_recorded')) {
    assert.equal(ev.payload.cost.known, false);
    assert.ok(typeof ev.payload.cost.reason === 'string' && ev.payload.cost.reason.length > 0);
  }
  assert.equal(stats.costs.known_micro_usd_total, 0);
});

test('check runs map onto validations bound by revision SHA', () => {
  const { events, stats } = auditWith(fixtureUsageRecords());
  const validations = events.filter((e) => e.type === 'validation_recorded');
  assert.equal(validations.length, 3);

  const unit = validations.find((v) => v.payload.validation_ref === 'val:checkrun:7001');
  assert.equal(unit.payload.status, 'passed');
  assert.equal(unit.execution_ref, `t:pr:101:rev:${sha.pr101r2}`);
  assert.equal(unit.payload.validation_class, 'unit-tests');

  const lint = validations.find((v) => v.payload.validation_ref === 'val:checkrun:7002');
  assert.equal(lint.payload.status, 'failed');

  // Check runs expose no billing evidence through GitHub: unknown with reason.
  assert.equal(validations.every((v) => v.payload.cost.known === false), true);
  // Under this run-level-only source, terminal Actions jobs of correlated runs
  // also fall through to the generic legacy reason (5 of them in the fixture).
  assert.equal(
    stats.costs.unknown_by_reason[UNKNOWN_COST_REASONS.CHECK_RUNS_UNBILLED],
    3 + 5
  );
  assert.equal(stats.counts.check_runs_excluded_by_reason.check_run_revision_unknown_to_ingested_tasks, 1);
});

test('stats notes keep the honest limitations attached to the audit itself', () => {
  const { stats } = auditWith(fixtureUsageRecords());
  assert.ok(Array.isArray(stats.notes));
  assert.ok(stats.notes.some((n) => /model\/tool invocation/.test(n)));
  assert.ok(stats.notes.some((n) => /unknown with reason/.test(n)));
});
