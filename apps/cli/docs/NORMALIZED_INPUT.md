# Product-surface ingestion contracts (WC-005)

Version: 2 · Status: binding for WC-005 acceptance

The Beetlejuice product surface (`apps/cli`, future dashboard/server) consumes
**only** two kinds of versioned, vendor-neutral input. It never parses raw
provider payloads (GitHub Actions runs, PR objects, check runs…): any payload
carrying raw provider fields (`workflow_run`, `pull_request`, `head_sha`,
`html_url`, `repository`, …) anywhere in the input is **rejected** with exit
code 2. Adapters (GitHub is #1) must normalize before this boundary.

Two seams, ONE report model:

| Seam | Flag | Input | Economics computed by |
| --- | --- | --- | --- |
| normalized-input | `--input <file>` | adapter-normalized `agentic_task` bundle (schema v2) | this package |
| canonical-core | `--core-audit <file>` | versioned `packages/core` `TenantLedger.audit()` export | **packages/core** (consumed verbatim, never recomputed) |

---

## Seam A — normalized bundle envelope (schema_version `"2"`)

```json
{
  "schema_version": "2",
  "normalization_version": "<string>",
  "collector_version": "<string>",
  "records": [ /* agentic_task records */ ]
}
```

- `schema_version` — canonical schema version, currently `"2"`.
- `normalization_version` / `collector_version` — provenance; they appear in every report so results are reproducible.

### Producer-side helper (A7 seam contract)

The envelope is produced by a committed, tested helper in this package — the
contract is enforced by construction, not by prose. Two producers ship today:
this generic in-package helper (any adapter or tenant pipeline) and the GitHub
adapter's own evidence-driven producer (`@beetlejuice/github`
`buildNormalizedBundle`, described after the snippet). Both run the same
validator, so neither can emit an envelope the consumer would reject:

```js
import { buildNormalizedBundle } from "@beetlejuice/product-cli";

const bundle = buildNormalizedBundle(normalizedRecords, {
  collector_version: "my-adapter-1.2.0", // required provenance
  normalization_version: "1",
});
// bundle passes validateNormalizedBundle() or buildNormalizedBundle() threw
```

Guarantees (pinned by `test/bundle.test.js`):

- whatever `buildNormalizedBundle()` emits passes `validateNormalizedBundle()` —
  producer and consumer run the SAME validator, so seam drift cannot recur;
- raw provider payloads and broken cost-accounting invariants are refused with
  typed errors (`error.code === "INVALID_NORMALIZED_RECORDS"`,
  `error.validation_errors`);
- provenance fields are mandatory.

Producer status today (measured, not aspirational): the synthetic fixture
generator uses this contract, and any adapter can adopt the helper directly.
The **GitHub adapter ships a producer of this exact envelope**
(`@beetlejuice/github` `buildNormalizedBundle(evidence, { costSource? })`,
pinned by its own suite and by the committed cross-producer round-trip test
`test/integration/github-bundle-input-seam.test.js`, which feeds an
adapter-built envelope through `--input`). The one-command real GitHub path is
`npm run demo -- --github OWNER/REPO`, which wires
`collectHistory → TenantLedger → exportCoreAudit → --core-audit`-style
consumption internally (seam B) and is exercised end-to-end by
`test/integration/github-real-mode.test.js`.

## `agentic_task` record

Vendor-neutral per `docs/MASTER_PROMPT.md` §7. GitHub-specific concepts must be
resolved by the adapter; tenant-scope identifiers are allowed here because this
layer is Source/Tenant scope, not global learning data.

| Field | Required | Notes |
| --- | --- | --- |
| `record_type` | yes | must be `"agentic_task"` |
| `task_id` | yes | non-empty string, tenant scope |
| `started_at` / `ended_at` | started_at yes | ISO-8601 timestamps |
| `aborted_at` | when aborted | timestamp of objective disappearance |
| `source_adapter` | optional | `{ name, version }` provenance |
| `outcome.status` | yes | canonical AGENTIC_TASK attribution vocabulary: `accepted` \| `failed` \| `aborted` \| `unresolved` |
| `executions[]` | yes, ≥1 | see below |

