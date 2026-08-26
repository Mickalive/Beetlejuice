import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleAudit } from '../src/map/audit.js';
import { actionsUsageCostSource } from '../src/cost-source.js';
import { FIXTURE_RATE_USD_PER_MINUTE, fixtureEvidence, fixtureUsageRecords } from './fixtures/synthetic-repo.js';

const opts = () => ({
  costSource: actionsUsageCostSource({ usageByAttempt: fixtureUsageRecords(), rateUsdPerMinute: FIXTURE_RATE_USD_PER_MINUTE }),
});

test('assembling the same evidence twice yields byte-identical output', () => {
  const a = assembleAudit(fixtureEvidence(), opts());
  const b = assembleAudit(fixtureEvidence(), opts());
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('input ordering does not change output (sort-then-map determinism)', () => {
  const shuffled = fixtureEvidence();
  shuffled.prs = [...shuffled.prs].reverse();
  shuffled.workflowRuns = [...shuffled.workflowRuns].reverse();

  const a = assembleAudit(fixtureEvidence(), opts());
  const b = assembleAudit(shuffled, opts());
  assert.equal(JSON.stringify(a.events), JSON.stringify(b.events));
  assert.equal(JSON.stringify(a.stats.counts), JSON.stringify(b.stats.counts));
});

test('events are chronologically ordered with deterministic tiebreaks', () => {
  const { events } = assembleAudit(fixtureEvidence(), opts());
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1].time ?? '';
    const curr = events[i].time ?? '';
    assert.ok(prev <= curr, `ordering violated at ${i}: ${prev} !<= ${curr}`);
  }
});

test('emitted events are deeply frozen (stored evidence cannot mutate)', () => {
  const { events } = assembleAudit(fixtureEvidence(), opts());
  assert.ok(events.length > 0);
  const checkFrozen = (v) => {
    if (v === null || typeof v !== 'object') return true;
    if (!Object.isFrozen(v)) return false;
    return Object.values(v).every(checkFrozen);
  };
  for (const ev of events) assert.ok(checkFrozen(ev), `event ${ev.event_id} not fully frozen`);
});

test('stats are frozen too', () => {
  const { stats } = assembleAudit(fixtureEvidence(), opts());
  assert.ok(Object.isFrozen(stats));
  assert.ok(Object.isFrozen(stats.counts));
});
