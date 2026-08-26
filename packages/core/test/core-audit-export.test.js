import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TenantLedger,
  CORE_AUDIT_EXPORT_TYPE,
  CORE_AUDIT_EXPORT_VERSION,
  buildCoreAuditExport,
  BeetlejuiceCoreError,
} from '../src/index.js';
import { buildSyntheticEvents } from '../fixtures/synthetic/generate.js';

const expected = JSON.parse(readFileSync(new URL('../fixtures/synthetic/expected.json', import.meta.url), 'utf8'));

/**
 * Vendored mirror of the DOWNSTREAM consumer contract for the
 * `beetlejuice_core_audit_export` envelope (seam B). The product CLI is the
 * authoritative validator; this mirror pins the exact requirements it enforces
 * (see docs: export_type/version, per-finding evidence_units, findings-sum,
 * totals-vs-tasks and cost-per-outcome identities, balanced accounting, ratio
 * identity, no raw provider payload keys) so the producer can never regress
 * silently. Repair A2 regression guard.
 */
function validateCoreAuditExportMirror(envelope) {
  const errors = [];
  const err = (path, message) => errors.push(`${path}: ${message}`);

  const RAW_PROVIDER_MARKERS = [
    'workflow_run', 'workflow_job', 'pull_request', 'check_suite', 'check_run',
    'head_sha', 'base_sha', 'html_url', 'issue_url', 'repository', 'sender', 'installation',
  ];
  const scan = (node, path) => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => scan(item, `${path}[${i}]`));
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    for (const key of Object.keys(node)) {
      if (RAW_PROVIDER_MARKERS.includes(key)) err(`${path}.${key}`, `raw provider payload field "${key}" detected`);
      else scan(node[key], `${path}.${key}`);
    }
  };

  if (envelope.export_type !== CORE_AUDIT_EXPORT_TYPE) err('$.export_type', `must be "${CORE_AUDIT_EXPORT_TYPE}"`);
  if (envelope.export_version !== CORE_AUDIT_EXPORT_VERSION) err('$.export_version', `must be "${CORE_AUDIT_EXPORT_VERSION}"`);
  scan(envelope, '$');

  const audit = envelope.audit;
  if (!audit || typeof audit !== 'object') {
    err('$.audit', 'audit object is required');
    return errors;
  }
  if (!Array.isArray(audit.tasks) || audit.tasks.length === 0) err('$.audit.tasks', 'tasks array required');
  if (!audit.waste || !Array.isArray(audit.waste.findings)) err('$.audit.waste.findings', 'findings array required');
  const summary = audit.summary;
  if (!summary || typeof summary !== 'object') {
    err('$.audit.summary', 'summary object is required');
    return errors;
  }

  const OUTCOME_STATUSES = ['accepted', 'failed', 'aborted', 'unresolved'];
  let maxLastTime = null;
  audit.tasks.forEach((task, i) => {
    const p = `$.audit.tasks[${i}]`;
    if (!task || typeof task.taskRef !== 'string') err(`${p}.taskRef`, 'non-empty taskRef required');
    else if (!OUTCOME_STATUSES.includes(task.outcome?.kind)) err(`${p}.outcome.kind`, 'canonical outcome vocabulary required');
    if (typeof task.lastTime === 'string') {
      if (maxLastTime === null || task.lastTime > maxLastTime) maxLastTime = task.lastTime;
    } else if (task.lastTime !== null && task.lastTime !== undefined) {
      err(`${p}.lastTime`, 'lastTime must be an ISO string or null');
    }
  });

  const cost = summary.cost;
  if (!cost || typeof cost !== 'object') err('$.audit.summary.cost', 'cost object required');
  else {
    if (cost.currency !== 'USD') err('$.audit.summary.cost.currency', 'must be USD');
    if (cost.unit !== 'micro_usd') err('$.audit.summary.cost.unit', 'must be micro_usd');
    if (!Number.isInteger(cost.knownMicroUsd) || cost.knownMicroUsd < 0) err('$.audit.summary.cost.knownMicroUsd', 'non-negative int required');
    if (cost.accountingBalanced !== true) err('$.audit.summary.cost.accountingBalanced', 'unbalanced ledger refused');
  }

  const totals = summary.totals;
  if (!totals || typeof totals !== 'object') err('$.audit.summary.totals', 'totals object required');
  else {
    for (const key of ['accepted', 'failed', 'aborted', 'unresolved']) {
      if (!Number.isInteger(totals[key]) || totals[key] < 0) err(`$.audit.summary.totals.${key}`, 'non-negative int required');
    }
    const attributed = totals.accepted + totals.failed + totals.aborted + totals.unresolved;
    if (Array.isArray(audit.tasks) && attributed !== audit.tasks.length) {
      err('$.audit.summary.totals', `attributed ${attributed} != tasks ${audit.tasks.length}`);
    }
    if (totals.accepted > 0 && cost && Number.isInteger(cost.knownMicroUsd)) {
      const expectedCpo = Math.round(cost.knownMicroUsd / totals.accepted);
      if (cost.costPerAcceptedOutcomeMicroUsd !== expectedCpo) {
        err('$.audit.summary.cost.costPerAcceptedOutcomeMicroUsd', `identity violated: expected ${expectedCpo}`);
      }
    } else if (totals.accepted === 0 && cost && cost.costPerAcceptedOutcomeMicroUsd !== null) {
      err('$.audit.summary.cost.costPerAcceptedOutcomeMicroUsd', 'must be null when no accepted outcomes');
    }
  }

  if (audit.waste && Array.isArray(audit.waste.findings)) {
    let findingsSum = 0;
    audit.waste.findings.forEach((finding, i) => {
      const p = `$.audit.waste.findings[${i}]`;
      if (typeof finding.rule_id !== 'string' || finding.rule_id.length === 0) err(`${p}.rule_id`, 'rule_id required');
      if (finding.confidence !== 'certain') err(`${p}.confidence`, 'only certain findings may appear');
      if (!Number.isInteger(finding.wasted_micro_usd) || finding.wasted_micro_usd < 0) {
        err(`${p}.wasted_micro_usd`, 'non-negative int required');
      } else {
        findingsSum += finding.wasted_micro_usd;
      }
      if (typeof finding.explanation !== 'string' || finding.explanation.length < 20) err(`${p}.explanation`, 'exact explanation required');
      if (typeof finding.recommendation !== 'string' || finding.recommendation.length < 10) err(`${p}.recommendation`, 'recommended action required');
      // A2: per-unit breakdown is REQUIRED.
      if (!Array.isArray(finding.evidence_units)) {
        err(`${p}.evidence_units`, 'evidence_units array is required (per-unit amount breakdown)');
      } else {
        finding.evidence_units.forEach((unit, ui) => {
          if (!unit || typeof unit.ref !== 'string') err(`${p}.evidence_units[${ui}].ref`, 'tenant-scope ref required');
          if (unit && (!Number.isInteger(unit.micro_usd) || unit.micro_usd < 0)) {
            err(`${p}.evidence_units[${ui}].micro_usd`, 'non-negative int required');
          }
        });
      }
    });
    if (Number.isInteger(audit.waste.certainlyAvoidableMicroUsd) && audit.waste.certainlyAvoidableMicroUsd !== findingsSum) {
      err('$.audit.waste.certainlyAvoidableMicroUsd', `identity violated: ${audit.waste.certainlyAvoidableMicroUsd} != sum ${findingsSum}`);
    }
    if (summary.waste && typeof summary.waste === 'object') {
      if (summary.waste.findingsCount !== audit.waste.findings.length) {
        err('$.audit.summary.waste.findingsCount', 'does not match number of findings');
      }
      if (
        Number.isInteger(summary.waste.certainlyAvoidableMicroUsd) &&
        summary.waste.certainlyAvoidableMicroUsd !== audit.waste.certainlyAvoidableMicroUsd
      ) {
        err('$.audit.summary.waste.certainlyAvoidableMicroUsd', 'does not match audit.waste value');
      }
      if (
        cost && Number.isInteger(cost.knownMicroUsd) && cost.knownMicroUsd > 0 &&
        Number.isInteger(audit.waste.certainlyAvoidableMicroUsd) &&
        typeof summary.waste.ratioOfKnownCost === 'number'
      ) {
        const expectedRatio = Math.round((audit.waste.certainlyAvoidableMicroUsd / cost.knownMicroUsd) * 1e6) / 1e6;
        if (Math.abs(summary.waste.ratioOfKnownCost - expectedRatio) > 1.5e-6) {
          err('$.audit.summary.waste.ratioOfKnownCost', 'identity violated vs certainlyAvoidable / known');
        }
      }
    }
  }

  if (envelope.analysis_period !== undefined && envelope.analysis_period !== null) {
    const ap = envelope.analysis_period;
    if (typeof ap.from_iso !== 'string' || Number.isNaN(Date.parse(ap.from_iso))) err('$.analysis_period.from_iso', 'ISO string or null required');
    if (typeof ap.to_iso !== 'string' || Number.isNaN(Date.parse(ap.to_iso))) err('$.analysis_period.to_iso', 'ISO string or null required');
  }

  return errors;
}

