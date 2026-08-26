import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  repoScope,
  taskRefForPr,
  executionRefForRevision,
  ciRefFor,
  validationRefForCheckRun,
  eventId,
  apiRef,
} from '../src/refs.js';

test('repoScope validates slugs and builds the tenant scope key', () => {
  const s = repoScope({ owner: 'acme-factory', repo: 'line-controller' });
  assert.deepEqual({ ...s }, { owner: 'acme-factory', repo: 'line-controller', key: 'acme-factory/line-controller' });
  assert.throws(() => repoScope({ owner: '', repo: 'x' }));
  assert.throws(() => repoScope({ owner: 'bad/slash', repo: 'x' }));
  assert.throws(() => repoScope({ owner: 'ok', repo: '../escape' }));
});

test('refs are tenant-scoped: identical coordinates in different repos differ', () => {
  const a = repoScope({ owner: 'tenant-a', repo: 'widget' });
  const b = repoScope({ owner: 'tenant-b', repo: 'widget' });
  const evA = eventId(a.key, 'pr-created', '101');
  const evB = eventId(b.key, 'pr-created', '101');
  assert.notEqual(evA, evB);
  assert.ok(evA.startsWith(`ev:${a.key}:`));
});

test('domain refs are deterministic and stable within one collection', () => {
  assert.equal(taskRefForPr(101), 't:pr:101');
  assert.equal(executionRefForRevision(taskRefForPr(101), 'abc123'), 't:pr:101:rev:abc123');
  assert.equal(ciRefFor(9001, 2), 'ci:wfrun:9001@a2');
  assert.equal(validationRefForCheckRun(7001), 'val:checkrun:7001');
});

test('api refs carry tenant/source provenance only (documented shape)', () => {
  const s = repoScope({ owner: 'o', repo: 'r' });
  assert.equal(apiRef.pull(s.key, 7), 'o/r/pulls/7');
  assert.equal(apiRef.workflowRunAttempt(s.key, 9001, 3), 'o/r/actions/runs/9001/attempts/3');
  assert.equal(apiRef.checkRuns(s.key, 'abc'), 'o/r/commits/abc/check-runs');
});
