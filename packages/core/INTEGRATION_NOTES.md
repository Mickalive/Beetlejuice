# @beetlejuice/core — integration notes (cycle 32936499446)

Status: this cycle rebuilds the core lane **from the integration base** on top
of the proven `f23510e` snapshot content and closes the one defect that still
blocked P0 #5 after last cycle's merge verification. Lane-level: **90/90**
tests green via root `npm test` (86 carried/corrected + 4 net-new controls).

## Repairs landed (audit refs)

| Audit ref | Defect | Repair in this package | Regression test |
|-----------|--------|------------------------|-----------------|
| X1 / E14 (landed prior cycle) | duplicate-CI charged `confidence=certain` for a post-pass repeat whose own terminal status was FAILED — its explanation "Its result could not differ" was disproven by its own evidence | guard G5: if ANY recorded run in an equivalence-key × revision partition terminated non-passed (`failed`/`cancelled`/`timed_out`), determinism is empirically disproved for that partition and the WHOLE partition abstains (mirrors deterministic-retry G1/R1 group poisoning; also covers earlier disagreements such as failed→passed flips on identical keys) | `waste-dup-ci.test.js`: exact E14 replica, cancelled/timed_out variants, pre-pass disagreement control, sibling-partition scoping control |
| A2 / E9-E10 (landed prior cycle) | findings lacked serialized `evidence_units[]`; product CLI rejected genuine core audit JSON | engine emits `evidence_units:[{ref,kind,micro_usd,quantified}]` per finding; new `exportCoreAudit()` / `buildCoreAuditExport()` produces the `beetlejuice_core_audit_export` v1 envelope | `core-audit-export.test.js` (incl. vendored consumer-identity mirror) |
| A3 / D1 / E11 (landed prior cycle) | deterministic-retry charged the attempt that SUCCEEDED (`confidence=certain` on merged task) | guard G1: any same-key success ⇒ whole group abstains; successful attempts are never units | `waste-det-retry.test.js` (inverted M3 expectation + E11 replica) |
| A4 / D3 / E13 (landed prior cycle) | duplicate-CI ignored `revision_key`, so config-only equivalence keys manufactured false certainty | guard G2: runs compared only inside the same revision partition; differing revisions never compared | `waste-dup-ci.test.js` (E13 replica negative control) |
| A5 / D5 / E12 (landed prior cycle) | `events()` returned the live internal array; callers could corrupt later audits | returns `Object.freeze([...internal])` | `tenant-isolation.test.js` |
| EPI-1 (NEW this cycle, audit §5/E6-D1) | deterministic-retry charged a post-premise retry whose OWN failure class differed (`invalid_request` → `provider_timeout`). Its transient class is observable disproof of "identical inputs fail identically" — the retry could have succeeded had the transient condition not occurred, so "could not succeed" was indefensible; same epistemics hole X1 closed for dup-CI | guard G4: once the premise is established, every later attempt must REPRODUCE the established deterministic class; any disagreement (different transient class, second "deterministic" class, unobservable/missing class) poisons the WHOLE group — including earlier same-class repeats, mirroring dup-CI G5. Pre-premise transient failures still do not poison. Explanations now cite the per-unit reproduction evidence ("this retry reproduced the identical deterministic class") | `waste-det-retry.test.js`: E6-D1 replica abstains; second-deterministic-class control; pre-premise-transient positive control; fail-closed missing-class control |
| TRUST-1 (NEW this cycle, audit §5 A-N2) | duplicate-CI compared runs in the null `revision_key` partition, so an adapter keying equivalence on configuration alone got cross-revision re-runs charged as certain duplicates — trusting an adapter contract nothing enforced | guard G6: partitions with UNKNOWN revision identity never produce findings; observed revision identity is REQUIRED at the boundary for duplicate-CI certainty. The fictional GitForge acceptance adapter now supplies `revision_key` (modeling the documented SHOULD as what it is: required for findings) | `waste-dup-ci.test.js`: A-N2 replica (unrevised pair) abstains + revisioned twin still yields the finding |

