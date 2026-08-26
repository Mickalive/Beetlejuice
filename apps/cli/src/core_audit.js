// Canonical-core ingestion (audit S1/R7 convergence path).
//
// Consumes a versioned export of packages/core `TenantLedger.audit()` output:
//
//   {
//     "export_type": "beetlejuice_core_audit_export",
//     "export_version": "1",
//     "producer": "<free text provenance>",
//     "analysis_period": { "from_iso": "...", "to_iso": "..." },  // optional
//     "audit": { "tasks": [...], "waste": {...}, "summary": {...} }
//   }
//
// ONE canonical model does the economics: this module NEVER recomputes costs,
// outcomes or waste. It only
//   (a) validates the shapes it consumes,
//   (b) re-checks arithmetic identities that must hold inside any honest audit
//       output (findings sum, ratio identity, cost-per-outcome identity),
//   (c) REFUSES exports whose ledger accounting is not balanced, so the
//       product can never publish a report off an unbalanced ledger.
//
// Raw provider payloads are rejected here too — same adapter boundary as the
// normalized-input seam.

import { OUTCOME_STATUSES } from "./schema.js";

export const CORE_AUDIT_EXPORT_TYPE = "beetlejuice_core_audit_export";
export const CORE_AUDIT_EXPORT_VERSION = "1";

const RAW_PROVIDER_MARKERS = Object.freeze([
  "workflow_run",
  "workflow_job",
  "pull_request",
  "check_suite",
  "check_run",
  "head_sha",
  "base_sha",
  "html_url",
  "issue_url",
  "repository",
  "sender",
  "installation",
]);

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInt(value) {
  return Number.isInteger(value) && value >= 0;
}

