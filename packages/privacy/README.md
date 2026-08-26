# @beetlejuice/privacy

Executable privacy boundary for the Beetlejuice **Global Learning Dataset**.
The gate is code, not policy: nothing reaches a global export unless it
survives every stage below, and every export explains what the gate did.

## Design invariants

- **Unlinkable by default.** No stable or deterministic identifier of any
  customer/org/repo/developer/branch/commit/PR/issue/user may enter a record.
  Hashes and stable pseudonyms are **linkable**, not anonymous — they are
  rejected like any other identifier.
- **Closed world.** A `GlobalLearningRecord` (`glr/1`) contains exactly the
  allowlisted abstract fields with values from controlled vocabularies or
  published buckets. Unknown fields are rejected, never silently dropped.
- **Fail-closed.** Near-miss key names, prototype-chain keys (`__proto__`,
  `constructor`), exact timestamps, raw magnitudes, free text and secret-like
  content are all rejected with machine-readable reason codes.
- **No value echo.** Rejection reasons carry codes and field names only;
  offending *values* (especially secrets) never reappear in any envelope.
- **Deterministic + versioned.** Identical input yields byte-identical output.
  Every export embeds the ordered pipeline trace with per-step versions.

## Pipeline (all steps versioned in `src/versions.js`)

```
tenant observation
  1. input-normalization   strict input allowlist; bucket raw magnitudes;
                           classify raw agent/model names; reject forbidden,
                           unknown and timestamp keys; record generalization
                           provenance per field
  2. schema-validation     candidate must be a complete valid glr/1 record
  3. content-defense       scan every string for credential shapes, hashes,
                           UUIDs, URLs, paths, emails, IPs, PR refs,
                           oversized/multiline/high-entropy blobs
  4. cohort-suppression    group by full abstract combination (content only,
                           no join key); suppress groups smaller than the
                           effective cohort threshold
  5. purpose-binding       export under exactly ONE explicit consent purpose;
                           per-purpose minimum-cohort floors cannot be lowered
  6. risk-summary          deterministic privacy_risk block explaining
                           suppressed / generalized fields and gate activity
```

## From tenant audit to global record (`src/audit-mapping.js`)

Real audit data comes from the canonical core: `TenantLedger.audit()` emits
task aggregates full of linkable material — task/execution refs, revision
keys, PR refs, component refs, equivalence keys, adapter names, exact ISO
timestamps, detail strings that quote PR numbers.

`mapAuditTaskToPrivacyInput(taskAggregate, hints)` is the only sanctioned
bridge from that shape to the gate. It copies **only** numbers, booleans and
closed-vocabulary tokens:

- measured money only — components with `cost.known !== true` never fabricate
  a magnitude; known costs are integer micro-USD summed then converted;
- token totals derive ONLY when every model invocation reports both counters;
  partial coverage stays "unknown" rather than guessed;
- CI results generalize to `passed / failed / mixed / none`
  (cancelled/timed-out are failures at global granularity);
- outcomes map conservatively: accepted→`pr_merged`, accepted-but-reverted→
  `revert` (never claim acceptance for reverted work), failed→`task_failed`,
  aborted→`task_aborted`, unresolved→`task_started`. The merged-vs-closed
  distinction may carry identifiers and stays tenant-local;
- wall-clock durations are intentionally NOT derived (the aggregate's exact
  timestamps must never travel); records stay `duration_bucket: unknown`
  unless a tenant explicitly passes a pre-bucketed hint;
- semantic context arrives as validated hints (`task_class`,
  `language_family`, …). Hint keys go through the same fail-closed allowlist:
  a `repository_url` hint rejects the whole candidate downstream;
- structurally invalid aggregates throw instead of mapping garbage.

Versioned independently as `AUDIT_MAPPING_VERSION` (it runs tenant-side,
before the gate).

## The `glr/1` GlobalLearningRecord