Two committed tests had encoded the defective behaviors as expected output and
were corrected in the same commits (the established X1 pattern): the det-retry
mixed-class battery now asserts group abstention instead of charging M2+M3,
and the unrevised dup-CI pair now asserts abstention instead of a finding.
Three other dup-CI fixtures gained explicit revisions so each guard keeps its
dedicated negative-control coverage (G3 overlap, G4 timing) rather than being
short-circuited by G6.

## Cross-seam compatibility of the new guards (verified)

- Synthetic fixture economics are UNCHANGED and byte-stable: TASK-006's three
  retries all carry the identical class `auth_error` (G4 keeps both findings);
  every fixture CI run carries `revision_key` (G6 keeps the TASK-005 finding).
  `expected.json` needed no edit; fixture-contract tests pass unmodified.
- github lane fixture: run 9001 attempts map with `revision_key = head SHA`
  (asserted by `packages/github/test/audit-ci-correlation.test.js`), so the
  $0.112 F-001 duplicate-CI finding survives G6 unchanged. No committed
  github/product/integration test charges a null-revision partition or a
  mixed-class retry group (swept all suites before landing).
- apps/cli bundled `core-audit-export-v1.json` retry group is
  `auth_error → auth_error` (consistent mode): G4 preserves its finding and
  explanation shape byte-for-byte.
- Rule ids/versions unchanged (`*_V1` stays version 1): both repairs tighten
  rules toward their documented "certain" contract, not new rule generations.
- Event schema untouched (`eventSchemaVersion '1'`); no new payload fields;
  privacy-lane mappings unaffected.

## Integration needs (not core-owned)

> **Integration status (cycle 32941279561):** all three items below are CLOSED
> on `lab/integration`. The product layer aligned with EPI-1
> (`IDENTICAL_RETRY_AFTER_DETERMINISTIC_FAILURE` v1.2.0, guard counter
> `retry_mode_disagreement`); WORD-1/SEAM-DIV/DOC-NIT landed via the product
> and github lanes; A12 is repaired at the CLI surface (env-resolved operator
> classification policy + report disclosure) and A12-MASK was replaced by
> transport-exercised CLI-level tests. Kept for provenance:

- Product lane mirror of EPI-1: `apps/cli/src/waste.js`
  (`IDENTICAL_RETRY_AFTER_DETERMINISTIC_FAILURE`, legacy normalized-input path)
  charges post-premise retries regardless of the retry's own recorded failure
  category (audit RT-2). Core cannot fix that file; the product layer should
  align or document the asymmetry for the legacy input path only.
- WORD-1 (abort-rule wording), SEAM-DIV (bundle vs event outcome vocabulary),
  DOC-NIT remain with their owning lanes per latest-product-audit.md §10.
- A12/A12-MASK (CLI real-mode policy wiring) remains the top global P0 gap in
  apps/cli + packages/github; core is unaffected.

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

## Contract pins for sibling lanes

- Event schema is unchanged from eventSchemaVersion `'1'`; the github lane's
  `canonical.js` mirror stays byte-compatible without modification.
- Rule ids/versions unchanged (`WASTE_DUP_CI_V1`, `WASTE_DET_RETRY_V1`,
  `WASTE_EXEC_SUPERSEDED_V1` all stay id+version 1): EPI-1/TRUST-1 are
  repairs toward the documented "certain" contract, not new rule generations.
- Adapter-facing behavior change (intentional, boundary-tightening): CI runs
  WITHOUT `revision_key` can no longer produce duplicate-CI findings. The
  GitHub adapter already emits it whenever a head SHA exists; any future
  adapter must do the same to receive dup-CI findings. Model-invocation retry
  groups whose post-premise attempts disagree on failure class now abstain.
- Envelope requirements honored: `export_type`, `export_version:"1"`
  (string), optional `analysis_period {from_iso,to_iso}`, per-finding
  `evidence_units`, `recommendation` field name (product maps it to
  `recommended_action`), balanced-accounting gate (core refuses to export an
  unbalanced ledger itself).