Adapter mapping guidance for `outcome.status`: merged-PR evidence → `accepted`;
explicit terminal failure or closed-unmerged PR → `failed`; abort/objective
disappeared → `aborted`; anything else → `unresolved`. Never guess success.

**Known intentional divergence (audit SEAM-DIV).** For closed-without-merge
evidence the two committed producers deliberately disagree on vocabulary while
agreeing on economics: the GitHub adapter's *event* path (`assembleAudit` →
`TenantLedger`) attributes `failed` (a PR was explicitly closed without
merging), while its *normalized-bundle* path (`buildNormalizedBundle`)
attributes `aborted` (the objective disappeared without a terminal failure
signal). Both are conservative non-success attributions — neither is ever
counted as a successful outcome and both keep full cost visible — so reports
from the two seams may label such tasks differently by design.

## Execution

| Field | Required | Notes |
| --- | --- | --- |
| `execution_id` | yes | unique within the task |
| `agent.family` / `agent.model_class` | yes | abstract classes; exact vendor identity is not required |
| `started_at` / `ended_at` | started_at yes | ISO-8601 |
| `components` | yes, ≥1 | keys from `inference` \| `tools` \| `ci` \| `compute`; omit keys that did not occur |
| `components[k].basis` | yes | `measured` \| `estimated` \| `unavailable` |
| `components[k].amount_micro_usd` | yes | integer micro-usd (1 USD = 1_000_000 µ$); **must be `null` when basis is `unavailable`** |
| `total_amount_micro_usd` | yes | == sum of representable components (cost accounting invariant, enforced) |
| `tokens` | optional | `{ input, output }` — secondary diagnostics only |
| `work_signature` | optional | opaque tenant-local equivalence label used by waste rules |
| `failure_category` | optional | `deterministic` \| `transient` \| `flaky` \| `unknown` |
| `retry_of_execution_id` / `superseded_by_execution_id` | optional | must reference an execution in the same task |

## Cost semantics (seam A)

- Money math is exact integer **micro-USD** end-to-end — the single unit at rest,
  shared with `packages/core`. Reports round half-up to the cent only for display;
  sub-cent precision stays visible instead of being hidden.
- Measured and estimated amounts are reported separately and never merged silently.
- Unavailable components contribute $0 but are counted, so data quality is visible.

## Certain-waste rules consuming seam A

Each execution's cost is claimed at most once across rules (no double counting).
Ambiguous or contradictory evidence produces NO finding — by design. Rules that
changed semantics carry a bumped `rule_version`. Every finding also declares its
canonical `packages/core` rule class so reports never mix classification
vocabularies:

1. `SUPERSEDED_EXECUTION` v1.1.0 → class `WASTE_EXEC_SUPERSEDED_V1`.
   Requires a strictly-later replacement start (repair R4 of audit defect D4);
   contradictory/equal timing abstains and is counted in
   `waste_detection_meta.guards_abstained.replacement_not_started_strictly_later`.
2. `IDENTICAL_RETRY_AFTER_DETERMINISTIC_FAILURE` v1.2.0 → class `WASTE_DET_RETRY_V1`.
   Requires an identical `work_signature`, a deterministic prior failure AND a
   recorded failure on the retry itself. A retry that succeeded is NEVER waste
   (repair R2 of audit defect D2); abstentions counted as
   `retry_without_recorded_failure`. A retry whose own recorded failure mode is
   not itself `deterministic` is also NEVER charged (v1.2.0 repair EPI-1/RT-2,
   mirroring packages/core guard G4): observed mode-variance on supposedly
   identical inputs disqualifies the certainty premise; abstentions counted as
   `retry_mode_disagreement`.
