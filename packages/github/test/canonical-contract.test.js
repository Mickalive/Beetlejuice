/**
 * Canonical-contract conformance (WC-002: never redesign the model).
 *
 * These tests pin the adapter's output to the canonical core ingest contract
 * (`packages/core/src/events.js`, event schema version 1): allowed top-level
 * keys, payload field specs, cost-object shape and enum vocabularies. The
 * literals below are deliberately duplicated from the core so any drift on
 * either side fails loudly here — before integration.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleAudit } from '../src/map/audit.js';
import { conformCanonicalEvent } from '../src/canonical.js';
import { fixtureEvidence } from './fixtures/synthetic-repo.js';

// Pinned vocabulary from the canonical core (eventSchemaVersion 1).
const CORE_ALLOWED_TOP_LEVEL = [
  'type',
  'payload',
  'time',
  'task_ref',
  'execution_ref',
  'event_id',
  'source',
];
const CORE_EXECUTION_STATUSES = ['completed', 'failed', 'aborted', 'superseded'];
const CORE_CI_STATUSES = ['passed', 'failed', 'cancelled', 'timed_out'];
const CORE_VALIDATION_STATUSES = ['passed', 'failed', 'skipped'];

const audit = () => assembleAudit(fixtureEvidence(), {});

test('every emitted event uses only canonical top-level keys', () => {
  for (const ev of audit().events) {
    for (const key of Object.keys(ev)) {
      assert.ok(
        CORE_ALLOWED_TOP_LEVEL.includes(key),
        `${ev.event_id}: non-canonical top-level key "${key}"`
      );
    }
  }
});

test('execution statuses stay within the canonical enum', () => {
  for (const ev of audit().events.filter((e) => e.type === 'execution_finished')) {
    assert.ok(CORE_EXECUTION_STATUSES.includes(ev.payload.status), ev.event_id);
    if (ev.payload.status === 'superseded') {
      assert.ok(typeof ev.payload.superseded_by_execution_ref === 'string');
    } else {
      assert.equal('superseded_by_execution_ref' in ev.payload, false);
    }
  }
});

test('CI statuses stay within the canonical enum; costs use the exact cost shape', () => {
  const { events } = audit();
  for (const ev of events.filter((e) => e.type === 'ci_run_recorded')) {
    assert.ok(CORE_CI_STATUSES.includes(ev.payload.status), ev.event_id);
    const keys = Object.keys(ev.payload.cost).sort();
    if (ev.payload.cost.known) {
      assert.deepEqual(keys, ['known', 'micro_usd']);
      assert.ok(Number.isInteger(ev.payload.cost.micro_usd));
      assert.ok(ev.payload.cost.micro_usd >= 0);
    } else {
      assert.deepEqual(keys, ['known', 'reason']);
      assert.ok(ev.payload.cost.reason.length > 0);
    }
  }
});

test('validation statuses stay within the canonical enum', () => {
  for (const ev of audit().events.filter((e) => e.type === 'validation_recorded')) {
    assert.ok(CORE_VALIDATION_STATUSES.includes(ev.payload.status), ev.event_id);
  }
});

test('ISO timestamps are strict strings the canonical parser accepts', () => {
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
  for (const ev of audit().events) {
    if (ev.time !== null && ev.time !== undefined) assert.match(ev.time, iso, ev.event_id);
    for (const field of ['started_at', 'finished_at']) {
      if (ev.payload?.[field] !== undefined) assert.match(ev.payload[field], iso, ev.event_id);
    }
  }
});

test('conformCanonicalEvent round-trips every emitted event unchanged', () => {
  for (const original of audit().events) {
    const conformed = conformCanonicalEvent(JSON.parse(JSON.stringify(original)));
    assert.deepEqual(conformed, original);
  }
});

test('the adapter refuses to emit types outside its declared vocabulary', () => {
  assert.throws(
    () =>
      conformCanonicalEvent({
        type: 'model_invocation_recorded',
        time: null,
        task_ref: 't:x',
        payload: { invocation_ref: 'm:1', status: 'ok', cost: { known: false, reason: 'r' } },
      }),
    /unsupported event type/
  );
});

test('schema extensibility: a NEW vendor adapter can express the same task concept', () => {
  // A hypothetical GitLab delivery maps into the identical canonical shapes
  // without changing this package or the core contract.
  const gitlabishEvent = conformCanonicalEvent({
    type: 'pull_request_merged',
    time: '2026-08-01T00:00:00Z',
    task_ref: 't:mr:9',
    payload: { pr_ref: 'mr:9' },
    source: { adapter: 'gitlab', ref: 'grp/proj/mrs/9' },
  });
  assert.equal(gitlabishEvent.source.adapter, 'gitlab');
  assert.equal(gitlabishEvent.payload.pr_ref, 'mr:9');
});
