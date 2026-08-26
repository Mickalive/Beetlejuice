/**
 * Privacy/scope boundary tests (WC-002 acceptance).
 *
 * "Raw GitHub identifiers remain in tenant/source scope and never leak into
 * the global exporter interface."
 *
 * These tests enforce that mechanically:
 *  1. repository coordinates appear ONLY in explicitly tenant/source-scoped
 *     fields (`source.ref`, `event_id`);
 *  2. the adapter's output is fully parameterized by its scope string — two
 *     audits over different repositories are structurally identical apart
 *     from those scoped strings, proving no hidden cross-tenant fingerprint
 *     (hash, stable id) is derived anywhere;
 *  3. the public surface exposes no global-exporter or hashing capability.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleAudit } from '../src/map/audit.js';
import * as github from '../src/index.js';
import {
  OWNER,
  REPO,
  SCOPE_KEY,
  fixtureEvidence,
} from './fixtures/synthetic-repo.js';

const audit = () => assembleAudit(fixtureEvidence(), {});

/** Collect dotted paths of every string value exactly equal to `needle`. */
function pathsOf(strings, value, obj, prefix = '') {
  const out = [];
  if (typeof obj === 'string') {
    if (obj.includes(value)) out.push(prefix || '(root)');
    return out;
  }
  if (obj !== null && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      out.push(...pathsOf(strings, value, v, prefix ? `${prefix}.${k}` : k));
    }
  }
  return out;
}

test('repository coordinates appear only in tenant/source-scoped provenance fields', () => {
  const { events } = audit();
  assert.ok(events.length > 0);

  const allowedFieldSuffixes = ['event_id', 'source.ref'];
  for (const ev of events) {
    const hits = pathsOf(null, SCOPE_KEY, ev);
    assert.ok(hits.length > 0, `${ev.event_id}: expected scoped provenance somewhere`);
    for (const path of hits) {
      assert.ok(
        allowedFieldSuffixes.some((suffix) => path === suffix || path.endsWith(`.${suffix}`)),
        `${ev.event_id}: scope leaked into non-provenance field "${path}"`
      );
    }
  }
});

test('output is fully parameterized by scope: no hidden cross-tenant fingerprint', () => {
  const OTHER_OWNER = 'other-co';
  const OTHER_REPO = 'widget-line';
  const otherEvidence = fixtureEvidence();
  otherEvidence.scope = { owner: OTHER_OWNER, repo: OTHER_REPO, key: `${OTHER_OWNER}/${OTHER_REPO}` };

  const a = JSON.stringify(audit().events).split(SCOPE_KEY).join('@SCOPE@');
  const b = JSON.stringify(assembleAudit(otherEvidence, {}).events)
    .split(`${OTHER_OWNER}/${OTHER_REPO}`)
    .join('@SCOPE@');

  assert.equal(a, b, 'audits must be structurally identical modulo their scope string');
});

test('identity stays tenant-local: PR numbers are scoped only via ledger/event ids', () => {
  // Two repositories expose the same PR number. Domain refs (task_ref) are
  // deliberately PR-local because a tenant ledger is single-scope by
  // construction — while event ids embed the scope so one ledger CAN ingest
  // several repositories without collisions, still without any global id.
  const otherOwner = 'second-org';
  const other = fixtureEvidence();
  other.scope = { owner: otherOwner, repo: REPO, key: `${otherOwner}/${REPO}` };

  const a = audit().events.find((e) => e.type === 'pull_request_created' && e.payload.pr_ref === 'pr:101');
  const b = assembleAudit(other, {}).events.find(
    (e) => e.type === 'pull_request_created' && e.payload.pr_ref === 'pr:101'
  );
  assert.notEqual(a.event_id, b.event_id);
  assert.equal(a.task_ref, b.task_ref); // local ref, resolved inside one scope
});

test('public surface exposes no hashing/global-exporter capability', async () => {
  const forbidden = /hash|digest|global|anonymi|pseudony/i;
  for (const name of Object.keys(github)) {
    assert.doesNotMatch(name, forbidden, `forbidden capability exported: ${name}`);
  }
});
