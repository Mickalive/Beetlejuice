# BEETLEJUICE — Adversarial Product Audit (latest)

- **Auditor:** product_auditor
- **Date:** 2026-08-26
- **Audited candidate:** Factory cycle `32931221589` — branch `cycle/32931221589/audit` == `origin/lab/integration` @ `c935960`
- **Cycle lane snapshots audited (all executed, not read):** `origin/cycle/32931221589/core` @ `f23510e`, `.../github` @ `3f88f34`, `.../privacy` @ `56a1523`, `.../product` @ `34380a3`
- **Verdict: REJECT — NOT P0_READY.** Third consecutive cycle in which the mounted integration candidate contains **zero product code**. However, this cycle changes the endgame materially: **all four lanes merge cleanly onto `lab/integration` with zero conflicts and the merged workspace passes 319/319 tests with a working economics-first demo** — verified by execution in this audit. The full chain *github fixture → collectHistory → TenantLedger → audit() → buildCoreAuditExport → CLI report* now runs end-to-end across real package boundaries. Remaining blockers are: actually mounting that merge, one new self-contradictory "certain waste" defect (**X1**), one new seam break (**A7**, the `--input` "real mode" rejects real adapter output), the still-missing committed cross-package e2e, and the CI-guard blind spot.

---

## 1. Executive summary

The candidate (`lab/integration` @ `c935960`) has no `packages/`, no `apps/`, 0 tests (`# tests 0` vacuous green), and `npm run demo` exits 1 with `MODULE_NOT_FOUND`. This is unchanged since cycle 32922397698.

Meanwhile every lane rebuilt on top of that same base and all four prior-audit defects assigned to core were repaired and regression-tested:

- **Core lane (82 tests):** R1 landed (a successful attempt now poisons certainty for its whole equivalence-key group — verified by execution), R3 landed (duplicate-CI compares only inside equal `revision_key` partitions), R5 landed (`events()` returns a frozen snapshot; `push()` throws TypeError), A2 closed producer-side (`buildCoreAuditExport` emits `evidence_units[]`, refuses to export unbalanced ledgers). New export module + honest integration notes.
- **GitHub lane (102 tests):** strictly-GET collector, timing-safe webhook verification, App-JWT auth, honest correlation-confidence and unknown costs; fixture e2e runs credential-free; live call to `api.github.com` without a token fails honestly (`UPSTREAM_ERROR 404`) — no fake data path exists.
- **Privacy lane (72 tests):** repelled every attack in my battery (§6); closed-world enum-only GLR, fail-closed unknown keys/values, cohort floors per consent purpose, license gating.
- **Product lane (63 tests):** A2 closed consumer-side as well (accepts refs-only findings, derives explicitly-unquantified units); demo deterministic byte-for-byte; sanity note added for ≥100% waste ratios.

I executed the seams no committed code connects. github→core→product is now **fully working by execution** (23/23 events accepted, balanced accounting, exit-0 report). The remaining `--input` seam is broken against real adapter output (A7). One new certainty defect (X1) was found in duplicate-CI by attacking its rule preconditions.

---

## 2. Environment and exact commands

```
node v22.x, npm 10.x, linux
repo: /home/runner/work/Beetlejuice/Beetlejuice (branch cycle/32931221589/audit == origin/lab/integration @ c935960)
lanes mounted via: git worktree add --detach /tmp/opencode/bj32931221589/bj-{core,github,privacy,product} origin/cycle/32931221589/<lane>
trial integration: git worktree add --detach /tmp/opencode/bj32931221589/merge-test origin/lab/integration && git merge <each lane>
probes preserved under /tmp/opencode/probes32931221589/
```

