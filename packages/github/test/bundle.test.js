/**
 * Tests for buildNormalizedBundle() — the adapter's normalized v2 bundle
 * producer (integration seam A7).
 *
 * The consumer contract pinned here is the product surface's normalized-input
 * schema v2 (apps/cli/docs/NORMALIZED_INPUT.md / apps/cli/src/schema.js):
 *   - envelope { schema_version:"2", normalization_version, collector_version, records[] };
 *   - agentic_task records with canonical outcome vocabulary;
 *   - executions with agent{family,model_class}, components from
 *     inference|tools|ci|compute, basis measured|estimated|unavailable,
 *     amount_micro_usd null IFF unavailable;
 *   - cost-accounting invariant total_amount_micro_usd == sum of representable
 *     components (the consumer REJECTS bundles violating it);
 *   - raw provider payload keys are forbidden anywhere in the bundle.
 *
 * The sibling app is intentionally NOT imported (this package stays
 * self-contained and hermetic); the contract is pinned by mirroring its
 * documented rules below so integration drift fails HERE first.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildNormalizedBundle, BUNDLE_SCHEMA_VERSION } from '../src/bundle.js';
import { COLLECTOR_VERSION, NORMALIZATION_VERSION } from '../src/versions.js';
import { actionsUsageCostSource, unknownEverythingCostSource, MICROS_PER_USD } from '../src/cost-source.js';
import {
  fixtureEvidence,
  fixtureUsageRecords,
  FIXTURE_RATE_USD_PER_MINUTE,
  sha,
  OWNER,
  REPO,
} from './fixtures/synthetic-repo.js';

// --- seam-A contract mirror (pins apps/cli/src/schema.js essentials) ----------

const OUTCOME_STATUSES = Object.freeze(['accepted', 'failed', 'aborted', 'unresolved']);
const COST_BASES = Object.freeze(['measured', 'estimated', 'unavailable']);
const COMPONENT_KEYS = Object.freeze(['inference', 'tools', 'ci', 'compute']);
const FAILURE_CATEGORIES = Object.freeze(['deterministic', 'transient', 'flaky', 'unknown']);
const RAW_PROVIDER_MARKERS = Object.freeze([
  'workflow_run',
  'workflow_job',
  'pull_request',
  'check_suite',
  'check_run',
  'head_sha',
  'base_sha',
  'html_url',
  'issue_url',
  'repository',
  'sender',
  'installation',
]);

function validateBundleShape(bundle) {
  const errors = [];
  const err = (path, message) => errors.push({ path, message });

  if (bundle.schema_version !== BUNDLE_SCHEMA_VERSION) err('$.schema_version', `must be "${BUNDLE_SCHEMA_VERSION}"`);
  if (typeof bundle.normalization_version !== 'string' || bundle.normalization_version.length === 0) {
    err('$.normalization_version', 'required');
  }
  if (typeof bundle.collector_version !== 'string' || bundle.collector_version.length === 0) {
    err('$.collector_version', 'required');
  }
  if (!Array.isArray(bundle.records) || bundle.records.length === 0) {
    err('$.records', 'must be a non-empty array');
    return errors;
  }

  bundle.records.forEach((record, i) => {
    const p = `records[${i}]`;
    if (record.record_type !== 'agentic_task') err(`${p}.record_type`, 'must be "agentic_task"');
    if (typeof record.task_id !== 'string' || record.task_id.length === 0) err(`${p}.task_id`, 'required');
    if (!isIso(record.started_at)) err(`${p}.started_at`, 'ISO-8601 required');
    if ('ended_at' in record && record.ended_at !== null && !isIso(record.ended_at)) {
      err(`${p}.ended_at`, 'ISO-8601 or null');
    }
    if ('aborted_at' in record && record.aborted_at !== null && !isIso(record.aborted_at)) {
      err(`${p}.aborted_at`, 'ISO-8601 or null');
    }
    if (!OUTCOME_STATUSES.includes(record.outcome?.status)) err(`${p}.outcome.status`, 'canonical vocabulary');
    if (!Array.isArray(record.executions) || record.executions.length === 0) {
      err(`${p}.executions`, 'non-empty array required');
      return;
    }
    const ids = new Set();
    record.executions.forEach((execution, j) => {
      const ep = `${p}.executions[${j}]`;
      if (typeof execution.execution_id !== 'string' || execution.execution_id.length === 0) {
        err(`${ep}.execution_id`, 'required');
      } else if (ids.has(execution.execution_id)) {
        err(`${ep}.execution_id`, `duplicate "${execution.execution_id}"`);
      } else {
        ids.add(execution.execution_id);
      }
      if (typeof execution.agent?.family !== 'string' || execution.agent.family.length === 0) {
        err(`${ep}.agent.family`, 'required');
      }
      if (!('model_class' in (execution.agent ?? {}))) err(`${ep}.agent.model_class`, 'required');
      if (!isIso(execution.started_at)) err(`${ep}.started_at`, 'ISO-8601 required');
      if ('ended_at' in execution && execution.ended_at !== null && !isIso(execution.ended_at)) {
        err(`${ep}.ended_at`, 'ISO-8601 or null');
      }
      let representableSum = 0;
      const componentKeys = Object.keys(execution.components ?? {});
      if (componentKeys.length === 0) err(`${ep}.components`, 'at least one entry required');
      for (const key of componentKeys.sort()) {
        const c = execution.components[key];
        const cp = `${ep}.components.${key}`;
        if (!COMPONENT_KEYS.includes(key)) {
          err(cp, `unknown component "${key}"`);
          continue;
        }
        if (!COST_BASES.includes(c?.basis)) {
          err(`${cp}.basis`, 'measured|estimated|unavailable');
          continue;
        }
        if (c.basis === 'unavailable') {
          if (c.amount_micro_usd !== null) err(`${cp}.amount_micro_usd`, 'must be null when unavailable');
        } else if (!Number.isInteger(c.amount_micro_usd) || c.amount_micro_usd < 0) {
          err(`${cp}.amount_micro_usd`, 'non-negative integer required');
        } else {
          representableSum += c.amount_micro_usd;
        }
      }
      if (!Number.isInteger(execution.total_amount_micro_usd) || execution.total_amount_micro_usd < 0) {
        err(`${ep}.total_amount_micro_usd`, 'non-negative integer required');
      } else if (execution.total_amount_micro_usd !== representableSum) {
        err(`${ep}.total_amount_micro_usd`, `accounting invariant violated (${execution.total_amount_micro_usd} != ${representableSum})`);
      }
      if ('tokens' in execution && execution.tokens !== null) {
        err(`${ep}.tokens`, 'read-only GitHub evidence cannot observe tokens; must stay absent');
      }
      if ('failure_category' in execution && execution.failure_category !== null && !FAILURE_CATEGORIES.includes(execution.failure_category)) {
        err(`${ep}.failure_category`, 'canonical vocabulary or absent');
      }
      for (const refField of ['retry_of_execution_id', 'superseded_by_execution_id']) {
        const ref = execution[refField];
        if (ref !== undefined && (!ids.has(ref) || ref === execution.execution_id)) {
          err(`${ep}.${refField}`, 'must reference another execution of the same task');
        }
      }
    });
  });

  // Raw-provider payload scan: any banned KEY anywhere -> not normalized.
  scanKeys(bundle, '$');
  function scanKeys(node, path) {
    if (Array.isArray(node)) {
      node.forEach((item, i) => scanKeys(item, `${path}[${i}]`));
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const key of Object.keys(node)) {
      if (RAW_PROVIDER_MARKERS.includes(key)) err(`${path}.${key}`, `raw provider field "${key}" detected`);
      else scanKeys(node[key], `${path}.${key}`);
    }
  }

  return errors;
}

function isIso(v) {
  return typeof v === 'string' && v.length > 0 && Number.isFinite(Date.parse(v));
}

/** Expected micro-USD for the shared fixture usage at the fixture rate. */
function expectedMicroUsd(billableMs) {
  return Math.round((billableMs * FIXTURE_RATE_USD_PER_MINUTE * MICROS_PER_USD) / 60_000);
}

