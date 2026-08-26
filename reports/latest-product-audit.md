# BEETLEJUICE — Adversarial Product Audit (latest)

- **Auditor:** product_auditor
- **Date:** 2026-08-26
- **Audited candidate:** Factory cycle `32926312167` — branch `cycle/32926312167/audit` == `origin/lab/integration` @ `187f566`
- **Cycle lane snapshots audited:** `origin/cycle/32926312167/github` @ `3b0f716`, `origin/cycle/32926312167/privacy` @ `e8b1dba`, `origin/cycle/32926312167/product` @ `8173d02`; plus still-unintegrated `origin/cycle/32921371826/core` @ `4ebc931` (no new core lane this cycle)
- **Verdict: REJECT — NOT P0_READY.** The mounted integration candidate contains **zero product code** for the second cycle running. However, this cycle materially changed the picture: the two missing P0-critical lanes (**WC-002 GitHub adapter**, **WC-003 privacy gate**) now exist with 152 passing tests between them and **survived adversarial probing**, and the S1 model divergence is resolved on paper (one canonical schema, one money unit at rest, unified rule IDs). What remains: (1) actually integrating four finished lanes, (2) three still-live HIGH core defects (D1/D3/D5 — re-proven live today), and (3) one **newly discovered seam break**: the product CLI rejects real `packages/core` audit output (A2), falsifying the "consumed verbatim" contract claim.

---

## 1. Executive summary

The candidate (`lab/integration` @ `187f566`) has no `packages/`, no `apps/`, 0 tests, and a demo that cannot run. Meanwhile this cycle produced three hermetic lanes totaling **267 passing tests** (github 93, privacy 59, product 56, core 59):

- The **GitHub lane** is real read-only ingestion: strictly-GET client, timing-safe webhook signature verification, installation scoping, honest correlation confidence, honest unknown costs. Its fixture e2e pipeline runs without credentials.
- The **Privacy lane** implements a closed-world enum-only `GlobalLearningRecord`, fail-closed allowlist transform, content defense, cohort floors per consent purpose, license-acknowledgement gating, versioned transforms — and it repelled every re-identification attack attempted.
- The **Product lane** fixed both rule-boundary defects from the prior audit (D2/D4) with regression tests; its demo leads with economics and is byte-deterministic.
- The **Core lane did not move** (same commit as last cycle), so its three confirmed defects are untouched.

