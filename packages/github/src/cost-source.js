/**
 * Explicit cost-source adapters (WC-002).
 *
 * GitHub REST evidence alone almost never carries money: Actions usage is
 * exposed as billable milliseconds, and model/tool token spend is not
 * observable at all for third-party agents. This module therefore makes cost
 * provenance explicit instead of inventing numbers:
 *
 *   - measured : computed ONLY from operator-supplied evidence (usage
 *                records) multiplied by an explicitly configured rate.
 *   - unknown  : `{ known:false, reason }` with a precise reason string.
 *
 * Nothing in this package ever emits a guessed dollar amount.
 */
import { invalidConfig, AdapterErrorCodes } from './errors.js';

/** Money is accounted as integer micro-USD (1 USD = 1_000_000 µ$). */
export const MICROS_PER_USD = 1_000_000;

export const UNKNOWN_COST_REASONS = Object.freeze({
  NO_ACTIONS_USAGE_SUPPLIED: 'no actions usage record supplied by operator',
  NO_BILLABLE_MS: 'actions usage record lacks billable_ms',
  CHECK_RUNS_UNBILLED: 'github check runs expose no billing evidence',
  ACTIONS_JOBS_UNBILLED: 'no Actions job duration rate configured by operator',
  NO_JOB_DURATION: 'actions job lacks usable started_at/completed_at timing',
  JOB_COST_COVERED_BY_RUN_USAGE:
    'a run-level actions usage record already carries this attempt cost; job-level money would double-count',
});

/** Canonical unknown-cost object with a stable, explainable reason. */
export function unknownCost(reason) {
  if (typeof reason !== 'string' || reason.length === 0) {
    throw new TypeError('unknownCost requires a non-empty reason');
  }
  return Object.freeze({ known: false, reason });
}

/**
 * GitHub bills Actions per JOB, rounding each job's wall-clock time up to the
 * next whole minute. Convert observed elapsed milliseconds into billable
 * minutes under that documented model (pure arithmetic, no guessing).
 */
export function actionsJobBillableMinutes(elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw invalidConfig('elapsedMs must be a finite non-negative number', { code: AdapterErrorCodes.INVALID_CONFIG });
  }
  return Math.ceil(elapsedMs / 60_000);
}

/**
 * Convert Actions billable milliseconds + an explicit USD-per-minute rate
 * into integer micro-USD. Pure arithmetic; no network, no guessing.
 */
export function microUsdFromBillableMs(billableMs, usdPerMinute) {
  if (!Number.isFinite(billableMs) || billableMs < 0) {
    throw invalidConfig('billableMs must be a finite non-negative number', { code: AdapterErrorCodes.INVALID_CONFIG });
  }
  if (!Number.isFinite(usdPerMinute) || usdPerMinute <= 0) {
    throw invalidConfig('usdPerMinute must be a finite positive number', { code: AdapterErrorCodes.INVALID_CONFIG });
  }
  const microPerMs = (usdPerMinute * MICROS_PER_USD) / 60_000;
  return Math.round(billableMs * microPerMs);
}

/**
 * Cost source driven by operator-supplied Actions usage records:
 *   usageByAttempt: Map<"runId@a<attempt>", { billable_ms }>
 *   rateUsdPerMinute: contractual/computed rate the operator declares.
 *
 * Records without a matching entry resolve to honest unknowns.
 */
export function actionsUsageCostSource({ usageByAttempt, rateUsdPerMinute }) {
  if (!(usageByAttempt instanceof Map)) {
    throw invalidConfig('actionsUsageCostSource requires a Map keyed "runId@a<attempt>"', {});
  }
  return function resolveCost({ kind, runId, attempt }) {
    if (kind !== 'ci_workflow_run') {
      return { ...unknownCost(UNKNOWN_COST_REASONS.CHECK_RUNS_UNBILLED), provenance: 'unsupported-kind' };
    }
    const record = usageByAttempt.get(`${runId}@a${attempt}`);
    if (!record) {
      return { ...unknownCost(UNKNOWN_COST_REASONS.NO_ACTIONS_USAGE_SUPPLIED), provenance: 'actions_usage' };
    }
    const ms = record.billable_ms ?? record.billableMs;
    if (!Number.isFinite(ms)) {
      return { ...unknownCost(UNKNOWN_COST_REASONS.NO_BILLABLE_MS), provenance: 'actions_usage' };
    }
    return {
      known: true,
      micro_usd: microUsdFromBillableMs(ms, rateUsdPerMinute),
      provenance: 'measured:actions_billable_ms_x_configured_rate',
    };
  };
}

/** Source that reports everything as unknown with a fixed reason (default). */
export function unknownEverythingCostSource(reason = UNKNOWN_COST_REASONS.CHECK_RUNS_UNBILLED) {
  const frozenReason = unknownCost(reason);
  return () => ({ ...frozenReason, provenance: 'none' });
}

/**
 * Honest default for the audit/bundle/webhook seams: every evidence kind gets
 * ITS OWN precise "why is this unknown" reason instead of one generic label.
 * Measured money only ever comes from explicit operator-configured sources.
 */
export function unavailableEvidenceCostSource() {
  const byKind = Object.freeze({
    ci_workflow_run: unknownCost(UNKNOWN_COST_REASONS.NO_ACTIONS_USAGE_SUPPLIED),
    ci_workflow_job: unknownCost(UNKNOWN_COST_REASONS.ACTIONS_JOBS_UNBILLED),
  });
  const fallback = unknownCost(UNKNOWN_COST_REASONS.CHECK_RUNS_UNBILLED);
  return (req) => ({ ...(byKind[req?.kind] ?? fallback), provenance: 'none' });
}