function fixtureCostSource() {
  return actionsUsageCostSource({ usageByAttempt: fixtureUsageRecords(), rateUsdPerMinute: FIXTURE_RATE_USD_PER_MINUTE });
}

// --- tests ---------------------------------------------------------------------

test('fixture evidence produces a valid schema-v2 bundle without credentials', () => {
  const bundle = buildNormalizedBundle(fixtureEvidence(), { costSource: fixtureCostSource() });

  assert.equal(bundle.schema_version, '2');
  assert.equal(bundle.normalization_version, NORMALIZATION_VERSION);
  assert.equal(bundle.collector_version, COLLECTOR_VERSION);

  const errors = validateBundleShape(bundle);
  assert.deepEqual(errors, [], `bundle violates the seam-A contract: ${JSON.stringify(errors, null, 2)}`);

  // PR #101 merged, #102 closed-unmerged, #103 open; #110 excluded non-agentic.
  assert.equal(bundle.records.length, 3);
  assert.deepEqual(
    bundle.records.map((r) => r.task_id),
    ['t:pr:101', 't:pr:102', 't:pr:103']
  );
});

test('outcome attribution follows delivery evidence, never guesses success', () => {
  const bundle = buildNormalizedBundle(fixtureEvidence(), { costSource: fixtureCostSource() });
  const [merged, closedUnmerged, open] = bundle.records;

  assert.equal(merged.outcome.status, 'accepted');
  assert.equal(merged.ended_at, '2026-07-04T08:15:00Z');

  assert.equal(closedUnmerged.outcome.status, 'aborted');
  assert.equal(closedUnmerged.aborted_at, '2026-07-06T12:00:00Z');
  assert.equal(closedUnmerged.ended_at, '2026-07-06T12:00:00Z');

  assert.equal(open.outcome.status, 'unresolved');
  assert.equal(open.ended_at, undefined);
  assert.equal(open.aborted_at, undefined);
});

