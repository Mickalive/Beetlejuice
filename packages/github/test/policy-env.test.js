// Operator policy resolution from the environment (audit A12 seam).
//
// The committed product surface must be able to run a real read-only audit
// without an interactive prompt, while the adapter refuses to invent an
// agentic classification silently. resolveAgenticPolicyFromEnv() is the
// adapter-owned building block for that: documented conservative defaults,
// explicit per-dimension env overrides (BEETLEJUICE_BOT_ACTORS /
// BEETLEJUICE_BRANCH_PREFIXES) and an explicit empty-string opt-out —
// never a silent guess.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePolicy,
  classifyPullRequest,
  classifyBranch,
  CONFIDENCE_MEASURED,
  CONFIDENCE_INFERRED,
  SUGGESTED_AGENTIC_ACTORS,
  DEFAULT_AGENTIC_BRANCH_PREFIXES,
  AGENTIC_ACTORS_ENV,
  AGENTIC_BRANCH_PREFIXES_ENV,
  resolveAgenticPolicyFromEnv,
} from '../src/policy.js';
import { prJson } from './fixtures/synthetic-repo.js';

test('unset env vars fall back to the documented suggested defaults', () => {
  const resolved = resolveAgenticPolicyFromEnv({});
  assert.deepEqual(resolved.botActors, [...SUGGESTED_AGENTIC_ACTORS]);
  assert.deepEqual(resolved.branchPrefixes, [...DEFAULT_AGENTIC_BRANCH_PREFIXES]);
  // Defaults cover well-known coding-agent families and nothing exotic.
  for (const family of ['copilot/', 'devin/', 'cursor/', 'codex/', 'jules/', 'claude/']) {
    assert.ok(DEFAULT_AGENTIC_BRANCH_PREFIXES.includes(family), `default prefixes include ${family}`);
  }
});

test('resolved defaults are frozen (callers cannot mutate shared state)', () => {
  const resolved = resolveAgenticPolicyFromEnv({});
  assert.ok(Object.isFrozen(resolved));
  assert.ok(Object.isFrozen(resolved.botActors));
  assert.ok(Object.isFrozen(resolved.branchPrefixes));
  assert.throws(() => {
    'use strict';
    resolved.botActors.push('sneaky-bot[bot]');
  }, TypeError);
});

test('each env var overrides only its own dimension', () => {
  const actorsOnly = resolveAgenticPolicyFromEnv({ [AGENTIC_ACTORS_ENV]: 'relay-bot[bot]' });
  assert.deepEqual(actorsOnly.botActors, ['relay-bot[bot]']);
  assert.deepEqual(actorsOnly.branchPrefixes, [...DEFAULT_AGENTIC_BRANCH_PREFIXES]);

  const prefixesOnly = resolveAgenticPolicyFromEnv({ [AGENTIC_BRANCH_PREFIXES_ENV]: 'forge/' });
  assert.deepEqual(prefixesOnly.botActors, [...SUGGESTED_AGENTIC_ACTORS]);
  assert.deepEqual(prefixesOnly.branchPrefixes, ['forge/']);
});

test('comma-separated values are trimmed and empty fragments dropped', () => {
  const resolved = resolveAgenticPolicyFromEnv({
    [AGENTIC_ACTORS_ENV]: ' alpha-bot[bot] ,, beta-bot[bot], ,',
    [AGENTIC_BRANCH_PREFIXES_ENV]: ',forge/,, dev/,',
  });
  assert.deepEqual(resolved.botActors, ['alpha-bot[bot]', 'beta-bot[bot]']);
  assert.deepEqual(resolved.branchPrefixes, ['forge/', 'dev/']);
});

test('empty string is an explicit opt-out for that dimension (not a default)', () => {
  const noActors = resolveAgenticPolicyFromEnv({ [AGENTIC_ACTORS_ENV]: '' });
  assert.deepEqual(noActors.botActors, []);
  assert.deepEqual(noActors.branchPrefixes, [...DEFAULT_AGENTIC_BRANCH_PREFIXES]);

  const neither = resolveAgenticPolicyFromEnv({ [AGENTIC_ACTORS_ENV]: '', [AGENTIC_BRANCH_PREFIXES_ENV]: '   ' });
  assert.deepEqual(neither.botActors, []);
  assert.deepEqual(neither.branchPrefixes, []);
  // An explicitly emptied policy still satisfies the explicit-policy contract:
  // it ingests nothing rather than guessing.
  assert.doesNotThrow(() => normalizePolicy(neither));
});