Seventeen abstract dimensions: task class, language family, repo-size /
dependency-complexity / files-touched / cost / duration / token /
tool-call / retry buckets, agent family, model class, orchestration pattern,
CI result, human intervention flag, canonical outcome
(`pr_merged`, `task_aborted`, …). See `src/vocab.js` and `src/schema.js`.
There is no id, no timestamp, no free text and no hash anywhere in the schema.

## Privacy-risk result (`privacy_risk` in every envelope)

- `generalized_fields` — per field, how many normalized candidates were
  produced by `bucketed` (raw magnitude → range label), `classified`
  (raw name → coarse family/class) or `defaulted` (absent → coarse fallback).
  Fully explicit fields are omitted.
- `rejected_reasons` — aggregated rejection reason codes with counts,
  canonically ordered.
- `risk_level` — coarse operational signal derived only from gate outcomes:
  - `high`: identifier/content smuggling attempted and blocked
    (`forbidden_*` keys or `*_detected` content findings);
  - `medium`: the gate altered or dropped records (suppression or benign
    rejections);
  - `low`: everything admitted cleanly.

This is an operational signal about gate activity. It is **not** a claim of
anonymity and must never be presented as legal anonymization.

## Consent purposes (separate rights surfaces)

| Purpose | Min cohort | License acknowledgement |
| --- | --- | --- |
| `PRODUCT_TELEMETRY` | 5 | not required |
| `GLOBAL_BENCHMARK_CONTRIBUTION` | 5 | not required |
| `EXTERNAL_RESEARCH_DATA_LICENSING` | 25 | **required** |

Purpose is never inferred; it must be passed explicitly on every export.
Callers may raise a cohort threshold but never lower it below the floor.
Absolute minimum cohort for any purpose is 2.

## Usage

```js
import {
  exportGlobalLearningRecords,
  GLOBAL_BENCHMARK_CONTRIBUTION,
} from "@beetlejuice/privacy";

const result = exportGlobalLearningRecords({
  purpose: GLOBAL_BENCHMARK_CONTRIBUTION,
  records: [
    {
      task_class: "bug_fix",           // semantic classification is tenant-side
      language_family: "python",
      cost_usd: 3.2,                   // bucketed to "1_to_10"
      agent_name: "night-coding-agent" // classified to "cli_coding_agent"
    },
  ],
});
// result.counts / result.accepted / result.suppressed / result.rejected
// result.privacy_risk.generalized_fields / .rejected_reasons / .risk_level
// result.transformations — versioned pipeline trace
```

Tenant-audit producer side:

```js
import { mapAuditTaskToPrivacyInput } from "@beetlejuice/privacy";

const input = mapAuditTaskToPrivacyInput(auditResult.tasks[i], {
  task_class: "bug_fix",      // tenant-side semantic classification
  language_family: "python",
});
// feed `input`s into exportGlobalLearningRecords like any other record
```

Lower-level helpers (`normalizeTenantRecord`, `validateGlobalLearningRecord`,
`suppressRareCombinations`, `aggregateCohorts`, bucketing/classification/
content-scan functions) are exported from the package root.

## Tests

```sh
node --test        # from this directory, or `npm test` at the repo root
```

Coverage includes: schema closed-worldness, forbidden-key and timestamp
smuggling (including `__proto__`/`constructor` chain keys), raw magnitude
bucketing boundaries, content-defense detection of every fake sensitive
payload (assembled at runtime from harmless fragments — no credential-shaped
literal ever appears in this repository), rare-combination suppression and
cohort floors across purposes, tenant isolation/indistinguishability, join-key
absence, reproducibility/versioning, benchmark-surface economics, the
privacy-risk explanation block, and an end-to-end round trip from realistic
identifier-poisoned audit aggregates proving no ref, digest, PR number,
branch, adapter name or timestamp reaches the export.

## Non-goals

No global data lake, no cloud-exported raw-text classifier, no cross-customer
ML, and no claim of legal anonymity beyond what these tests demonstrate.
