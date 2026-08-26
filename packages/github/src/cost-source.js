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
});

/** Canonical unknown-cost object with a stable, explainable reason. */
export function unknownCost(reason) {
  if (typeof reason !== 'string' || reason.length === 0) {
    throw new TypeError('unknownCost requires a non-empty reason');
  }
  return Object.freeze({ known: false, reason });
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