function isIsoDateString(value) {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function scanForRawProviderPayload(node, path, errors) {
  if (Array.isArray(node)) {
    node.forEach((item, i) => scanForRawProviderPayload(item, `${path}[${i}]`, errors));
    return;
  }
  if (!isPlainObject(node)) return;
  for (const key of Object.keys(node)) {
    if (RAW_PROVIDER_MARKERS.includes(key)) {
      errors.push({
        path: `${path}.${key}`,
        message: `raw provider payload field "${key}" detected; a canonical-core export must contain reconstructed AGENTIC_TASK aggregates, not provider payloads`,
      });
    } else {
      scanForRawProviderPayload(node[key], `${path}.${key}`, errors);
    }
  }
}

/**
 * Deterministically derive UNQUANTIFIED evidence units for a finding whose
 * producer did not serialize a per-unit breakdown (audit defect A2: genuine
 * `TenantLedger.audit()` JSON carries only `evidence_refs`).
 *
 * Honesty rules:
 * - derived units NEVER carry amounts (`micro_usd: null`, `quantified: false`);
 *   the finding's producer-certified `wasted_micro_usd` stays the single source
 *   of money truth and is rendered as-is;
 * - derivation is pure and order-preserving so reports stay byte-deterministic.
 *
 * @param {object} finding a canonical-core waste finding
 * @returns {Array<{ref: string, kind: string, micro_usd: null, quantified: false}>}
 */
export function deriveUnquantifiedEvidenceUnits(finding) {
  const refs = Array.isArray(finding?.evidence_refs) ? finding.evidence_refs : [];
  const unquantified = Array.isArray(finding?.unquantified_evidence_refs) ? finding.unquantified_evidence_refs : [];
  return [
    ...refs.map((ref) => ({ ref, kind: "unspecified", micro_usd: null, quantified: false })),
    ...unquantified.map((ref) => ({ ref, kind: "unspecified", micro_usd: null, quantified: false })),
  ];
}

/** Validate an optional array-of-strings ref field. Returns true when invalid. */
function invalidRefArray(value) {
  return !Array.isArray(value) || value.some((r) => typeof r !== "string");
}

/**
 * Validate a canonical-core audit export envelope.
 * @returns {{ ok: boolean, errors: Array<{path:string,message:string}>, audit: object|null }}
 */
export function validateCoreAuditExport(envelope) {
  const errors = [];
  const err = (path, message) => errors.push({ path, message });

  if (!isPlainObject(envelope)) {
    return { ok: false, errors: [{ path: "$", message: "core audit export must be a JSON object" }], audit: null };
  }
  if (envelope.export_type !== CORE_AUDIT_EXPORT_TYPE) {
    err("$.export_type", `must be "${CORE_AUDIT_EXPORT_TYPE}"`);
  }
  if (envelope.export_version !== CORE_AUDIT_EXPORT_VERSION) {
    err("$.export_version", `must be "${CORE_AUDIT_EXPORT_VERSION}"`);
  }

  // Provider-payload rejection happens FIRST so a smuggled raw object is always
  // reported even when the envelope is otherwise malformed.
  scanForRawProviderPayload(envelope, "$", errors);

  const audit = envelope.audit;
  if (!isPlainObject(audit)) {
    err("$.audit", "audit object is required");
    errors.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.message < b.message ? -1 : 1));
    return { ok: false, errors, audit: null };
  }
  if (!Array.isArray(audit.tasks) || audit.tasks.length === 0) {
    err("$.audit.tasks", "tasks array with at least one AGENTIC_TASK aggregate is required");
  }
  const waste = audit.waste;
  if (!isPlainObject(waste) || !Array.isArray(waste.findings)) {
    err("$.audit.waste.findings", "waste findings array is required");
  }
  const summary = audit.summary;
  if (!isPlainObject(summary)) {
    err("$.audit.summary", "summary object is required");
    errors.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.message < b.message ? -1 : 1));
    return { ok: false, errors, audit: null };
  }

  // --- tasks -------------------------------------------------------------
  let maxLastTime = null;
  if (Array.isArray(audit.tasks)) {
    audit.tasks.forEach((task, i) => {
      const p = `$.audit.tasks[${i}]`;
      if (!isPlainObject(task) || typeof task.taskRef !== "string" || task.taskRef.length === 0) {
        err(`${p}.taskRef`, "each task aggregate needs a non-empty taskRef");
        return;
      }
      const kind = task.outcome?.kind;
      if (!OUTCOME_STATUSES.includes(kind)) {
        err(
          `${p}.outcome.kind`,
          `outcome.kind must be one of ${OUTCOME_STATUSES.join(", ")} (canonical attribution vocabulary)`
        );
      }
      if (task.lastTime !== undefined && task.lastTime !== null && !isIsoDateString(task.lastTime)) {
        err(`${p}.lastTime`, "lastTime must be an ISO-8601 timestamp string or null");
      } else if (typeof task.lastTime === "string") {
        const t = Date.parse(task.lastTime);
        if (maxLastTime === null || t > Date.parse(maxLastTime)) maxLastTime = task.lastTime;
      }
    });
  }

  // --- summary.cost ------------------------------------------------------
  const cost = summary.cost;
  if (!isPlainObject(cost)) {
    err("$.audit.summary.cost", "summary.cost object is required");
  } else {
    if (cost.currency !== "USD") err("$.audit.summary.cost.currency", 'must be "USD"');
    if (cost.unit !== "micro_usd") err("$.audit.summary.cost.unit", 'must be "micro_usd"');
    if (!isNonNegativeInt(cost.knownMicroUsd)) {
      err("$.audit.summary.cost.knownMicroUsd", "knownMicroUsd must be a non-negative integer (micro-usd)");
    }
    if (cost.accountingBalanced !== true) {
      err(
        "$.audit.summary.cost.accountingBalanced",
        "core reports an UNBALANCED ledger (inference+tools+ci+compute+validation+human != total known); refusing to publish a report off an unbalanced ledger"
      );
    }
  }

  // --- totals ------------------------------------------------------------
  const totals = summary.totals;
  if (!isPlainObject(totals)) {
    err("$.audit.summary.totals", "summary.totals object is required");
  } else {
    for (const key of ["accepted", "failed", "aborted", "unresolved"]) {
      if (!isNonNegativeInt(totals[key])) err(`$.audit.summary.totals.${key}`, `${key} count must be a non-negative integer`);
    }
    if (
      isNonNegativeInt(totals.accepted) &&
      isNonNegativeInt(totals.failed) &&
      isNonNegativeInt(totals.aborted) &&
      isNonNegativeInt(totals.unresolved)
    ) {
      const attributed = totals.accepted + totals.failed + totals.aborted + totals.unresolved;
      if (Array.isArray(audit.tasks) && attributed !== audit.tasks.length) {
        err(
          "$.audit.summary.totals",
          `attributed outcome counts (${attributed}) do not match the number of task aggregates (${audit.tasks.length})`
        );
      }
      if (totals.accepted > 0 && cost && isNonNegativeInt(cost.knownMicroUsd)) {
        const expected = Math.round(cost.knownMicroUsd / totals.accepted);
        if (cost.costPerAcceptedOutcomeMicroUsd !== expected) {
          err(
            "$.audit.summary.cost.costPerAcceptedOutcomeMicroUsd",
            `identity violated: expected round(${cost.knownMicroUsd}/${totals.accepted}) = ${expected}`
          );
        }
      } else if (totals.accepted === 0 && cost?.costPerAcceptedOutcomeMicroUsd !== null) {
        err("$.audit.summary.cost.costPerAcceptedOutcomeMicroUsd", "must be null when there are no accepted outcomes");
      }
    }
  }

  // --- waste + findings --------------------------------------------------
  if (isPlainObject(waste) && Array.isArray(waste.findings)) {
    let findingsSum = 0;
    waste.findings.forEach((finding, i) => {
      const p = `$.audit.waste.findings[${i}]`;
      if (!isPlainObject(finding)) {
        err(p, "finding must be an object");
        return;
      }
      if (typeof finding.rule_id !== "string" || finding.rule_id.length === 0) err(`${p}.rule_id`, "rule_id is required");
      if (finding.confidence !== "certain") {
        err(`${p}.confidence`, 'only confidence "certain" findings may appear in a canonical-core export');
      }
      if (!isNonNegativeInt(finding.wasted_micro_usd)) {
        err(`${p}.wasted_micro_usd`, "wasted_micro_usd must be a non-negative integer (micro-usd)");
      } else {
        findingsSum += finding.wasted_micro_usd;
      }
      if (typeof finding.explanation !== "string" || finding.explanation.length < 20) {
        err(`${p}.explanation`, "an exact explanation is required for every certain-waste finding");
      }
      if (typeof finding.recommendation !== "string" || finding.recommendation.length < 10) {
        err(`${p}.recommendation`, "a concrete recommended action is required for every certain-waste finding");
      }
      // Evidence refs (present in every genuine core serialization) must be
      // string arrays when provided, under BOTH unit shapes.
      if (finding.evidence_refs !== undefined && invalidRefArray(finding.evidence_refs)) {
        err(`${p}.evidence_refs`, "evidence_refs must be an array of tenant-scope ref strings");
      }
      if (finding.unquantified_evidence_refs !== undefined && invalidRefArray(finding.unquantified_evidence_refs)) {
        err(`${p}.unquantified_evidence_refs`, "unquantified_evidence_refs must be an array of tenant-scope ref strings");
      }

      if (finding.evidence_units === undefined) {
        // A2 seam tolerance: genuine TenantLedger.audit() JSON serializes
        // evidence refs only. Accept the export when the per-unit breakdown is
        // derivable; the report then renders those units as explicitly
        // UNQUANTIFIED and flags the gap in its data-quality section — the
        // certified waste total itself is never invented here.
        const refsEmpty =
          !Array.isArray(finding.evidence_refs) ||
          (finding.evidence_refs.length === 0 &&
            !(Array.isArray(finding.unquantified_evidence_refs) && finding.unquantified_evidence_refs.length > 0));
        if (refsEmpty) {
          err(
            `${p}.evidence_units`,
            "evidence_units array or a non-empty evidence_refs/unquantified_evidence_refs set is required (a certain-waste claim without any evidence ref is not renderable)"
          );
        }
      } else {
        if (!Array.isArray(finding.evidence_units)) {
          err(`${p}.evidence_units`, "evidence_units must be an array when present (per-unit amount breakdown)");
        } else {
          finding.evidence_units.forEach((unit, ui) => {
            if (!isPlainObject(unit) || typeof unit.ref !== "string") {
              err(`${p}.evidence_units[${ui}].ref`, "each evidence unit needs a tenant-scope ref");
            }
            if (isPlainObject(unit) && !isNonNegativeInt(unit.micro_usd)) {
              err(`${p}.evidence_units[${ui}].micro_usd`, "producer-provided evidence units must quantify micro_usd as a non-negative integer");
            }
          });
        }
      }
    });

    if (
      isNonNegativeInt(waste.certainlyAvoidableMicroUsd) &&
      waste.certainlyAvoidableMicroUsd !== findingsSum
    ) {
      err(
        "$.audit.waste.certainlyAvoidableMicroUsd",
        `identity violated: certainlyAvoidableMicroUsd (${waste.certainlyAvoidableMicroUsd}) != sum of findings (${findingsSum})`
      );
    }
    if (isPlainObject(summary.waste)) {
      if (isNonNegativeInt(waste.certainlyAvoidableMicroUsd) && summary.waste.certainlyAvoidableMicroUsd !== undefined) {
        if (summary.waste.certainlyAvoidableMicroUsd !== waste.certainlyAvoidableMicroUsd) {
          err(
            "$.audit.summary.waste.certainlyAvoidableMicroUsd",
            "does not match audit.waste.certainlyAvoidableMicroUsd"
          );
        }
      }
      if (summary.waste.findingsCount !== waste.findings.length) {
        err(
          "$.audit.summary.waste.findingsCount",
          `does not match number of findings (${waste.findings.length})`
        );
      }
      if (
        isPlainObject(cost) &&
        isNonNegativeInt(cost.knownMicroUsd) &&
        cost.knownMicroUsd > 0 &&
        isNonNegativeInt(waste.certainlyAvoidableMicroUsd) &&
        typeof summary.waste.ratioOfKnownCost === "number"
      ) {
        const expectedRatio = Math.round((waste.certainlyAvoidableMicroUsd / cost.knownMicroUsd) * 1e6) / 1e6;
        if (Math.abs(summary.waste.ratioOfKnownCost - expectedRatio) > 1.5e-6) {
          err("$.audit.summary.waste.ratioOfKnownCost", "identity violated vs certainlyAvoidableMicroUsd / knownMicroUsd");
        }
      }
    }
  }

  // --- optional analysis_period -------------------------------------------
  if (envelope.analysis_period !== undefined && envelope.analysis_period !== null) {
    const ap = envelope.analysis_period;
    if (!isPlainObject(ap) || (ap.from_iso !== null && !isIsoDateString(ap.from_iso))) {
      err("$.analysis_period.from_iso", "from_iso must be an ISO-8601 timestamp string or null");
    }
    if (!isPlainObject(ap) || (ap.to_iso !== null && !isIsoDateString(ap.to_iso))) {
      err("$.analysis_period.to_iso", "to_iso must be an ISO-8601 timestamp string or null");
    }
  }

  errors.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.message < b.message ? -1 : 1));
  return { ok: errors.length === 0, errors, audit: errors.length === 0 ? audit : null };
}
