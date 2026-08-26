// Explicitly versioned migration: legacy normalized-input draft v1 → v2.
//
// The v1 contract existed only on an unintegrated lane snapshot (no production
// consumers), but migration discipline is part of the engineering invariants:
// old fixtures/adapters migrate deterministically instead of being silently
// reinterpreted.
//
// v1 → v2 mapping:
// - schema_version "1" → "2";
// - outcome.status provider-flavored names → canonical AGENTIC_TASK attribution
//   vocabulary (pr_merged→accepted, pr_open→unresolved, task_failed→failed,
//   task_aborted→aborted);
// - integer cents → integer micro-USD (×10_000, always exact).
//
// normalization_version gains an explicit "+migrate-v1-to-v2" suffix so every
// downstream report can prove this bundle passed through the migrator.

import { V1_OUTCOME_STATUS_ALIASES } from "./schema.js";

const CENTS_PER_MICRO_USD_FACTOR = 10_000; // 1 cent = 10_000 µ$

/**
 * @param {object} v1Bundle parsed JSON of a legacy v1 normalized bundle
 * @returns {{ ok: boolean, errors: Array<{path:string,message:string}>, bundle: object|null }}
 */
export function migrateNormalizedBundleV1ToV2(v1Bundle) {
  const errors = [];
  const err = (path, message) => errors.push({ path, message });

  if (typeof v1Bundle !== "object" || v1Bundle === null || Array.isArray(v1Bundle)) {
    return { ok: false, errors: [{ path: "$", message: "legacy bundle must be a JSON object" }], bundle: null };
  }
  if (v1Bundle.schema_version !== "1") {
    err("$.schema_version", 'migrator expects legacy schema_version "1"');
  }
  if (!Array.isArray(v1Bundle.records) || v1Bundle.records.length === 0) {
    err("$.records", "legacy bundle must carry a non-empty records array");
    return { ok: false, errors, bundle: null };
  }

  const records = [];
  v1Bundle.records.forEach((record, ri) => {
    if (typeof record !== "object" || record === null || Array.isArray(record)) {
      err(`$.records[${ri}]`, "legacy record must be an object");
      return;
    }
    const legacyStatus = record.outcome?.status;
    const status = V1_OUTCOME_STATUS_ALIASES[legacyStatus];
    if (!status) {
      err(
        `$.records[${ri}].outcome.status`,
        `unknown legacy outcome status ${JSON.stringify(legacyStatus)}; expected one of ${Object.keys(V1_OUTCOME_STATUS_ALIASES).join(", ")}`
      );
    }
    let executions;
    try {
      executions = (record.executions ?? []).map((e, ei) => {
        if (typeof e !== "object" || e === null || Array.isArray(e)) {
          throw new Error(`executions[${ei}] must be an object`);
        }
        const components = {};
        for (const [key, comp] of Object.entries(e.components ?? {})) {
          components[key] = {
            ...comp,
            amount_micro_usd:
              comp && Object.prototype.hasOwnProperty.call(comp, "amount_cents")
                ? comp.amount_cents === null
                  ? null
                  : comp.amount_cents * CENTS_PER_MICRO_USD_FACTOR
                : comp?.amount_micro_usd ?? null,
          };
          delete components[key].amount_cents;
        }
        const next = { ...e, components };
        if (Object.prototype.hasOwnProperty.call(e, "total_amount_cents")) {
          next.total_amount_micro_usd =
            e.total_amount_cents === null ? null : e.total_amount_cents * CENTS_PER_MICRO_USD_FACTOR;
          delete next.total_amount_cents;
        }
        return next;
      });
    } catch (error) {
      err(`$.records[${ri}].executions`, error.message);
      return;
    }
    records.push({
      ...record,
      outcome: { ...(record.outcome ?? {}), ...(status ? { status } : {}) },
      executions,
    });
  });

  if (errors.length > 0) {
    return { ok: false, errors, bundle: null };
  }

  return {
    ok: true,
    errors: [],
    bundle: {
      ...v1Bundle,
      schema_version: "2",
      normalization_version: `${String(v1Bundle.normalization_version ?? "unknown")}+migrate-v1-to-v2`,
      records,
    },
  };
}
