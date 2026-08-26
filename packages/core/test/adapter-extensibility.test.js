import test from 'node:test';
import assert from 'node:assert/strict';
import { TenantLedger, rollupTaskCost } from '../src/index.js';

/**
 * WC-001 acceptance: "a second fictional adapter can map into the same model
 * without schema redesign."
 *
 * 'GitForge' is an invented platform (merge requests, pipelines). The adapter
 * below maps its webhook payloads into canonical events using ONLY the public
 * core API. Nothing in core knows or cares that GitForge — or GitHub — exists.
 */

function mapGitForgeWebhook(webhook) {
  // A real adapter would live in packages/github (or a future
  // packages/gitforge); this one is inlined to keep the acceptance self-contained.
  switch (webhook.kind) {
    case 'task.opened':
      return { type: 'task_started', task_ref: webhook.task_id, payload: {}, source: { adapter: 'gitforge', ref: `forge://event/${webhook.event_uid}` } };
    case 'llm.call':
      return {
        type: 'model_invocation_recorded',
        task_ref: webhook.task_id,
        execution_ref: webhook.session_id,
        payload: {
          invocation_ref: webhook.call_id,
          status: webhook.outcome === 'success' ? 'ok' : 'error',
          cost: { known: true, micro_usd: webhook.billing_units * 250 },
          model_class: 'frontier',
          ...(webhook.outcome !== 'success' ? { failure_class: webhook.error_code } : {}),
        },
        source: { adapter: 'gitforge' },
      };
    case 'pipeline.finished':
      return {
        type: 'ci_run_recorded',
        task_ref: webhook.task_id,
        payload: {
          ci_ref: webhook.pipeline_id,
          status: webhook.status === 'success' ? 'passed' : 'failed',
          cost: { known: true, micro_usd: webhook.minutes * 8000 },
          equivalence_key: `${webhook.sha}::${webhook.pipeline_def}`,
          // Adapter contract for duplicate-CI certainty (TRUST-1): duplicate
          // detection requires observed revision identity, so honest adapters
          // supply revision_key alongside their equivalence key.
          revision_key: webhook.sha,
        },
        source: { adapter: 'gitforge' },
      };
    case 'merge_request.merged':
      return { type: 'pull_request_merged', task_ref: webhook.task_id, payload: { pr_ref: webhook.mr_iid }, source: { adapter: 'gitforge' } };
    default:
      throw new Error(`unmapped webhook ${webhook.kind}`);
  }
}

test('a fictional second adapter feeds the same model with zero schema changes', () => {
  const ledger = new TenantLedger('tenant-forge');

  const webhooks = [
    { kind: 'task.opened', task_id: 'MR-771', event_uid: 'e1' },
    { kind: 'llm.call', task_id: 'MR-771', session_id: 'sess-9', call_id: 'c1', outcome: 'success', billing_units: 4 },
    { kind: 'pipeline.finished', task_id: 'MR-771', pipeline_id: 'pl-5', status: 'success', minutes: 3, sha: 's@1', pipeline_def: 'std' },
    { kind: 'merge_request.merged', task_id: 'MR-771', mr_iid: '771' },
  ];
  for (const wh of webhooks) ledger.append(mapGitForgeWebhook(wh));

  const task = ledger.reconstruct().get('MR-771');
  assert.equal(task.outcome.kind, 'accepted');
  assert.equal(task.adapters.join(','), 'gitforge');

  const rollup = rollupTaskCost(task);
  assert.equal(rollup.byKindMicroUsd.inference, 1000);
  assert.equal(rollup.byKindMicroUsd.ci, 24000);
  assert.equal(rollup.knownMicroUsd, 25000);

  const audit = ledger.audit();
  assert.equal(audit.summary.totals.accepted, 1);
  assert.equal(audit.summary.cost.costPerAcceptedOutcomeMicroUsd, 25000);
});

test('the fictional adapter can also produce certain-waste findings without special-casing', () => {
  const ledger = new TenantLedger('tenant-forge');
  const baseMs = Date.parse('2026-08-01T00:00:00Z');
  let n = 0;
  const at = (min) => new Date(baseMs + min * 60000).toISOString();
  const webhooks = [
    { kind: 'task.opened', task_id: 'MR-800', event_uid: 'f1' },
    { kind: 'pipeline.finished', task_id: 'MR-800', pipeline_id: 'pl-a', status: 'success', minutes: 5, sha: 's@2', pipeline_def: 'std' },
    // Same sha + definition re-run after the first finished: duplicated CI.
    { kind: 'pipeline.finished', task_id: 'MR-800', pipeline_id: 'pl-b', status: 'success', minutes: 5, sha: 's@2', pipeline_def: 'std' },
    { kind: 'merge_request.merged', task_id: 'MR-800', mr_iid: '800' },
  ];
  for (const wh of webhooks) {
    const event = mapGitForgeWebhook(wh);
    if (event.type === 'ci_run_recorded') {
      const start = n * 30;
      event.payload.started_at = at(start);
      event.payload.finished_at = at(start + 10);
      n += 1;
    }
    ledger.append(event);
  }

  const audit = ledger.audit();
  assert.equal(audit.summary.waste.findingsCount, 1);
  const finding = audit.waste.findings[0];
  assert.equal(finding.rule_id, 'WASTE_DUP_CI_V1');
  assert.deepEqual(finding.evidence_refs, ['pl-b']);
  assert.equal(finding.wasted_micro_usd, 40000);
});

test('the fictional adapter export passes the consumer envelope shape too', () => {
  const ledger = new TenantLedger('tenant-forge');
  ledger.append(mapGitForgeWebhook({ kind: 'task.opened', task_id: 'MR-900', event_uid: 'g1' }));
  ledger.append(mapGitForgeWebhook({ kind: 'llm.call', task_id: 'MR-900', session_id: 's1', call_id: 'c9', outcome: 'success', billing_units: 10 }));
  ledger.append(mapGitForgeWebhook({ kind: 'merge_request.merged', task_id: 'MR-900', mr_iid: '900' }));

  const envelope = ledger.exportCoreAudit();
  assert.equal(envelope.export_type, 'beetlejuice_core_audit_export');
  assert.equal(envelope.audit.summary.totals.accepted, 1);
  assert.equal(envelope.audit.summary.cost.accountingBalanced, true);
});