| # | Command | Where | Result |
|---|---------|-------|--------|
| E1 | `npm install --ignore-scripts && npm test` | candidate | exit 0 — **`# tests 0`** (vacuous green) |
| E2 | `npm run demo` | candidate | exit 1 — `Cannot find module .../apps/cli/src/demo.js` |
| E3 | pristine `git archive HEAD` checkout + ci.yml's own `find … \| wc -l` guard | fresh copy | `TEST_COUNT=0` → guard exits 1 → **CI deterministically red on candidate** |
| E4 | same guard inside candidate workdir (with vendored `.opencode/node_modules`) | candidate | `TEST_COUNT=149`, of which **147 are vendored zod tests** → guard measures dependencies, not product (A6/R6 still live) |
| E5–E8 | `npm install --ignore-scripts && npm test` | bj-core / bj-github / bj-privacy / bj-product | **82/82**, **102/102**, **72/72**, **63/63** — total **319 passing** |
| E9 | product: `npm run demo` ×2 → `diff -r` of outputs | bj-product | exit 0; artifacts **byte-identical** |
| E10 | probe `e2e-seam-probe.mjs`: fixture client → `collectHistory` → `assembleAudit` → REAL `TenantLedger.appendAll` → `audit()` → `buildCoreAuditExport` | cross-lane | 23/23 events accepted; GET-only confirmed; `accountingBalanced=true`; `knownMicroUsd=232000`; findings serialized WITH `evidence_units`, `export_version:"1"` |
| E11 | E10's envelope → product CLI `--core-audit FILE --out DIR` | cross-lane | **exit 0** — full report renders: `$0.232 measured · 1 accepted · $0.23/outcome · $0.232 certainly avoidable (100%)` + explicit sanity note; task ledger shows merged/failed/unresolved attribution |
| E12 | D5 re-probe: `ledger.events().push({bogus:true})` | bj-core | **throws TypeError** — frozen snapshot verified (R5 fixed) |
| E13 | rule-boundary battery (probe `rule-boundary-probe.mjs`), det-retry: success-in-group / single-failure / blind-repeat / non-deterministic class / missing key / unknown cost | bj-core | abstain / abstain / charged / abstain / abstain / charged-with-`wasted_micro_usd: 0` + unquantified unit — **all boundaries correct** |
| E14 | same battery, dup-CI: canonical dup / **post-pass re-run that FAILED** / differing `revision_key` / overlapping runs / missing timing | bj-core | charged / **charged `confidence=certain` (X1 DEFECT)** / abstain / abstain / abstain |
| E15 | superseded-execution probes: valid chain / replacement FAILED after superseded succeeded / strictly-later validation / double-count strip via ledger | bj-core | charged / charged (defensible, §5) / invalid chains rejected at reconstruction (`UNKNOWN_EXECUTION_REF`, `BAD_SUPERSESSION`) / engine strips shared units — `claimed(170000) ≤ known(170000)`, disjoint refs |
| E16 | tenant isolation negatives: cross-ledger audit JSON scan for foreign task refs/costs; global registry probes | bj-core | no leak; no static tenant registry; each ledger exposes only its own events |
| E17 | version stamps on ingested events | bj-core | every event carries `schema_version:"1"`, `event_version:"1"`, `collector_version`, `normalization_version` |
| E18 | privacy attack battery AT1–AT12 + B1–B4 (probes `privacy-attack*.mjs`) | bj-privacy | every attack repelled (details §6) |
| E19 | live network honesty check: `createGithubRestClient({})` (no token) → request to `api.github.com` | bj-github | **real TLS call made**, honest failure `UPSTREAM_ERROR - upstream 404` — no fabricated fallback |
| E20 | trial integration: merge core→github→privacy→product onto `lab/integration` in scratch worktree | scratch | **4× MERGE OK, zero conflicts** |
| E21 | `npm install --ignore-scripts && npm test` on merged workspace | scratch merged tree | **319/319 pass in one suite** |
| E22 | `npm run demo` on merged workspace | scratch merged tree | **exit 0** — `$28.57 measured · 2 accepted · $15.09 per outcome · $8.99 certainly avoidable (31.47%)` |
| E23 | probe `normalized-seam-probe.mjs`: `assembleAudit(evidence)` written verbatim to file → product CLI `--input FILE` | cross-lane | **exit 2 — REJECTED**: `$.collector_version: collector_version is required` (+5 more) — adapter emits `{events, stats}`, CLI demands schema-v2 bundle (**A7**) |

---

## 3. P0 scorecard (docs/PRODUCT_OBJECTIVE.md items 1–12)