function fixtureEnvelope() {
  const ledger = new TenantLedger('fixture-tenant');
  ledger.appendAll(buildSyntheticEvents());
  return ledger.exportCoreAudit({ producer: 'test-suite' });
}

test('export envelope carries the exact type and version downstream consumers pin', () => {
  const envelope = fixtureEnvelope();
  assert.equal(envelope.export_type, 'beetlejuice_core_audit_export');
  assert.equal(envelope.export_version, '1'); // string, not number
  assert.equal(typeof envelope.producer, 'string');
});

test('the full fixture export passes every downstream identity check (A2 round-trip guard)', () => {
  const envelope = fixtureEnvelope();
  const errors = validateCoreAuditExportMirror(envelope);
  assert.deepEqual(errors, [], `consumer-side validation failed:\n${errors.join('\n')}`);
});

test('every exported finding carries evidence_units that sum exactly to its amount', () => {
  const envelope = fixtureEnvelope();
  assert.equal(envelope.audit.waste.findings.length, expected.waste.findingsCount);
  for (const finding of envelope.audit.waste.findings) {
    assert.ok(Array.isArray(finding.evidence_units));
    assert.equal(
      finding.evidence_units.reduce((a, u) => a + u.micro_usd, 0),
      finding.wasted_micro_usd
    );
  }
});

