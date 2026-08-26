import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePolicy,
  classifyPullRequest,
  classifyBranch,
  CONFIDENCE_MEASURED,
  CONFIDENCE_INFERRED,
} from '../src/policy.js';
import { BOT_ACTOR, HUMAN_ACTOR, fixturePolicy, prJson } from './fixtures/synthetic-repo.js';

test('policy requires an explicit operator decision', () => {
  assert.throws(() => normalizePolicy(undefined), /explicit policy/);
  assert.throws(() => normalizePolicy('forge/'), /must be an object/);
});

test('empty allowlist + empty prefixes ingests nothing (no silent defaults)', () => {
  const pol = normalizePolicy({ botActors: [], branchPrefixes: [] });
  const pr = prJson({ number: 1, state: 'open', createdAt: '2026-01-01T00:00:00Z', login: BOT_ACTOR, headBranch: 'x' });
  const cls = classifyPullRequest(pr, pol);
  assert.equal(cls.agentic, false);
});

test('bot actor allowlist yields measured confidence', () => {
  const pol = normalizePolicy(fixturePolicy);
  const pr = prJson({
    number: 101,
    state: 'closed',
    createdAt: '2026-07-01T09:00:00Z',
    login: BOT_ACTOR,
    headBranch: 'anything/at-all',
    headSha: 'a'.repeat(40),
  });
  const cls = classifyPullRequest(pr, pol);
  assert.deepEqual(cls, { agentic: true, confidence: CONFIDENCE_MEASURED, basis: 'bot_actor_allowlist' });
});

test('branch prefix alone yields inferred confidence only', () => {
  const pol = normalizePolicy(fixturePolicy);
  const pr = prJson({
    number: 102,
    state: 'closed',
    createdAt: '2026-07-05T10:00:00Z',
    login: HUMAN_ACTOR,
    headBranch: 'forge/gauge-cleanup',
    headSha: 'b'.repeat(40),
  });
  const cls = classifyPullRequest(pr, pol);
  assert.deepEqual(cls, { agentic: true, confidence: CONFIDENCE_INFERRED, basis: 'branch_prefix_match:forge/' });
});

test('unmatched PRs are not agentic', () => {
  const pol = normalizePolicy(fixturePolicy);
  const pr = prJson({
    number: 110,
    state: 'closed',
    createdAt: '2026-07-08T08:00:00Z',
    login: HUMAN_ACTOR,
    headBranch: 'feature/manual-tuning',
    headSha: 'c'.repeat(40),
  });
  assert.equal(classifyPullRequest(pr, pol).agentic, false);
});

test('actor matching is case-insensitive; prefixes are case-sensitive evidence', () => {
  const pol = normalizePolicy({ botActors: [BOT_ACTOR.toUpperCase()], branchPrefixes: [] });
  const pr = prJson({ number: 5, state: 'open', createdAt: '2026-01-01T00:00:00Z', login: BOT_ACTOR.toLowerCase(), headBranch: 'x', headSha: 'd'.repeat(40) });
  assert.equal(classifyPullRequest(pr, pol).confidence, CONFIDENCE_MEASURED);

  const upper = normalizePolicy({ botActors: [], branchPrefixes: ['FORGE/'] });
  assert.equal(classifyBranch('forge/lower', upper).agentic, false);
  assert.equal(classifyBranch('FORGE/upper', upper).confidence, CONFIDENCE_INFERRED);
});