Graded against the **integration candidate**; lane results are evidence toward integration, not credit.

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | `AGENTIC_TASK` canonical model, versioned | **FAIL (not integrated)** / PASS-in-lane | Candidate `git ls-tree`: no `packages/`, no `apps/`. Lane: vendor-neutral event types; four version stamps attached to every event (E17); strict fail-closed normalization; adapter-extensibility test proves a second platform fits without changing the model. |
| 2 | GitHub adapter ingesting realistic Actions/PR evidence into the model | **FAIL (candidate)** — seam proven viable by execution | No adapter code on candidate (E1/E3). Lane 102/102 incl. credential-free transport e2e asserting GET-only (E5); my probe fed all 23 events into the REAL core ledger unmodified (E10); live api.github.com behavior exercised without fakes (E19). |
| 3 | Cost accounting identity `inference+tools+CI+compute = total` | **FAIL (candidate)** / PASS-in-lane-and-probe | E10: `accountingBalanced=true` over genuine adapter data; unknown components counted honestly ($0 guessed); exporter refuses to emit an unbalanced ledger; product surface re-verifies identities and refuses unbalanced input. |
| 4 | Conservative outcome attribution | **FAIL (candidate)** / PASS-in-lane | E11 report: merged→accepted, closed-unmerged→failed, open→unresolved(partial); revert flag modeled at reconstruction; nothing counts unresolved as success. |
| 5 | ≥1 certain-waste detector end-to-end with evidence | **FAIL** — “certain” falsifiable in dup-CI (X1) even though det-retry/superseded survived attack | Candidate has no detector. Lane: R1/R3 repairs verified (E13/E14 negatives); superseded rule preconditions enforced at reconstruction (E15). But E14-X1: dup-CI charges `confidence=certain` while its own evidence disproves the rule premise (§5). Criterion cannot pass until X1 is repaired. |
| 6 | Synthetic demo produces complete audit without external account | **FAIL (candidate)** / PASS-in-lane-and-merge | E2 exit 1 vs E22 exit 0 on the merged tree; deterministic (E9); economics-first headline; raw-payload rejection upstream. |
| 7 | Read-only GitHub mode with token/app credential | **FAIL (candidate)** / PARTIAL-in-lane | Library-level real mode works and fails honestly without credentials (E19); README documents a token one-liner and App-JWT flow; strictly-GET enforced at the client surface. But **no committed command turns `token+repo` into a report** — wiring collector→ledger→CLI exists nowhere (grep across lanes: zero hits). Demo-only vs real distinction must not be overstated. |
| 8 | Report leads with economics, not tokens | **FAIL (candidate)** / PASS-in-lane | E11/E22 reports: headline economics table first; tokens confined to “Secondary diagnostics (not economics)”; savings traced to finding IDs; sanity note present for ≥100% ratios. |
| 9 | Global export free of source content/linkable identity | **FAIL (candidate)** / PASS-in-lane under attack | Nothing integrated. Lane survived batteries E18 (§6): 17-field GLR, all enums + one boolean; zero identifier-shaped fields; fail-closed on unknown keys/values; cohort floors; purpose/license gates; deterministic byte-identical output. Producer-side mapping from tenant analytics still absent (A10). |
| 10 | Privacy/re-id/cost/outcome/isolation tests pass | **FAIL (candidate — 0 tests)** / PASS-in-lane | 319 lane tests green incl. dedicated reidentification, joinkeys, content-defense, tenant-isolation (privacy), isolation + accounting suites (core), scope-boundary (github). Merged tree runs all 319 in one suite (E21). Not creditable until mounted. |
| 11 | README quickstart; synthetic vs real clearly distinguished | **FAIL (candidate)** | Candidate README admits demo missing (“intentionally a P0 failure”), ships no runnable quickstart. GitHub-lane README distinguishes fixture vs real mode with env var; but NORMALIZED_INPUT.md’s seam-A claim (“adapter-normalized bundle”) describes a producer that does not exist anywhere (A7). |
| 12 | CI green on integration candidate | **FAIL (deterministic)** | E3: guard exits 1 on pristine checkout (0 test files); E2 demo exits 1 regardless. On the merged tree both would pass (E21/E22). |

**Score: 0 / 12 PASS on the mounted candidate.** On the proven-by-execution merged workspace it would be **10/12**, failing only #5 (X1) and #7 (no committed token→report command).

---