test('executions mirror observed revisions with honest cost components', () => {
  const bundle = buildNormalizedBundle(fixtureEvidence(), { costSource: fixtureCostSource() });
  const merged = bundle.records.find((r) => r.task_id === 't:pr:101');

  // Three revisions -> three executions in commit order.
  assert.equal(merged.executions.length, 3);
  const [rev1, rev2, rev3] = merged.executions;

  assert.ok(rev1.execution_id.startsWith('t:pr:101:rev:'));
  assert.equal(rev1.started_at, '2026-07-01T09:05:00Z');
  assert.equal(rev1.ended_at, '2026-07-02T10:00:00Z'); // replaced by r2 commit time
  assert.equal(rev3.started_at, '2026-07-03T11:30:00Z');
  assert.equal(rev3.ended_at, '2026-07-04T08:15:00Z'); // merge time

  // Inference/tools/compute are unobservable read-only: unavailable, never estimated.
  for (const execution of merged.executions) {
    for (const key of ['inference', 'tools', 'compute']) {
      assert.deepEqual(execution.components[key], { basis: 'unavailable', amount_micro_usd: null }, key);
    }
  }

  // Usage exists ONLY for run 9001 attempts 1+2 (both bound to revision r2):
  // 900000ms + 840000ms at the fixture rate.
  assert.deepEqual(rev1.components.ci, { basis: 'unavailable', amount_micro_usd: null });
  assert.deepEqual(rev2.components.ci, {
    basis: 'measured',
    amount_micro_usd: expectedMicroUsd(900_000) + expectedMicroUsd(840_000),
  });
  assert.equal(rev2.total_amount_micro_usd, expectedMicroUsd(900_000) + expectedMicroUsd(840_000));
  assert.deepEqual(rev3.components.ci, { basis: 'unavailable', amount_micro_usd: null });

  // No waste relations are fabricated from revision succession.
  for (const execution of merged.executions) {
    assert.equal(execution.superseded_by_execution_id, undefined);
    assert.equal(execution.retry_of_execution_id, undefined);
    assert.equal(execution.work_signature, undefined);
  }
});

test('agent family is evidenced for measured tasks and unknown for inferred ones', () => {
  const bundle = buildNormalizedBundle(fixtureEvidence(), { costSource: fixtureCostSource() });
  const measured = bundle.records.find((r) => r.task_id === 't:pr:101'); // bot allowlist
  const inferred = bundle.records.find((r) => r.task_id === 't:pr:102'); // branch prefix only

  assert.equal(measured.executions[0].agent.family, 'forge-bot[bot]');
  assert.equal(inferred.executions[0].agent.family, 'unknown');
  for (const record of bundle.records) {
    for (const execution of record.executions) {
      assert.equal(execution.agent.model_class, 'unknown');
    }
  }
});

