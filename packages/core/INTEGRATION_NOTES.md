# @beetlejuice/core — integration notes (cycle 32936499446)

Status: this cycle rebuilds the core lane **from the integration base** on top
of the proven `f23510e` snapshot content and closes the one defect that still
blocked P0 #5 after last cycle's merge verification. Lane-level: **86/86**
tests green via root `npm test` (82 carried + 4 new X1 controls).

## Repairs landed (audit refs)

| Audit ref | Defect | Repair in this package | Regression test |
|-----------|--------|------------------------|-----------------|
| X1 / E14 (NEW this cycle) | duplicate-CI charged `confidence=certain` for a post-pass repeat whose own terminal status was FAILED — its explanation "Its result could not differ" was disproven by its own evidence | guard G5: if ANY recorded run in an equivalence-key × revision partition terminated non-passed (`failed`/`cancelled`/`timed_out`), determinism is empirically disproved for that partition and the WHOLE partition abstains (mirrors deterministic-retry G1/R1 group poisoning; also covers earlier disagreements such as failed→passed flips on identical keys) | `waste-dup-ci.test.js`: exact E14 replica, cancelled/timed_out variants, pre-pass disagreement control, sibling-partition scoping control |
| A2 / E9-E10 | findings lacked serialized `evidence_units[]`; product CLI rejected genuine core audit JSON | engine emits `evidence_units:[{ref,kind,micro_usd,quantified}]` per finding; new `exportCoreAudit()` / `buildCoreAuditExport()` produces the `beetlejuice_core_audit_export` v1 envelope | `core-audit-export.test.js` (incl. vendored consumer-identity mirror) |
| A3 / D1 / E11 | deterministic-retry charged the attempt that SUCCEEDED (`confidence=certain` on merged task) | guard G1: any same-key success ⇒ whole group abstains; successful attempts are never units | `waste-det-retry.test.js` (inverted M3 expectation + E11 replica) |
| A4 / D3 / E13 | duplicate-CI ignored `revision_key`, so config-only equivalence keys manufactured false certainty | runs compared only inside the same revision partition; differing revisions never compared | `waste-dup-ci.test.js` (E13 replica negative control) |
| A5 / D5 / E12 | `events()` returned the live internal array; callers could corrupt later audits | returns `Object.freeze([...internal])` | `tenant-isolation.test.js` |

Two prior tests had encoded the defective X1 behavior as expected output and
were corrected in the same commit: the multi-repeat dup-CI control now uses
three PASSED runs, and the waste-engine A2 seam fixture's second CI run is
now `passed` so it still exercises the evidence_units contract.

## Cross-seam compatibility of the X1 repair (verified)

- The synthetic core fixture contains no non-passed post-pass dup-CI scenario;
  `expected.json` economics are unchanged and byte-stable (asserted by tests).
- github lane `f23510e`/`3f88f34` fixture: workflow run 9001 attempts a1/a2
  are BOTH `success` ⇒ both map to `passed`; the $0.112 F-001 finding and
  E10/E11 probe economics survive unchanged. No committed github/product test
  asserts core rule output over a non-passed post-pass repeat, so mounting
  this package cannot shift any lane's committed expectations.
- Live probe executed against the real ledger + default rules: post-pass
  FAILED repeat → 0 findings / $0 avoidable; post-pass PASSED repeat → exactly
  one certain `WASTE_DUP_CI_V1` finding. Certain-only epistemics preserved in
  both directions.

## Cross-seam verification executed in previous cycles

Probes run against the REAL lane code from sibling snapshots (read-only, in
/tmp; not committed here):

1. github(`3b0f716`) `collectHistory → assembleAudit` → **this** ledger:
   23/23 events accepted unmodified, tasks `t:pr:101 accepted / t:pr:102
   failed / t:pr:103 unresolved`, `knownMicroUsd=232000`,
   `accountingBalanced=true`.
2. This ledger's `exportCoreAudit()` → github-era product validator
   (`8173d02`) `validateCoreAuditExport`: **ACCEPTED** (A2 closed end-to-end).
3. E11/E13 replicas against rebuilt rules: both abstain.

## Integration needs (not core-owned)

- Mount the proven four-lane merge on `lab/integration` (director, audit
  A-CAND). Core arrives X1-clean, so P0 #5 is no longer blocked at lane level.
- Wire `github collectHistory → TenantLedger.appendAll → ledger.audit() /
  exportCoreAudit() → report` as a committed cross-package e2e on the
  integration branch (audit A9). Core now guarantees the consumer contract.
- CI test-count guard prune list should ignore `.opencode` vendored dirs
  (audit A6/R6 — `.github/**`, not editable from this lane).
- Privacy producer-side mapping (tenant audit → `normalizeTenantRecord`
  inputs) remains open (audit A10); core exports are plain JSON and contain no
  raw provider payload keys by construction.

## Contract pins for sibling lanes

- Event schema is unchanged from eventSchemaVersion `'1'`; the github lane's
  `canonical.js` mirror stays byte-compatible without modification.
- Rule ids/versions unchanged (`WASTE_DUP_CI_V1` stays id+version 1): X1 was a
  repair toward the documented "certain" contract, not a new rule generation.
- Envelope requirements honored: `export_type`, `export_version:"1"`
  (string), optional `analysis_period {from_iso,to_iso}`, per-finding
  `evidence_units`, `recommendation` field name (product maps it to
  `recommended_action`), balanced-accounting gate (core refuses to export an
  unbalanced ledger itself).
