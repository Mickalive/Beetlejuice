/**
 * Certain-waste engine (WC-004).
 *
 * A finding is emitted ONLY when the observed evidence makes waste
 * demonstrable — never when evidence is ambiguous. Every finding carries:
 * rule id/version, tenant-scope evidence refs, measured wasted cost,
 * confidence class, an exact explanation and a recommended action.
 *
 * Double-count protection: evidence units are claimed globally across rules.
 * A unit already claimed by an earlier accepted finding is stripped from any
 * later candidate so `certainlyAvoidableMicroUsd` is always the exact sum of
 * non-overlapping accepted findings.
 *
 * Seam contract (repair A2): every finding serializes a per-unit
 * `evidence_units[]` breakdown — `{ ref, kind, micro_usd, quantified }` — so
 * downstream consumers (report/CLI) can render and re-verify each amount
 * without recomputing core economics. `quantified: false` units carry
 * `micro_usd: 0` and are additionally listed in `unquantified_evidence_refs`.
 */
import { DEFAULT_WASTE_RULES } from './rules/index.js';

export const CONFIDENCE_CERTAIN = 'certain';

/**
 * @param {Array} tasks reconstructed AGENTIC_TASK aggregates
 * @param {object} [options]
 * @param {Array} [options.rules] defaults to DEFAULT_WASTE_RULES order
 * @returns {{ findings: Array, certainlyAvoidableMicroUsd: number, claimedEvidenceRefs: string[] }}
 */
export function runWasteAnalysis(tasks, { rules } = {}) {
  const selected = rules ?? DEFAULT_WASTE_RULES;
  /** @type {Map<string, string>} claimed unit ref -> claiming rule id */
  const claimed = new Map();
  const findings = [];

  for (const task of tasks) {
    let perTaskIndex = 0;
    for (const rule of selected) {
      const candidates = rule.detect(task);
      for (const candidate of candidates) {
        // Strip units already attributed to another finding.
        const units = [];
        for (const unit of candidate.evidenceUnits) {
          if (!claimed.has(unit.ref)) {
            units.push(unit);
            claimed.set(unit.ref, rule.id);
          }
        }
        if (units.length === 0) continue;

        const wasted = units.reduce((acc, u) => acc + (u.microUsd ?? 0), 0);
        if (wasted <= 0 && units.every((u) => !u.unquantified)) continue;

        findings.push({
          finding_id: `${rule.id}/${task.taskRef}/${++perTaskIndex}`,
          rule_id: rule.id,
          rule_version: rule.version,
          task_ref: task.taskRef,
          confidence: CONFIDENCE_CERTAIN,
          wasted_micro_usd: wasted,
          evidence_refs: units.map((u) => u.ref),
          evidence_units: units.map((u) => ({
            ref: u.ref,
            kind: u.kind,
            micro_usd: u.microUsd ?? 0,
            quantified: !u.unquantified,
          })),
          unquantified_evidence_refs: units.filter((u) => u.unquantified).map((u) => u.ref),
          explanation:
            typeof candidate.explanation === 'function'
              ? candidate.explanation(units)
              : candidate.explanation,
          recommendation: candidate.recommendation,
        });
      }
    }
  }

  findings.sort((a, b) =>
    a.finding_id < b.finding_id ? -1 : a.finding_id > b.finding_id ? 1 : 0
  );
  return deepFreezeResult({
    findings,
    certainlyAvoidableMicroUsd: findings.reduce((acc, f) => acc + f.wasted_micro_usd, 0),
    claimedEvidenceRefs: [...claimed.keys()].sort(),
  });
}

function deepFreezeResult(result) {
  for (const finding of result.findings) {
    for (const unit of finding.evidence_units) Object.freeze(unit);
    Object.freeze(finding.evidence_units);
    Object.freeze(finding.evidence_refs);
    Object.freeze(finding.unquantified_evidence_refs);
    Object.freeze(finding);
  }
  Object.freeze(result.findings);
  return Object.freeze(result);
}