test('pending/unlinked/excluded CI never contributes money or fabricates bindings', () => {
  const bundle = buildNormalizedBundle(fixtureEvidence(), { costSource: fixtureCostSource() });
  const stats = bundle.collection_stats;

  // 9004 in_progress -> pending; 9003 foreign branch; 9005 neutral conclusion.
  assert.equal(stats.ci_runs_seen, 6);
  assert.equal(stats.ci_runs_pending_not_terminal, 1);
  assert.equal(stats.ci_runs_excluded_by_reason['no_agentic_pr_link'], 1);
  assert.equal(stats.ci_runs_excluded_by_reason['unmapped_ci_conclusion:neutral'], 1);
  assert.equal(stats.ci_runs_cost_known, 2); // 9001@a1 + 9001@a2
  assert.equal(stats.cost_dropped_unattributable, 0);

  const open = bundle.records.find((r) => r.task_id === 't:pr:103');
  const closed = bundle.records.find((r) => r.task_id === 't:pr:102');
  for (const record of [open, closed]) {
    for (const execution of record.executions) {
      assert.deepEqual(execution.components.ci, { basis: 'unavailable', amount_micro_usd: null });
      assert.equal(execution.total_amount_micro_usd, 0);
    }
  }
});

test('known cost with unprovable revision binding rolls up to its own task only', () => {
  // Branch-matched run whose head SHA is foreign to every ingested revision
  // (force-push lost the original head). Its measured money must still appear
  // — on the task's final execution — and be counted explicitly.
  const foreignSha = sha.unrelated;
  const evidence = fixtureEvidence();
  evidence.workflowRuns = [
    ...evidence.workflowRuns,
    {
      id: 9100,
      run_attempt: 1,
      status: 'completed',
      conclusion: 'success',
      head_branch: 'forge/gauge-cleanup', // matches exactly PR #102's head branch
      head_sha: foreignSha, // not one of #102's revisions
      run_started_at: '2026-07-05T11:00:00Z',
      updated_at: '2026-07-05T11:10:00Z',
      path: '.github/workflows/ci.yml@refs/heads/main',
      pull_requests: [],
    },
  ];
  const usage = new Map(fixtureUsageRecords());
  usage.set('9100@a1', { billable_ms: 300_000 });

  const bundle = buildNormalizedBundle(evidence, {
    costSource: actionsUsageCostSource({ usageByAttempt: usage, rateUsdPerMinute: FIXTURE_RATE_USD_PER_MINUTE }),
  });

  const closed = bundle.records.find((r) => r.task_id === 't:pr:102');
  assert.equal(closed.executions.length, 1);
  assert.deepEqual(closed.executions[0].components.ci, { basis: 'measured', amount_micro_usd: expectedMicroUsd(300_000) });
  assert.equal(bundle.collection_stats.ci_cost_task_level_rollup_components, 1);
  assert.equal(bundle.collection_stats.ci_cost_task_level_rollup_micro_usd_total, expectedMicroUsd(300_000));

  // No leakage into other tasks.
  const merged = bundle.records.find((r) => r.task_id === 't:pr:101');
  const totals = merged.executions.map((e) => e.total_amount_micro_usd);
  assert.deepEqual(totals, [0, expectedMicroUsd(900_000) + expectedMicroUsd(840_000), 0]);
});

test('task with no observable revisions falls back to one span execution', () => {
  const evidence = fixtureEvidence();
  evidence.commitsByPull = new Map([...evidence.commitsByPull].filter(([n]) => n !== 102));

  const bundle = buildNormalizedBundle(evidence, { costSource: unknownEverythingCostSource() });
  const closed = bundle.records.find((r) => r.task_id === 't:pr:102');

  assert.equal(bundle.collection_stats.executions_span_fallback, 1);
  assert.equal(closed.executions.length, 1);
  assert.equal(closed.executions[0].execution_id, 't:pr:102:span');
  assert.equal(closed.executions[0].started_at, '2026-07-05T10:00:00Z'); // PR created_at
  assert.equal(closed.executions[0].ended_at, '2026-07-06T12:00:00Z');
  assert.deepEqual(closed.executions[0].components.ci, { basis: 'unavailable', amount_micro_usd: null });
});

test('default cost source keeps everything honestly unknown', () => {
  const bundle = buildNormalizedBundle(fixtureEvidence());
  for (const record of bundle.records) {
    for (const execution of record.executions) {
      assert.equal(execution.total_amount_micro_usd, 0);
      assert.deepEqual(execution.components.ci, { basis: 'unavailable', amount_micro_usd: null });
    }
  }
  assert.equal(bundle.collection_stats.ci_runs_cost_unknown, 3); // 9001@a1, 9001@a2, 9002
});