## 4. End-to-end data flow (executed, not assumed)

Required flow: *Source Data → Tenant Analytics → Global Learning Dataset*.

| Seam | Status | Proof |
|------|--------|-------|
| GitHub (source) → core ledger (tenant analytics) | **WORKS when executed; still wired in no committed code path** | E10: 23/23 events accepted by real `TenantLedger.appendAll` with zero shims; supersession chain, outcomes, exact micro-usd reconstructed; GET-only enforced. |
| Core audit → product surface (`--core-audit`) | **WORKS when executed; not wired as committed e2e** | E10→E11: `buildCoreAuditExport` envelope validated and rendered by the CLI, exit 0; totals consumed verbatim; identity checks pass. Both sides of last cycle’s A2 break independently repaired and now interoperable. |
| Product `--input` “real read-only mode” ← adapter output | **BROKEN (new, A7)** | E23: genuine `assembleAudit` output `{events, stats}` rejected (6 errors). No committed code in any branch produces the documented schema-v2 normalized bundle — the only producer is the product lane’s own synthetic generator. Docs describe a contract with no implementation. |
| Tenant analytics → privacy gate → global export | **Consumer solid; producer wiring absent (unchanged)** | No committed mapping from audit tasks to `normalizeTenantRecord` inputs; core lane itself lists this as an open integration need. Consumer side repelled all attacks (§6). |

---

## 5. Certain-waste falsification attempts (rule preconditions under attack)

Every `confidence=certain` claim must survive attacks on its own preconditions. Results:

**WASTE_DET_RETRY_V1 — holds.** Success in group ⇒ whole group abstains (R1 verified); first deterministic failure free; blind repeats charged; non-deterministic classes abstain; missing equivalence key abstains; unknown costs produce `wasted_micro_usd: 0` with an explicit unquantified unit — never invented money (E13).

**WASTE_DUP_CI_V1 — one live defect.**
- Correctly abstains on differing revisions (R3), overlapping runs, missing timing, missing key (E14).
- **X1 (HIGH): a post-pass re-run that itself FAILED is charged `confidence=certain`.** The finding text asserts “Its result could not differ” while the evidence shows it did differ (passed→failed). Either inputs were not identical (equivalence key falsely asserted) or outputs are nondeterministic (re-runs carry information value) — under either reading the certainty premise is empirically false. This is exactly the self-contradiction class repaired as R1 in det-retry; dup-CI applies the principle asymmetrically. Smallest repair: mirror G1 — if any post-pass repeat terminated non-passed, abstain for that partition (determinism disproved); add negative regression mirroring `waste-det-retry.test.js`’s R1 control.

**WASTE_EXEC_SUPERSEDED_V1 — holds within its stated boundary.** Supersession requires a known, strictly-later replacement execution (validated at reconstruction; invalid refs rejected). Charging a superseded execution whose replacement then failed (E15-S2) remains defensible: the spend demonstrably contributed nothing to any outcome, which is the definition of certain avoidability in hindsight. Residual trust assumption: the adapter-supplied status/superseded_by must be truthful — acceptable, documented, and consistent with the model’s adapter-contract stance.

**Composition of savings across rules — defensible, now labeled.** On the fixture’s merged task, F-001 (dup CI @a2, $0.112) + F-002 (superseded execution incl. @a1, $0.12) sum to 100% of measured spend. Refs are provably disjoint (E15-S4 strip logic) and both counterfactuals are jointly satisfiable (“revision r2 never happens”). Explanations differ (reuse-the-pass vs cancel-before-start) but the bound is coherent, and the report now prints an explicit sanity note when certainlyAvoidable ≥ representable total. No action required beyond X1.

---

## 6. Privacy / re-identification attack battery (E18 detail) — all repelled