/**
 * Resolve the billing multiplier for one Actions job from its runner labels.
 * First label present in the operator's table wins (case-insensitive); jobs
 * on unmatched runners default to 1x. Exported pure for tests.
 */
export function actionsJobMultiplier(labels, labelMultipliers) {
  const table = labelMultipliers ?? {};
  if (Array.isArray(labels)) {
    for (const raw of labels) {
      const key = typeof raw === 'string' ? raw.toLowerCase() : '';
      if (key && Object.prototype.hasOwnProperty.call(table, key)) {
        const m = Number(table[key]);
        return m;
      }
    }
  }
  return 1;
}

/**
 * THE sanctioned measured-cost wiring for GitHub Actions evidence.
 *
 * Two observable-evidence kinds, one consistent policy:
 *
 *   - `ci_workflow_run` — measured ONLY from an operator-supplied usage
 *     record (`billable_ms` per run attempt) times the declared rate
 *     (identical semantics to actionsUsageCostSource).
 *   - `ci_workflow_job` — Actions bills per JOB-minute; when the sweep
 *     collected job timing and the operator declared a rate, cost resolves as
 *         ceil(elapsed) billable minutes × rate × multiplier(first matching
 *         runner label in `labelMultipliers`, else 1)
 *     Jobs whose attempt ALREADY has a run-level usage record resolve to a
 *     precise unknown instead of money, so composing both evidence classes
 *     can never double-count BY CONSTRUCTION.
 *
 * Everything else resolves to honest unknowns. Nothing here guesses dollars.
 *
 * @param {object} p
 * @param {number} p.rateUsdPerMinute   operator-declared USD per billed minute
 * @param {Map<"runId@a<attempt>", {billable_ms}>} [p.usageByAttempt]
 * @param {Object<string,number>} [p.labelMultipliers] lowercase runner label -> multiplier (e.g. windows: 2)
 */
export function actionsMeasuredCostSource({ usageByAttempt, rateUsdPerMinute, labelMultipliers } = {}) {
  if (!Number.isFinite(rateUsdPerMinute) || rateUsdPerMinute <= 0) {
    throw invalidConfig('rateUsdPerMinute must be a finite positive number', {});
  }
  if (usageByAttempt !== undefined && !(usageByAttempt instanceof Map)) {
    throw invalidConfig('usageByAttempt must be a Map keyed "runId@a<attempt>"', {});
  }
  if (labelMultipliers !== undefined && (typeof labelMultipliers !== 'object' || labelMultipliers === null)) {
    throw invalidConfig('labelMultipliers must be an object of lowercase label -> positive multiplier', {});
  }
  if (labelMultipliers) {
    for (const [label, mult] of Object.entries(labelMultipliers)) {
      if (!Number.isFinite(mult) || mult <= 0) {
        throw invalidConfig(`labelMultipliers["${label}"] must be a finite positive number`, {});
      }
    }
  }

  return function resolveCost({ kind, runId, attempt, elapsedMs, labels }) {
    if (kind === 'ci_workflow_run') {
      const record = usageByAttempt?.get(`${runId}@a${attempt}`);
      if (!record) {
        return { ...unknownCost(UNKNOWN_COST_REASONS.NO_ACTIONS_USAGE_SUPPLIED), provenance: 'actions_usage' };
      }
      const ms = record.billable_ms ?? record.billableMs;
      if (!Number.isFinite(ms)) {
        return { ...unknownCost(UNKNOWN_COST_REASONS.NO_BILLABLE_MS), provenance: 'actions_usage' };
      }
      return {
        known: true,
        micro_usd: microUsdFromBillableMs(ms, rateUsdPerMinute),
        provenance: 'measured:actions_billable_ms_x_configured_rate',
      };
    }
    if (kind === 'ci_workflow_job') {
      // Double-count guard FIRST: the run-level record is authoritative when present.
      if (usageByAttempt?.has(`${runId}@a${attempt}`)) {
        return {
          ...unknownCost(UNKNOWN_COST_REASONS.JOB_COST_COVERED_BY_RUN_USAGE),
          provenance: 'actions_usage_guard',
        };
      }
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
        return { ...unknownCost(UNKNOWN_COST_REASONS.NO_JOB_DURATION), provenance: 'actions_job_duration' };
      }
      const minutes = actionsJobBillableMinutes(elapsedMs);
      const multiplier = actionsJobMultiplier(labels, labelMultipliers);
      return {
        known: true,
        micro_usd: Math.round(minutes * multiplier * rateUsdPerMinute * MICROS_PER_USD),
        provenance: 'measured:actions_job_billable_minutes_x_configured_rate',
      };
    }
    return { ...unknownCost(UNKNOWN_COST_REASONS.CHECK_RUNS_UNBILLED), provenance: 'unsupported-kind' };
  };
}

/**
 * Compose sources tried in order; first `known:true` wins, else the LAST
 * unknown answer is returned so its reason stays visible.
 */
export function composeCostSources(...sources) {
  return (req) => {
    let last = null;
    for (const src of sources) {
      const res = src(req);
      if (res.known === true) return res;
      last = res;
    }
    return last;
  };
}
