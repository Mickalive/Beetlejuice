import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MICROS_PER_USD,
  UNKNOWN_COST_REASONS,
  unknownCost,
  microUsdFromBillableMs,
  actionsUsageCostSource,
  unknownEverythingCostSource,
  composeCostSources,
} from '../src/cost-source.js';

test('micro-USD arithmetic is exact for fixture usage', () => {
  assert.equal(MICROS_PER_USD, 1_000_000);
  // 900_000 ms at $0.008/min = 15 min = $0.12 = 120_000 µ$
  assert.equal(microUsdFromBillableMs(900_000, 0.008), 120_000);
  // 840_000 ms = 14 min = $0.112 = 112_000 µ$
  assert.equal(microUsdFromBillableMs(840_000, 0.008), 112_000);
});

test('microUsdFromBillableMs rejects nonsense instead of guessing', () => {
  assert.throws(() => microUsdFromBillableMs(-1, 0.008));
  assert.throws(() => microUsdFromBillableMs(Number.NaN, 0.008));
  assert.throws(() => microUsdFromBillableMs(1000, 0));
  assert.throws(() => microUsdFromBillableMs(1000, Number.NaN));
});

test('usage-backed source resolves measured cost with provenance', () => {
  const src = actionsUsageCostSource({
    usageByAttempt: new Map([['9001@a1', { billable_ms: 900_000 }]]),
    rateUsdPerMinute: 0.008,
  });
  const res = src({ kind: 'ci_workflow_run', runId: 9001, attempt: 1 });
  assert.equal(res.known, true);
  assert.equal(res.micro_usd, 120_000);
  assert.match(res.provenance, /measured/);
});

test('missing usage resolves to honest unknown with precise reason', () => {
  const src = actionsUsageCostSource({ usageByAttempt: new Map(), rateUsdPerMinute: 0.008 });
  const res = src({ kind: 'ci_workflow_run', runId: 1, attempt: 1 });
  assert.deepEqual({ known: res.known, reason: res.reason }, {
    known: false,
    reason: UNKNOWN_COST_REASONS.NO_ACTIONS_USAGE_SUPPLIED,
  });
});

test('check runs are unbilled through GitHub evidence alone', () => {
  const src = unknownEverythingCostSource();
  const res = src({ kind: 'check_run', checkRunId: 7001 });
  assert.equal(res.known, false);
  assert.equal(res.reason, UNKNOWN_COST_REASONS.CHECK_RUNS_UNBILLED);
});

test('compose prefers the first measured answer and keeps the last reason visible', () => {
  const unknownA = () => ({ ...unknownCost('reason-a') });
  const measured = (req) => (req.runId === 42 ? { known: true, micro_usd: 7 } : { ...unknownCost('reason-b') });
  const composed = composeCostSources(unknownA, measured);

  assert.deepEqual(
    { known: composed({ kind: 'ci_workflow_run', runId: 42 }).known },
    { known: true }
  );
  const miss = composed({ kind: 'ci_workflow_run', runId: 43 });
  assert.equal(miss.known, false);
  assert.equal(miss.reason, 'reason-b'); // LAST unknown wins, never the first
});

test('unknownCost freezes and validates its reason', () => {
  const u = unknownCost('why');
  assert.throws(() => {
    'use strict';
    u.reason = 'tampered';
  }, TypeError);
  assert.throws(() => unknownCost(''));
});