| Attack | Result |
|--------|--------|
| Forbidden keys (`repository`, `customer_id`, `developer_email`, `commit_hash`, `pr_number`) injected into observations | record rejected fail-closed; nothing admitted |
| Exact timestamp smuggled via unknown key (`started_at`) | rejected (unknown field) |
| Token-shaped `agent_name` (`ghp_…` runtime-composed) | rejected (`credential_shape_detected`) |
| Repo-name string as `agent_name` | classified to coarse enum family; raw value absent from entire serialized output (string-scan negative) |
| URL in `model_name`; high-entropy blob; filesystem path in allowed text fields | all rejected before admission |
| SQL/XSS/NUL/path-traversal payloads in enum-ish inputs | never echoed; either classified or rejected; output scan clean |
| Unique combination among 20 common records (k floor 5) | unique row rejected (`invalid_enum_value` for out-of-vocab class) / suppressed below floor; distinctive values absent from output; risk block explains suppression counts |
| Negative magnitudes (`cost_usd:-5`, `files_touched_count:-99`) | rejected (`negative_value`) |
| Export without purpose / research purpose without license acknowledgement | `PURPOSE_REQUIRED` / `LICENSE_ACKNOWLEDGEMENT_REQUIRED` (installation alone grants nothing — matches MASTER_PROMPT §13) |
| Join-key analysis of admitted records | 17 fields, all enums + one boolean; zero matches for id/name/url/ref/sha/hash/email/user/repo/org patterns; identical economics produce byte-identical records regardless of source tenant |

Residual notes (unchanged from last cycle): the GLR intentionally carries no waste/cost-per-outcome aggregates (sufficient for WC-003 V1, thin for V4); producer-side mapping remains unbuilt (A10) and must ship with round-trip privacy tests over REAL audit data at integration.

---

## 7. Demo-only vs real GitHub mode

- **Everything runnable on the candidate is nothing** — there is no product code at all; the honest README says so.
- **On the lanes/merged tree:** two legitimate synthetic surfaces exist (product fixture demo; github fixture e2e over an injected transport). Real mode exists today only as a library capability plus a documented `BEETLEJUICE_GITHUB_TOKEN` snippet; I exercised the live path without a token and got an honest upstream 404 (E19) — no simulated data masquerading as GitHub data anywhere.
- **No single committed command yet performs `token + repo → report`.** Until one does (smallest repair A11), any wording claiming “connect your repository and see your audit” would be demo-overstatement. The `--input` seam additionally cannot ingest what the adapter emits (A7), so the only true end-to-end path is fixture→ledger→`--core-audit`.

---

## 8. Findings (highest severity first) and smallest repairs

### A-CAND — INTEGRATION: candidate mounts no product code while four tested lanes sit one merge away (CRITICAL, third consecutive cycle)
- Evidence: E1–E4 vs E5–E23. Branch topology: each lane = one commit on `c935960`; `lab/integration` untouched this cycle.
- Impact: every P0 criterion fails on the mounted candidate; CI deterministically red; factory cannot advance.
- Smallest repair (executed and proven in E20–E22): `git merge` the four lane branches (zero conflicts), commit, run CI. Result: green 319-test workspace with working demo.

### X1 — CORE: duplicate-CI charges `confidence=certain` on evidence that disproves its own premise (HIGH, NEW)
- Evidence: E14-X1 — C1 passed@00:14, C2 failed@00:24, same key+revision ⇒ finding `WASTE_DUP_CI_V1 confidence=certain wasted=$1.00` with explanation “Its result could not differ.”
- Impact: a false “certain” claim can reach customer reports; violates the engine’s own R1 epistemics; blocks P0 #5 even after integration.
- Smallest repair: in `duplicate-ci.js`, treat any post-pass repeat whose terminal status ≠ `passed` as disproof of determinism for that partition (abstain), mirroring G1; add negative regression.

### A7 — SEAM: `--input` real-mode rejects genuine adapter output; documented producer does not exist (HIGH, NEW)
- Evidence: E23 (`assembleAudit` → `{events,stats}`; CLI needs `{schema_version:"2", collector_version, normalization_version, records}`); grep shows zero producers of that shape outside product’s synthetic generator; NORMALIZED_INPUT.md §Seam A documents the nonexistent contract.
- Impact: the documented “real read-only mode” ingestion path cannot consume real adapter data; same class of prose-vs-runtime divergence as last cycle’s A2.
- Smallest repair: EITHER add `buildNormalizedBundle()` to the github lane emitting the v2 envelope from mapped task records + round-trip test, OR re-document `--input` as legacy/synthetic-only and point real mode exclusively through the core seam (`collectHistory → appendAll → exportCoreAudit → --core-audit`). Either way, add the committed cross-package round-trip test (see A9).

