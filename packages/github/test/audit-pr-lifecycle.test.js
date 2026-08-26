import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleAudit } from '../src/map/audit.js';
import { fixtureEvidence, sha, SCOPE_KEY } from './fixtures/synthetic-repo.js';

function audit() {
  return assembleAudit(fixtureEvidence(), {});
}

const byType = (events, type) => events.filter((e) => e.type === type);
const forTask = (events, type, taskRef) => events.filter((e) => e.type === type && e.task_ref === taskRef);

test('agentic classification drives ingestion with honest counts', () => {
  const { stats } = audit();
  assert.equal(stats.scope, SCOPE_KEY);
  assert.equal(stats.counts.pulls_seen, 4);
  assert.equal(stats.counts.pulls_ingested_measured, 2); // #101, #103
  assert.equal(stats.counts.pulls_ingested_inferred, 1); // #102 (branch prefix)
  assert.equal(stats.counts.pulls_excluded_non_agentic, 1); // #110
  assert.equal(stats.counts.revisions_observed, 5);
});

test('merged PR reconstructs a full supersession chain with strictly-later replacements', () => {
  const { events } = audit();
  const taskRef = 't:pr:101';
  const ordered = [...events]; // already deterministically ordered

  const starts = forTask(ordered, 'execution_started', taskRef);
  assert.equal(starts.length, 3);
  const startSeqOf = new Map(starts.map((e) => [e.payload.execution_ref, ordered.indexOf(e)]));

  const superseded = forTask(ordered, 'execution_finished', taskRef).filter(
    (e) => e.payload.status === 'superseded'
  );
  assert.equal(superseded.length, 2);
  for (const fin of superseded) {
    const target = fin.payload.superseded_by_execution_ref;
    // Core's BAD_SUPERSESSION invariant must hold on our stream:
    assert.ok(startSeqOf.get(target) > startSeqOf.get(fin.payload.execution_ref));
    assert.ok(ordered.indexOf(fin) > startSeqOf.get(target), 'finish recorded after its replacement start');
  }
  // Chain shape: r1 -> r2 -> r3
  const r1 = `t:pr:101:rev:${sha.pr101r1}`;
  const r2 = `t:pr:101:rev:${sha.pr101r2}`;
  const r3 = `t:pr:101:rev:${sha.pr101r3}`;
  const finishByExec = new Map(superseded.map((e) => [e.payload.execution_ref, e]));
  assert.equal(finishByExec.get(r1)?.payload.superseded_by_execution_ref, r2);
  assert.equal(finishByExec.get(r2)?.payload.superseded_by_execution_ref, r3);

  // Terminal state: final revision completed at merge time.
  const finals = forTask(ordered, 'execution_finished', taskRef).filter((e) => e.payload.status === 'completed');
  assert.equal(finals.length, 1);
  assert.equal(finals[0].payload.execution_ref, r3);
  assert.equal(finals[0].time, '2026-07-04T08:15:00Z');
});

test('closed-without-merge aborts the final revision; delivery signals stay distinct', () => {
  const { events } = audit();
  const finished = forTask(events, 'execution_finished', 't:pr:102');
  assert.equal(finished.length, 1);
  assert.equal(finished[0].payload.status, 'aborted');

  assert.equal(forTask(events, 'pull_request_closed', 't:pr:102').length, 1);
  assert.equal(forTask(events, 'pull_request_merged', 't:pr:102').length, 0);
  // Merged PR emits merge but no plain close (close is implied by merge).
  assert.equal(forTask(events, 'pull_request_merged', 't:pr:101').length, 1);
});

test('open PR stays honestly unresolved: running execution, no terminal signals', () => {
  const { events } = audit();
  assert.equal(forTask(events, 'execution_started', 't:pr:103').length, 1);
  assert.equal(forTask(events, 'execution_finished', 't:pr:103').length, 0);
  assert.equal(forTask(events, 'pull_request_closed', 't:pr:103').length, 0);
  assert.equal(forTask(events, 'pull_request_merged', 't:pr:103').length, 0);
});

test('classification confidence is preserved as tenant/source metadata', () => {
  const { events } = audit();
  const startedMeta = events.find((e) => e.type === 'task_started' && e.task_ref === 't:pr:101').source.meta;
  assert.equal(startedMeta.agentic_confidence, 'measured');
  assert.match(startedMeta.agentic_basis, /bot_actor_allowlist/);

  const inferredMeta = events.find((e) => e.type === 'task_started' && e.task_ref === 't:pr:102').source.meta;
  assert.equal(inferredMeta.agentic_confidence, 'inferred');
  assert.match(inferredMeta.agentic_basis, /branch_prefix_match:forge\//);
});

test('every event carries a unique tenant-scoped id within one audit', () => {
  const { events } = audit();
  const ids = events.map((e) => e.event_id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.ok(id.startsWith(`ev:${SCOPE_KEY}:`), id);
});