I executed the cross-lane seams that no committed code connects: **github → core works perfectly** (23/23 events accepted by the real ledger, exact cost identity); **core → product is broken** (the CLI's own validator rejects genuine `TenantLedger.audit()` JSON); **tenant → privacy has no producer-side wiring** (documented contract only, though the consumer side is solid).

Documentation was never accepted as runtime proof anywhere below.

---

## 2. Environment and exact commands

```
node v22.23.2, npm 10.9.8, linux
repo: /home/runner/work/Beetlejuice/Beetlejuice (branch cycle/32926312167/audit == origin/lab/integration @ 187f566)
lanes mounted via: git worktree add /tmp/opencode/bj-{github,privacy,product,core} <ref>
probes preserved under /tmp/opencode/probes32926312167/
```

| # | Command | Where | Result |
|---|---------|-------|--------|
| E1 | `npm install --ignore-scripts && npm test` | candidate | exit 0 — **0 tests** (vacuous green) |
| E2 | `npm run demo` | candidate | exit 1 — `Cannot find module '.../apps/cli/src/demo.js'` |
| E3 | pristine `git archive HEAD` checkout + ci.yml's own `find` guard | fresh copy | `TEST_COUNT=0` → guard exits 1 → **CI red on candidate, deterministic** |
| E4 | `npm test` | bj-core @ 4ebc931 | 59/59 pass |
| E5 | `node --test` | bj-github @ 3b0f716 | 93/93 pass (~0.7 s) |
| E6 | `npm test` | bj-privacy @ e8b1dba | 59/59 pass |
| E7 | `npm test`; `npm run demo -- --out DIR` ×2 then `diff -r` | bj-product @ 8173d02 | 56/56 pass; demo exit 0; **artifacts byte-identical across runs** |
| E8 | probe: github-lane fixture e2e pipeline → append EVERY event to real `TenantLedger` → `ledger.audit()` | cross-seam | **23/23 events accepted unmodified**; 3 tasks reconstructed; `knownMicroUsd=232000`, `accountingBalanced=true`; outcomes accepted/failed/unresolved = 1/1/1 |
| E9 | probe: serialize that `audit()` into the documented `beetlejuice_core_audit_export` envelope → product CLI `--core-audit` | cross-seam | **exit 2 — REJECTED**: `$.audit.waste.findings[n].evidence_units: evidence_units array is required` (×2 findings) |
| E10 | same export with ONLY `evidence_units` added mechanically | cross-seam | exit 0 — full report renders; headline economics lead; savings traceable to F-001/F-002 |
| E11 | probe: det-retry vs task `M1 auth_error` → `M2 status ok`, PR merged | bj-core | `WASTE_DET_RETRY_V1 confidence=certain wasted=40000 refs=["M2"]` — **D1 still live**: flags the invocation that succeeded |
| E12 | probe: `ledger.events().push(...)` | bj-core | push succeeds, ledger size 6→7 — **D5 still live** (`events()` docstring says "Frozen"; returns live array) |
| E13 | probe: two `ci_run_recorded`, same `equivalence_key`, differing `revision_key` (rev-A/rev-B) | bj-core | `WASTE_DUP_CI_V1 confidence=certain` — **D3 still live** |
| E14 | privacy attack battery (forbidden keys; secret/path/hash/email/base64 in text fields; unique-combo suppression; purpose/license gating; join-key analysis) | bj-privacy | every attack repelled (details §5) |
| E15 | webhook negatives: tampered body / wrong secret / `sha1=` scheme / empty body; valid sig; delivery leak scan | bj-github | mismatches rejected (`SIGNATURE_MISMATCH`, `BAD_SIGNATURE_INPUT`); valid passes; raw repo identifiers appear **only** in tenant-scope `event_id`/`source.ref` metadata |
| E16 | product guard probes: successful retry after deterministic failure; replacement not started strictly later (+ positive controls) | bj-product | negatives produce **no finding**; positives produce exactly one finding each — R2/R4 verified fixed |
| E17 | probe: normalized bundle containing `head_sha` → `buildAuditReport` | bj-product | rejected: `raw provider payload field "head_sha" detected` |

---

## 3. P0 scorecard (docs/PRODUCT_OBJECTIVE.md "P0 definition of done", items 1–12)

Graded against the **integration candidate**; lane-level results are evidence toward integration, not integration credit.

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | `AGENTIC_TASK` canonical model, versioned | **FAIL (not integrated)** / PASS-in-lane | Candidate `git ls-tree -r HEAD`: no `packages/`, no `apps/`. Core lane implements the versioned event model (four version stamps attached by the ledger so adapters cannot forget them; strict validation; frozen aggregates). |
| 2 | GitHub adapter ingesting realistic Actions/PR evidence into the model | **FAIL (candidate)** — **seam proven viable by execution** | No adapter code on candidate (E1/E3). Lane: 93/93 tests incl. credential-free e2e over injected transport asserting GET-only (E5). Probe E8 appended all 23 emitted events to the REAL core ledger unmodified — tasks, supersession chain and exact costs reconstructed. Strongest integration-ready evidence this cycle. |
| 3 | Cost accounting identity | **FAIL (candidate)** / PASS-in-lane-and-probe | Probe E8: `accountingBalanced=true` over real adapter data; 4 unknown-cost components counted honestly, $0 guessed. Core cost tests pass (E4). |
| 4 | Conservative outcome attribution | **FAIL (candidate)** / PASS-in-lane | Unchanged core behavior re-observed in E8 (open PR ⇒ `unresolved/partial`, never success). Product lane never counts open/aborted as success. |
| 5 | ≥1 certain-waste detector end-to-end, evidence-backed | **FAIL** — “certain” still falsifiable in core; product rules repaired | Candidate has no detector. Product-lane D2/D4 fixed (E16, regression-tested). Core D1/D3 still emit `confidence=certain` on self-contradictory evidence (E11/E13). |
| 6 | Synthetic demo produces complete audit without external account | **FAIL (candidate)** / PASS-in-lane | E2 vs E7: demo deterministic, economics-first headline ($28.57 measured / $30.17 representable / $15.09 per accepted outcome / $8.99 certainly avoidable, ratio 31.47%), every finding carries evidence + recommendation; raw-payload rejection works (E17). |
| 7 | Read-only GitHub mode with token/app credential | **FAIL (candidate)** / PARTIAL-in-lane | Lane has collector/client/webhook surface with least-privilege auth headers and redaction; but no committed wiring from adapter → ledger → CLI exists anywhere, and credential/env setup docs for a REAL repo are not yet an executable path. Demo-only behavior must not be marketed as real GitHub mode. |
| 8 | Report leads with economics, not tokens | **FAIL (candidate)** / PASS-in-lane | Verified in E7/E10 reports: cost/outcome/waste headline table; tokens confined to "Secondary diagnostics (not economics)" with explicit note; savings traceability field present. |
| 9 | Global export free of source content/linkable identity | **FAIL (candidate)** / PASS-in-lane under attack | Nothing integrated. Lane survived battery E14 (§5): closed-world schema, fail-closed allowlist, content defense, cohort floors, purpose/license gating. |
| 10 | Privacy/re-id/cost/outcome/isolation tests pass | **FAIL (candidate — zero tests)** / PASS-in-lane | Lane suites: privacy incl. reidentification/content-defense/joinkeys/tenant-isolation/economics/reproducibility; core incl. cost/outcome/isolation. All green (E4–E7). Not creditable until merged. |
| 11 | README quickstart; synthetic vs real clearly distinguished | **FAIL (candidate)** | Candidate README honestly states the demo is missing ("A missing demo is intentionally a P0 failure") but ships no runnable quickstart. Lane docs distinguish fixture vs normalized-input vs canonical-core modes; NORMALIZED_INPUT.md's claim that core exports are consumed "verbatim" is falsified by E9 until A2 is repaired. |
| 12 | CI green on integration candidate | **FAIL (deterministic)** | E3: guard exits 1 on fresh checkout (0 test files); even if it passed, E2 demo exits 1. |

**Score: 0 / 12 PASS on the integration candidate** — same headline as last cycle, but the underlying reality is far closer: all four lanes now exist, are tested, and interoperate at two of three seams when actually executed.

---

## 4. End-to-end data flow (executed, not assumed)

Required flow: *Source Data → Tenant Analytics → Global Learning Dataset*.

| Seam | Status | Proof |
|------|--------|-------|
| GitHub (source) → core ledger (tenant analytics) | **WORKS when executed; not wired in any committed code path** | E8: 23/23 adapter events accepted by `TenantLedger.append` with zero normalization shims; version stamps attached by the ledger; supersession chain and merged/failed/open outcomes reconstructed correctly. |
| Core audit → product surface | **BROKEN at runtime** | E9: the CLI's own validator rejects genuine `JSON.stringify(TenantLedger.audit())` — findings lack `evidence_units`. E10 proves that field is the only blocker: adding it mechanically yields a complete, correct report. The hand-written fixture `apps/cli/fixtures/core-audit-export-v1.json` contains post-repair semantics ("No attempt with this key ever succeeded") that real core does not implement — documentation and fixture describe a core that does not exist yet. |
| Tenant analytics → privacy gate → global export | **Consumer solid; producer wiring absent** | No committed code maps tenant tasks → `normalizeTenantRecord` inputs. The transform contract is documented and the consumer repelled all attacks (§5), but the pipeline exists only as two disconnected halves. |

Net: the middle layer is strong, upstream ingestion is integration-ready, downstream export is privacy-solid — but the product as mounted still has no end-to-end path.

---

## 5. Privacy / re-identification attack battery (E14 detail) — all repelled

| Attack | Result |
|--------|--------|
| Forbidden keys `repository`, `customer_id`, `developer_email`, `commit_hash`, `pr_number`, `repo_url`, `prompt_text` injected into tenant observations | rejected fail-closed with precise codes (`forbidden_repo_or_project_field`, `forbidden_customer_or_tenant_field`, `forbidden_org_or_user_field`, `forbidden_vcs_ref_field`, `forbidden_pr_or_issue_field`, `forbidden_content_field`) |
| Credential-shaped string in allowed text field `agent_name` | rejected (`credential_shape_detected`) |
| Filesystem-path-like agent name | rejected (`filesystem_path_detected`) |
| 40-hex commit-shaped model name | rejected (`hash_like_hex_detected`) |
| Email-shaped agent name | rejected (`email_detected`) |
| High-entropy base64 blob | rejected (`high_entropy_blob_detected`) |
| URL-encoded org name / homoglyph org name | raw value dropped; classified to coarse enum (`custom`); nothing raw exported |
| Unique combination among 50 common records (k=2/5) | suppressed from `accepted`; appears only in caller-side `suppressed[].combination` echo; benchmark-purpose floor enforced (`cohort_threshold: 5`) |
| Export without purpose / research purpose without license acknowledgement | `PURPOSE_REQUIRED` / `LICENSE_ACKNOWLEDGEMENT_REQUIRED` |
| Join-key analysis of accepted records | 17 fields, all enums + one boolean; zero fields matching id/name/url/ref/sha/hash; identical economics from "two tenants" produce byte-identical records — indistinguishable by construction |
| Error channels echoing offending values | rejection entries carry reason code + field name only, never values |

Residual privacy notes (not defects): (a) the GLR carries no waste/cost-per-outcome aggregate — sufficient for WC-003's V1 acceptance but thin for V4 benchmarking; (b) producer-side mapping from real tenant analytics remains to be built and must be covered by round-trip tests at integration.

---

## 6. Adversarial findings (highest severity first)

### A1 — INTEGRATION: candidate contains no product code while four tested lanes sit unmerged (severity: CRITICAL for P0)
- **Evidence:** E1–E3 vs E4–E7; branch topology (each lane = one commit on top of `187f566`; `lab/integration` unchanged since last cycle).
- **Impact:** every P0 criterion fails on the candidate regardless of lane quality; CI deterministically red.
- **Smallest repair:** merge the three new lanes plus the existing core lane into one workspace (root package.json with workspaces or npm-less composite scripts), wire `collectHistory→assembleAudit → TenantLedger.appendAll → ledger.audit() → demo --core-audit` as a committed e2e test, then re-run E3.

### A2 — SEAM: canonical-core export contract does not match what core emits (NEW this cycle)
- **Evidence:** E9/E10. `packages/core` findings serialize `{finding_id, rule_id, rule_version, task_ref, confidence, wasted_micro_usd, evidence_refs, unquantified_evidence_refs, explanation, recommendation}`; the CLI requires per-unit `evidence_units:[{ref, kind, micro_usd, quantified}]`. `docs/NORMALIZED_INPUT.md` §"Seam B" claims verbatim consumption — falsified by execution.
- **Why it matters:** the "one canonical model" claim (prior S1/R7 repair) holds only in prose; the actual handoff was never executed by either lane.
- **Smallest repair:** have the core engine include serialized `evidence_units` in each finding (~10 lines; it already builds `evidenceUnits` internally), OR derive units from `evidence_refs`+ledger lookup in the CLI validator. Then add a cross-package round-trip test (core audit JSON → `validateCoreAuditExport` must pass) so this can never regress silently.

### A3 — CORE: D1 still live — deterministic-retry flags a SUCCESSFUL invocation as certain waste
- **Evidence:** E11 (`confidence=certain wasted=40000 refs=["M2"]` on a merged task). Aggravating: `packages/core/test/waste-det-retry.test.js:24-31` asserts `['M2','M3']` are flagged — i.e., the test suite codifies the defect, charging the successful attempt's cost as certainly avoidable.
- **Smallest repair (R1, unchanged):** skip any unit whose own `payload.status === 'ok'`; stop flagging further units of an equivalence key once success is observed; invert the M3 expectation into a negative control.

### A4 — CORE: D3 still live — duplicate-CI “certainty” rests on differing `revision_key`s being ignored
- **Evidence:** E13. An adapter keying equivalence by workflow name alone would make Beetlejuice report non-waste as certain.
- **Smallest repair (R3):** abstain when both runs define `revision_key` and they differ; document/enforce `equivalence_key ≡ f(revision, config)`; negative test with differing revisions.

### A5 — CORE: D5 still live — `TenantLedger.events()` returns the live internal array
- **Evidence:** E12 (push succeeds; size mutates). Docstring claims "Frozen".
- **Smallest repair (R5):** return `Object.freeze([...this.#events])`.

### A6 — CI: test-count guard prune list still blind to vendored dot-directories
- In workspaces with untracked `.opencode/node_modules`, the guard counts 149 vendored zod tests and would wave through a zero-test build; on clean checkouts it fails correctly (E3). Either way it measures the wrong thing.
- **Smallest repair (R6):** prune `-path './.opencode'` (or any dot-dir) alongside `./node_modules`.

### Observations (no action required for P0)
- Rule composition can drive the waste ratio to 100% of measured spend on an ACCEPTED task (E10 report): superseded-execution claims rev-B022 spend incl. CI@a1+checks; duplicate-CI separately claims re-run @a2. Refs do not overlap and each premise matches MASTER_PROMPT §9 examples, so it is defensible ex-post — but the report should consider a sanity note when certainlyAvoidable ≥ representable total, since "everything was avoidable" on a merged PR invites justified skepticism.
- Product-lane legacy normalized-bundle mode now mirrors core rule classes (`canonical_rule_class`) — vocabulary unification verified in rendered output.

---

## 7. What held up under attack (credit where due)

- **GitHub adapter:** strictly-GET client (write methods cannot even be expressed through the request surface), bounded pagination, token redaction in error paths, timing-safe signature comparison with scheme/hex validation, installation scoping ignoring foreign-repo deliveries, honest correlation confidence (`explicit` vs `inferred` vs excluded — never force-attached), model/tool costs honestly absent rather than estimated. Cross-seam proof E8 shows the pinned-contract mirror of the core schema is byte-compatible today.
- **Privacy gate:** closed-world enum-only GLR; unknown key ⇒ rejection, not dropping; raw magnitudes replaced by buckets; no timestamps input field at all; per-purpose cohort floors with an absolute minimum; license acknowledgement gating for research/licensing exports; deterministic canonical ordering; versioned transformation trace.
- **Product surface:** R2/R4 guards fixed exactly as prescribed last cycle and regression-tested (E16); raw provider markers rejected (E17); unbalanced ledgers refused; findings sum / cost-per-outcome identities re-checked on ingestion; deterministic artifacts (E7); savings fully traced to finding IDs.
- **Core economics/attribution/isolation mechanics** remain sound under probes; only the rule-boundary preconditions (A3/A4) and the events() view (A5) are defective.

---

## 8. Demo-only vs real GitHub mode

- Everything runnable today is fixture-backed: the product demo consumes a bundled synthetic fixture; the github lane e2e runs against an injected in-memory transport. Both are legitimate P0 artifacts.
- **No committed code path yet turns a real GitHub repository into a report.** The pieces are now extremely close (E8 proves adapter→ledger compatibility), but "connect your repository" remains unsupported until integration wires collector → ledger → CLI and documents credentials. Any README/report wording must keep claiming no more than that.
- Webhook verification exists and is tested (P1 item ahead of schedule), but there is no receiving HTTP endpoint in any branch — incremental ingestion is a library surface, not a live service.

---

## 9. Recommended next actions (smallest repairs first)

1. **Integrate (A1):** one workspace containing `packages/core`, `packages/github`, `packages/privacy`, `apps/cli`; add a committed end-to-end test executing `collectHistory(fixture client) → TenantLedger.appendAll → ledger.audit() → validateCoreAuditExport → renderMarkdown`. This single test would have caught A2 before it shipped.
2. **Repair A2** (`evidence_units` serialization in core OR derivation in CLI) + round-trip test.
3. **Land core repairs R1/R3/R5** (A3/A4/A5) with inverted/negative tests; these block criterion 5's "certain" claim even after integration.
4. Fix CI guard prune list (A6/R6).
5. Wire tenant→privacy producer mapping + round-trip privacy test over real audit data (currently the only seam with zero executable coverage).
6. Only then re-verify each `p0_checks` entry in `state/factory.json` with executed commands recorded in this report's style. Current factory state (`status=BUILDING`, all checks false, next_action INTEGRATE_LANES…) remains accurate for this candidate; do not advance any check on lane evidence alone.

---

*Audit method note: every FAIL above is backed by an executed command or probe preserved under `/tmp/opencode/probes32926312167/`; documentation and hand-written fixtures were never accepted as runtime proof. Lane test counts re-run during this audit: core 59, github 93, privacy 59, product 56 — all passing.*