### A9 — INTEGRATION: still no committed cross-package e2e despite being the declared next_action (MEDIUM-HIGH, recurring)
- Evidence: grep across all four lanes: no file imports a sibling package; every seam break to date (A2, A7) was found only by out-of-band probing, never by CI.
- Smallest repair: in the merged workspace add one test executing `fixture client → collectHistory → assembleAudit → TenantLedger.appendAll → buildCoreAuditExport → validateCoreAuditExport/renderMarkdown`; it runs in <1 s and would have caught both A2 and A7.

### A6/R6 — CI: test-count guard still blind to vendored dot-directories (LOW-MEDIUM, carried over)
- Evidence: E4 — guard counts 149 files in the dev workdir, 147 of them vendored zod tests under `.opencode/node_modules`.
- Smallest repair: add `-path './.opencode' -prune` (or prune any dot-dir) to ci.yml’s find.

### A10 — PRIVACY: producer-side mapping tenant→gate absent (MEDIUM, carried over)
- Evidence: §4 row 4; core lane’s own INTEGRATION_NOTES lists it as open.
- Smallest repair: implement audit-task → `normalizeTenantRecord` input mapping + round-trip privacy test over real audit output.

### A11 — PRODUCT: real GitHub mode lacks a single committed command (MEDIUM, refined from prior cycles)
- Evidence: §7; grep: no `collectHistory` reference in `apps/cli/src`.
- Smallest repair: add `--github OWNER/REPO` (reads `BEETLEJUICE_GITHUB_TOKEN`) wiring `collectHistory → appendAll → exportCoreAudit → report`, keeping the fixture demo clearly separate; document env setup in README quickstart (also closes P0 #11).

Observations (no P0 action):
- Det-retry/dup-CI trust adapter-supplied equivalence keys; core defends every boundary it can (missing keys, revisions, overlap, success poisoning) — residual trust is documented and reasonable.
- Webhook/App-auth surfaces remain ahead of schedule (P1) but have no receiving endpoint; they are libraries, correctly not marketed as a service.

---

## 9. What held up under attack (credit where due)

- **Repairs stuck:** R1/R3/R5/A2 all verified by execution this cycle (E10/E12/E13/E14), each with regression tests named after the audit findings they close. The core lane ships an honest `INTEGRATION_NOTES.md` listing exactly what remains open.
- **The merged workspace is real:** clean merges, one-suite 319/319, deterministic economics-first demo — the product is no longer hypothetical, only unmounted.
- **Privacy gate:** survived a broader battery than last cycle, including value-leak string scans on every rejection channel and injection payload smuggling.
- **Honesty mechanisms everywhere:** unknown costs stay unknown; unbalanced ledgers refuse to export; live GitHub failures propagate as errors; speculative savings deliberately unestimated; ≥100% waste ratios carry sanity notes.

---

## 10. Recommended next actions (in order, smallest first)

1. **Mount the merge (A-CAND):** integrate the four lane branches onto `lab/integration`; push; confirm CI. All commands already executed successfully in E20–E22.
2. **Repair X1** in `duplicate-ci.js` + negative regression (blocks P0 #5).
3. **Commit the cross-package e2e** (A9): fixture → ledger → export → CLI render; extend it with the `--input` path once A7 is decided.
4. **Resolve A7** (adapter-side v2-bundle builder OR de-document `--input` as real mode) so docs match runtime.
5. Fix the CI guard prune list (A6/R6).
6. Add `--github OWNER/REPO` token→report command + README quickstart (closes P0 #7 and #11 as product behavior, not snippets).
7. Implement tenant→privacy producer mapping + round-trip privacy test over real audit data (A10).
8. Only then flip `p0_checks` in `state/factory.json` — each backed by an executed command recorded in this report’s style. Lane evidence alone flips nothing.

---

*Audit method note: every FAIL above is backed by an executed command or probe preserved under `/tmp/opencode/probes32931221589/`; documentation, docstrings and hand-written fixtures were never accepted as runtime proof. Test counts re-run during this audit: core 82, github 102, privacy 72, product 63 (319 total), plus merged-tree 319/319 and demo exit 0.*
