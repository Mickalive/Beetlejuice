# @beetlejuice/core

Vendor-neutral canonical economics for Beetlejuice: **AGENTIC_TASK** modeling,
cost accounting, outcome attribution and certain-waste detection. This package
knows nothing about GitHub or any other platform — providers connect only
through adapters that emit canonical events.

## Canonical flow

```
adapter events (vendor-neutral schema v1)
        │  TenantLedger.append / appendAll   (validate + stamp + freeze)
        ▼
tenant ledger  ──events()──► frozen snapshot
        │  reconstruct()
        ▼
AGENTIC_TASK aggregates (executions → components, conservative outcomes)
        │  audit()
        ├─► waste findings (certain-only, evidence-backed, no double counting)
        ├─► first-screen summary (total cost / accepted / cost per accepted outcome)
        ▼
exportCoreAudit()  →  beetlejuice_core_audit_export v1 envelope
```

## Guarantees

- **Versioned everywhere**: every stored event carries `schema_version`,
  `event_version`, `collector_version`, `normalization_version`; the export
  envelope is versioned (`export_version: "1"`).
- **Exact money**: integer micro-USD at rest; `inference + tools + ci +
  compute + validation + human === total known cost` is proven per audit
  (`accountingBalanced`). Unknown costs are counted, never guessed.
- **Honest zero-cost headlines**: `summary.cost.evidenceState` ∈ `measured` /
  `measured_zero` / `unmeasured` / `none_observed` is the canonical predicate
  distinguishing "genuinely measured $0.00" from "no measurable cost evidence
  supplied" (audit LIVE-REPORT-ZERO-DOLLARS). Surfaces must not render `$0.00`
  when the state is `unmeasured` or `none_observed`.
- **Conservative outcomes**: `accepted` requires merge evidence; open PRs stay
  `unresolved/partial`. Cost of failed/aborted/unresolved work stays visible in
  cost-per-accepted-outcome.
- **Certain waste only** (WC-004): a finding exists only when evidence makes
  waste demonstrable; every finding carries rule id/version, tenant-scope
  refs, serialized `evidence_units[]`, exact explanation, recommendation.
  Ambiguous evidence ⇒ no finding.
- **No double counting**: evidence units are claimed globally across rules;
  avoidable spend is the exact sum of accepted findings.
- **Tenant isolation by construction**: ledgers are instance-local; there is
  NO global customer/repo/developer identifier anywhere in this package.
- **Frozen views**: stored events, aggregates, analysis results and the
  `events()` snapshot cannot be mutated through returned references.

## Certain-waste rule boundaries

| Rule | Charges | Abstains when |
|------|---------|---------------|
| `WASTE_DUP_CI_V1` | CI re-runs started after an identical-key pass finished at the SAME observed revision, when every recorded run of that equivalence-key × revision partition passed | no equivalence key; absent `revision_key` (repair TRUST-1/G6: without observed revision identity "identical inputs" is unprovable — adapters must supply it); different revisions; overlapping timings; missing timestamps; ANY non-passed termination inside the partition (repair X1/G5: a post-pass repeat that failed/cancelled/timed out — or any earlier disagreement — empirically disproves "identical inputs cannot differ", so the whole partition is ambiguous) |
| `WASTE_DET_RETRY_V1` | attempts repeating an equivalence key after its first classified deterministic failure (`auth_error`, `permission_denied`, `invalid_request`, `billing_error`) when every later attempt reproduced that identical failure class | any same-key attempt succeeded (premise disproven); no equivalence key; transient/unclassified failures; the first failure itself; ANY post-premise attempt whose own failure mode disagrees with the established class — a different class (transient or a second "deterministic" one) is observable disproof of "identical inputs fail identically", so the whole group abstains (repair EPI-1/G4) |
| `WASTE_EXEC_SUPERSEDED_V1` | component costs of an execution explicitly superseded by a strictly later one | no supersession evidence; executions without components |
| `WASTE_EXEC_AFTER_ABORT_V1` | component costs of executions that STARTED strictly after the task's (last) `task_aborted` signal — work begun after the objective disappeared cannot contribute to any accepted outcome | resolved outcome is not exactly `aborted` (a later merge/failure/closed-PR is observable disproof of a vanished objective); execution started before or at the abort signal; unobservable event ordering (unstamped seq); components without an attached execution; nothing left after other rules claimed the units |

## Usage

```js
import { TenantLedger } from '@beetlejuice/core';

const ledger = new TenantLedger('opaque-local-scope');
ledger.appendAll(adapterEvents);          // raw canonical events

const audit = ledger.audit();
audit.summary.cost.knownMicroUsd;         // total measured spend
audit.summary.cost.evidenceState;         // 'measured'|'measured_zero'|'unmeasured'|'none_observed'
audit.summary.totals.accepted;            // successful outcomes
audit.summary.cost.costPerAcceptedOutcomeMicroUsd;
audit.waste.findings;                     // certain-waste, each with evidence_units[]

const envelope = ledger.exportCoreAudit({ producer: 'my-adapter' });
// JSON-safe `beetlejuice_core_audit_export` v1 for downstream report surfaces.
```

## Tests

```bash
npm test          # from packages/core or repo root
```

113 deterministic tests cover the event schema, reconstruction, the cost
identity and the cost-evidence states, conservative attribution, tenant
isolation, each rule's positive AND negative controls (including the X1
determinism-disproof battery for duplicate-CI, the EPI-1 mode-consistency
battery for retries and the terminal-consistency battery for post-abort
executions), fixture reproducibility and the export seam contract.