test('JSON round-trip is lossless: stringify -> parse -> revalidate stays green', () => {
  const envelope = fixtureEnvelope();
  const reparsed = JSON.parse(JSON.stringify(envelope));
  assert.deepEqual(reparsed, envelope);
  assert.deepEqual(validateCoreAuditExportMirror(reparsed), []);
});

test('analysis_period defaults to the observed evidence window and accepts overrides', () => {
  const derived = fixtureEnvelope();
  // Derived window = min/max of reconstructed task lastTime values.
  const ledger2 = new TenantLedger('fixture-tenant');
  ledger2.appendAll(buildSyntheticEvents());
  const times = ledger2.tasks().map((t) => t.lastTime).filter((t) => typeof t === 'string').sort();
  assert.equal(derived.analysis_period.from_iso, times[0]);
  assert.equal(derived.analysis_period.to_iso, times[times.length - 1]);
  assert.ok(times[0] <= times[times.length - 1]);

  const ledger = new TenantLedger('fixture-tenant');
  ledger.appendAll(buildSyntheticEvents());
  const overridden = ledger.exportCoreAudit({
    analysisPeriod: { fromIso: '2026-07-01T00:00:00Z', toIso: '2026-08-01T00:00:00Z' },
  });
  assert.deepEqual(overridden.analysis_period, { from_iso: '2026-07-01T00:00:00Z', to_iso: '2026-08-01T00:00:00Z' });
});

test('buildCoreAuditExport refuses to ship an unbalanced ledger instead of exporting a lie', () => {
  const fakeUnbalanced = {
    tasks: [],
    waste: { findings: [], certainlyAvoidableMicroUsd: 0 },
    summary: {
      totals: {},
      cost: { currency: 'USD', unit: 'micro_usd', knownMicroUsd: 100, accountingBalanced: false },
      waste: {},
      dataQuality: {},
    },
  };
  assert.throws(() => buildCoreAuditExport(fakeUnbalanced), (err) => err instanceof BeetlejuiceCoreError);
});

test('a zero-waste export validates cleanly (no findings is not an error)', () => {
  const ledger = new TenantLedger('t-clean');
  ledger.appendAll([
    { type: 'task_started', task_ref: 'T1', time: '2026-08-01T00:00:00Z', payload: {} },
    { type: 'model_invocation_recorded', task_ref: 'T1', payload: { invocation_ref: 'M1', status: 'ok', cost: { known: true, micro_usd: 42 } } },
    { type: 'pull_request_created', task_ref: 'T1', payload: { pr_ref: 'PR-T1' } },
    { type: 'pull_request_merged', task_ref: 'T1', payload: { pr_ref: 'PR-T1' } },
  ]);
  const envelope = ledger.exportCoreAudit();
  assert.equal(envelope.audit.waste.findings.length, 0);
  assert.deepEqual(validateCoreAuditExportMirror(envelope), []);
});