3. `EXECUTION_AFTER_TASK_ABORT` v1.0.1 → class `null` (product-surface extension;
   no core equivalent yet). Executions starting strictly after `aborted_at`.
   The explanation claims "ran to completion" only when the execution recorded
   an `ended_at`; otherwise it rests on the start-after-abort evidence alone
   (audit WORD-1).

## Seam B — canonical-core audit export (`export_version` `"1"`)

```json
{
  "export_type": "beetlejuice_core_audit_export",
  "export_version": "1",
  "producer": "<provenance string>",
  "analysis_period": { "from_iso": "...", "to_iso": "..." },
  "audit": { "tasks": [...], "waste": {...}, "summary": {...} }
}
```

`audit` is the JSON serialization of `TenantLedger.audit()` (deep-frozen plain
data). All economics are consumed **verbatim** — costs, outcomes and waste are
never recomputed here. The validator checks shapes plus arithmetic identities
that must hold inside any honest audit output (findings sum =
`certainlyAvoidableMicroUsd` = `summary.waste.certainlyAvoidableMicroUsd`;
cost-per-accepted-outcome identity; outcome counts vs task aggregates) and
**refuses exports whose ledger accounting is not balanced**, so the product can
never publish a report off an unbalanced ledger. Findings keep their core rule
IDs (`WASTE_DET_RETRY_V1`, `WASTE_DUP_CI_V1`, `WASTE_EXEC_SUPERSEDED_V1`) and
gain display ids `F-xxx` while preserving the source id.

### Per-finding evidence shape (A2 seam contract)

Genuine `TenantLedger.audit()` serializations carry per-finding `evidence_refs`
(and optional `unquantified_evidence_refs`) but **no** per-unit
`evidence_units[]`. The surface therefore accepts BOTH shapes:

- findings WITH `evidence_units`: units are validated strictly — every unit must
  quantify `micro_usd` as a non-negative integer;
- findings WITHOUT `evidence_units` but with at least one evidence ref: accepted;
  the report attaches derived UNQUANTIFIED placeholder units
  (`{ ref, kind: "unspecified", micro_usd: null, quantified: false }`) and the
  data-quality section states how many findings lacked exported breakdowns. No
  amount is ever invented on this surface; the producer-certified
  `wasted_micro_usd` remains the single money truth.
- a certain-waste claim with NO evidence ref at all is rejected.

### Waste-ratio sanity note

When certainly avoidable spend covers ≥100% of representable spend, reports add
an explicit sanity note (JSON:
`headline.certainly_avoidable_spend_sanity_note`; markdown: "Sanity note:")
explaining that independent rules claimed disjoint, individually evidenced
waste. Rule composition can legitimately reach 100% on an accepted task; the
note keeps such reports defensible instead of silently implausible.

## Migrations

The legacy draft contract v1 (integer cents; provider-flavored statuses
`pr_merged/pr_open/task_failed/task_aborted`) existed only on an unintegrated
lane snapshot, but migration discipline applies:

```js
import { migrateNormalizedBundleV1ToV2 } from "@beetlejuice/product-cli";
const { ok, errors, bundle } = migrateNormalizedBundleV1ToV2(legacyV1Bundle);
// bundle.schema_version === "2"
// bundle.normalization_version ends with "+migrate-v1-to-v2"
```

Mapping: cents ×10_000 → micro-usd (always exact);
`pr_merged→accepted`, `pr_open→unresolved`, `task_failed→failed`,
`task_aborted→aborted`.

## Running an audit

```bash
npm run demo                                            # synthetic demo (no credentials)
npm run demo -- --input path/to/normalized-bundle.json  # seam A
npm run demo -- --core-audit path/to/core-export.json   # seam B
npm run demo -- --out apps/cli/out                      # writes audit-report.md/.json
```

No GitHub credentials are needed at this layer: credential handling belongs to
the GitHub adapter lane (`packages/github`, WC-002), which emits these inputs.
