/**
 * Versioned canonical-core audit export ("seam B" producer side, repair A2).
 *
 * Serializes `TenantLedger.audit()` output into the documented envelope:
 *
 *   {
 *     "export_type": "beetlejuice_core_audit_export",
 *     "export_version": "1",
 *     "producer": "<free text provenance>",
 *     "analysis_period": { "from_iso": "...", "to_iso": "..." } | omitted,
 *     "audit": { "tasks": [...], "waste": {...}, "summary": {...} }
 *   }
 *
 * Consumers validate: envelope type/version, per-finding evidence_units,
 * findings-sum identity, totals-vs-tasks identity, cost-per-outcome identity,
 * ratio identity and balanced ledger accounting. All of those identities hold
 * by construction here; the builder additionally refuses to export an
 * unbalanced ledger so a broken accounting can never silently reach a report.
 */
import { VERSIONS } from './versions.js';
import { ErrorCodes, schemaViolation } from './errors.js';

export const CORE_AUDIT_EXPORT_TYPE = 'beetlejuice_core_audit_export';
export const CORE_AUDIT_EXPORT_VERSION = '1';

/**
 * Build the plain-JSON export envelope for one audit result.
 *
 * @param {object} auditResult result of TenantLedger.audit()
 * @param {object} [options]
 * @param {string} [options.producer] free-text provenance for the consumer
 * @param {{ fromIso?: string|null, toIso?: string|null }} [options.analysisPeriod]
 *        explicit observation window (camelCase input, serialized as
 *        from_iso/to_iso); when omitted it is derived from task lastTime
 *        values and omitted entirely if no timestamps exist.
 */
export function buildCoreAuditExport(auditResult, { producer, analysisPeriod } = {}) {
  if (
    typeof auditResult !== 'object' ||
    auditResult === null ||
    !Array.isArray(auditResult.tasks) ||
    typeof auditResult.waste !== 'object' ||
    typeof auditResult.summary !== 'object'
  ) {
    throw schemaViolation(ErrorCodes.BAD_FIELD_TYPE, 'buildCoreAuditExport expects a TenantLedger.audit() result', {});
  }

  const summary = auditResult.summary;
  if (summary.cost?.accountingBalanced !== true) {
    throw schemaViolation(
      ErrorCodes.UNBALANCED_LEDGER,
      'refusing to export an unbalanced ledger (inference+tools+ci+compute+validation+human != total known cost)',
      { knownMicroUsd: summary.cost?.knownMicroUsd ?? null }
    );
  }

  const period = analysisPeriod
    ? {
        from_iso: analysisPeriod.fromIso ?? null,
        to_iso: analysisPeriod.toIso ?? null,
      }
    : deriveAnalysisPeriod(auditResult.tasks);
  const envelope = {
    export_type: CORE_AUDIT_EXPORT_TYPE,
    export_version: CORE_AUDIT_EXPORT_VERSION,
    producer: producer ?? `@beetlejuice/core ${VERSIONS.coreSchemaVersion}`,
    ...(period ? { analysis_period: period } : {}),
    audit: auditResult,
  };

  // Plain JSON in, plain JSON out: frozen structures serialize identically and
  // consumers receive a JSON-clean object they can stringify without surprises.
  return deepFreeze(JSON.parse(JSON.stringify(envelope)));
}

function deriveAnalysisPeriod(tasks) {
  const times = tasks.map((t) => t.lastTime).filter((t) => typeof t === 'string' && t.length > 0);
  if (times.length === 0) return null;
  times.sort();
  return { from_iso: times[0], to_iso: times[times.length - 1] };
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}