test('malformed values fail fast naming the offending variable', () => {
  assert.throws(
    () => resolveAgenticPolicyFromEnv({ [AGENTIC_ACTORS_ENV]: 'two words[bot]' }),
    (error) => error instanceof TypeError && /BEETLEJUICE_BOT_ACTORS/.test(error.message)
  );
  assert.throws(
    () => resolveAgenticPolicyFromEnv({ [AGENTIC_BRANCH_PREFIXES_ENV]: 'a/\nb/' }),
    (error) => error instanceof TypeError && /BEETLEJUICE_BRANCH_PREFIXES/.test(error.message)
  );
  assert.throws(
    () => resolveAgenticPolicyFromEnv({ [AGENTIC_ACTORS_ENV]: 42 }),
    (error) =>
      error instanceof TypeError &&
      /BEETLEJUICE_BOT_ACTORS must be a comma-separated string \(got number\)/.test(error.message)
  );
  assert.throws(() => resolveAgenticPolicyFromEnv(null), /environment object/);
});

test('resolver reads only the two documented keys', () => {
  const noisy = resolveAgenticPolicyFromEnv({
    BEETLEJUICE_GITHUB_TOKEN: 'simulated-token-not-a-secret',
    UNRELATED: 'junk',
    [AGENTIC_ACTORS_ENV]: 'quiet-bot[bot]',
  });
  assert.deepEqual(noisy.botActors, ['quiet-bot[bot]']);
  assert.deepEqual(noisy.branchPrefixes, [...DEFAULT_AGENTIC_BRANCH_PREFIXES]);
});

test('defaults to process.env when called without arguments', () => {
  const previousActor = process.env[AGENTIC_ACTORS_ENV];
  process.env[AGENTIC_ACTORS_ENV] = 'env-driven-bot[bot]';
  try {
    const resolved = resolveAgenticPolicyFromEnv();
    assert.deepEqual(resolved.botActors, ['env-driven-bot[bot]']);
  } finally {
    if (previousActor === undefined) delete process.env[AGENTIC_ACTORS_ENV];
    else process.env[AGENTIC_ACTORS_ENV] = previousActor;
  }
});

test('resolved policy passes normalizePolicy and classifies end-to-end', () => {
  // Defaults: known bot identity -> measured; agent branch prefix -> inferred;
  // everything else excluded.
  const pol = normalizePolicy(resolveAgenticPolicyFromEnv({}));

  const measured = classifyPullRequest(
    prJson({
      number: 7,
      state: 'closed',
      createdAt: '2026-07-01T09:00:00Z',
      login: 'Copilot-SWE-Agent[bot]', // case-insensitive actor matching preserved
      headBranch: 'unrelated-branch',
      headSha: 'a'.repeat(40),
    }),
    pol
  );
  assert.equal(measured.confidence, CONFIDENCE_MEASURED);

  const inferred = classifyPullRequest(
    prJson({
      number: 8,
      state: 'open',
      createdAt: '2026-07-02T09:00:00Z',
      login: 'human-operator',
      headBranch: 'devin/fix-gauge-42',
      headSha: 'b'.repeat(40),
    }),
    pol
  );
  assert.deepEqual(inferred, { agentic: true, confidence: CONFIDENCE_INFERRED, basis: 'branch_prefix_match:devin/' });

  assert.equal(
    classifyPullRequest(
      prJson({
        number: 9,
        state: 'open',
        createdAt: '2026-07-03T09:00:00Z',
        login: 'human-operator',
        headBranch: 'feature/manual-work',
        headSha: 'c'.repeat(40),
      }),
      pol
    ).agentic,
    false
  );

  const prefixOnly = normalizePolicy(resolveAgenticPolicyFromEnv({ [AGENTIC_ACTORS_ENV]: '' }));
  assert.equal(classifyBranch('claude/refactor-loop', prefixOnly).confidence, CONFIDENCE_INFERRED);
  assert.equal(classifyBranch('release/v2', prefixOnly).agentic, false);
});