test('bundle is deterministic, frozen, and survives a JSON round-trip unchanged', () => {
  const once = buildNormalizedBundle(fixtureEvidence(), { costSource: fixtureCostSource() });
  const twice = buildNormalizedBundle(fixtureEvidence(), { costSource: fixtureCostSource() });

  const jsonOnce = JSON.stringify(once);
  assert.equal(jsonOnce, JSON.stringify(twice), 'same evidence must yield byte-identical bundles');

  assert.ok(Object.isFrozen(once));
  assert.doesNotThrow(() => JSON.parse(jsonOnce), 'bundle must be JSON-clean (no Maps/Sets/cycles)');
  const revived = JSON.parse(jsonOnce);
  assert.deepEqual(revived, once);
  assert.deepEqual(validateBundleShape(revived), []);
});

test('repository coordinates and raw provider markers never enter the bundle', () => {
  const bundle = buildNormalizedBundle(fixtureEvidence(), { costSource: fixtureCostSource() });
  const serialized = JSON.stringify(bundle);

  assert.ok(!serialized.includes(OWNER), 'owner must not appear anywhere in the bundle');
  assert.ok(!serialized.includes(REPO), 'repo name must not appear anywhere in the bundle');
  assert.deepEqual(validateBundleShape(bundle), []);

  // Belt-and-braces: walk keys directly (string scan could miss nothing here,
  // but the explicit walk documents intent).
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node !== null && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        assert.ok(!RAW_PROVIDER_MARKERS.includes(key), `forbidden raw provider key "${key}"`);
        visit(value);
      }
    }
  };
  visit(bundle);
});

test('collection stats report truncation notes from the collector sweep', () => {
  const evidence = fixtureEvidence();
  evidence.collection = { truncated: { pullRequests: true, workflowRuns: true, checkShas: false } };
  const bundle = buildNormalizedBundle(evidence);
  assert.ok(bundle.collection_stats.notes.some((n) => n.includes('maxPrPages')));
  assert.ok(bundle.collection_stats.notes.some((n) => n.includes('maxRunPages')));
  assert.equal(bundle.collection_stats.prs_ingested_measured, 2);
  assert.equal(bundle.collection_stats.prs_ingested_inferred, 1);
  assert.equal(bundle.collection_stats.prs_excluded_non_agentic, 1);
});

// --- full-pipeline e2e (WC-002 acceptance through the NEW seam) ----------------

test('e2e: in-memory GitHub -> collectHistory -> buildNormalizedBundle (no credentials)', async () => {
  const { collectHistory } = await import('../src/collect/history.js');
  const { createGithubRestClient } = await import('../src/collect/client.js');
  const { OWNER: owner, REPO: repo, BOT_ACTOR } = await import('./fixtures/synthetic-repo.js');

  const prs = fixtureEvidence().prs;
  const commits = fixtureEvidence().commitsByPull;
  const runs = fixtureEvidence().workflowRuns;
  const checks = fixtureEvidence().checkRunsBySha;

  const seenMethods = [];
  const client = createGithubRestClient({
    // No token anywhere: fixture mode stays credential-free.
    fetchImpl: async (url, init) => {
      seenMethods.push(init.method);
      const u = new URL(url);
      const p = u.pathname;
      const json = p.endsWith(`/repos/${owner}/${repo}/pulls`)
        ? prs
        : /\/pulls\/(\d+)\/commits$/.test(p)
          ? (commits.get(Number(p.match(/(\d+)\/commits$/)[1])) ?? [])
          : p.endsWith('/actions/runs')
            ? { workflow_runs: runs }
            : /\/commits\/([0-9a-f]+)\/check-runs$/.test(p)
              ? { check_runs: checks.get(p.match(/commits\/([0-9a-f]+)\/check-runs$/)[1]) ?? [] }
              : null;
      return { status: json === null ? 404 : 200, headers: {}, json };
    },
  });

  const evidence = await collectHistory({
    repoConfig: { owner, repo },
    policy: { botActors: [BOT_ACTOR], branchPrefixes: ['forge/'] },
    client,
  });
  assert.ok(seenMethods.length > 0);
  assert.ok(seenMethods.every((m) => m === 'GET'), 'the whole sweep must be read-only');

  const bundleJson = JSON.stringify(buildNormalizedBundle(evidence, { costSource: fixtureCostSource() }));
  const errors = validateBundleShape(JSON.parse(bundleJson));
  assert.deepEqual(errors, [], `collected evidence must produce a contract-valid bundle: ${JSON.stringify(errors)}`);
});
