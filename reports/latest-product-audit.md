# BEETLEJUICE — Adversarial Product Audit (latest)

- **Auditor:** product_auditor
- **Date:** 2026-08-26
- **Audited candidate:** Factory cycle `32957437769` — `origin/lab/integration` @ `fd9b0db` (== local branch `cycle/32957437769/audit`; verified via `git ls-remote`).
- **Verdict: 11/12 P0 criteria PASS on executed evidence; #12 (CI green on the candidate) still FAILS — and the cycle's integration itself FAILED silently.** The product tree shipped as the "integrated candidate" is **byte-identical to last cycle's verified head**: none of the four lane branches of cycle 32957437769 (~2,900 lines of real work: a new core waste rule, GitHub workflow-jobs collection, privacy hardening + no-echo tests, and the zero-dollar-headline repair) is an ancestor of the candidate. The integration director hit exactly one cross-lane test break, recorded `integration_test_rc=1` in `reports/integration-runtime-status.txt`, and then pushed the *unmodified prior tree* under the commit message "Factory 32957437769: integrate product candidate". I reproduced the break, root-caused it, and proved the smallest repair: after two one-line fixture stubs, the fully merged tree passes **459/459**. The product code that was audited remains sound; the process that shipped it did not integrate anything.

---

## 1. Executive summary

What I could execute, I executed from this environment:

- **Candidate identity:** `git ls-remote origin refs/heads/lab/integration` → `fd9b0db…`; working tree identical. `git diff 5799144..HEAD -- packages apps test` → **empty** (product tree unchanged since the prior verified head); `git diff 980b223..HEAD --stat` → only `reports/integration-runtime-status.txt` (1 line). The single content change of this cycle's "integration" commit is `integration_test_rc=0` → `integration_test_rc=1`.
- **Lane drop proven:** merge-base of HEAD with every cycle-32957437769 lane is `980b223`; lane tips `a4e8dfa` (core), `ab157fe` (github), `b6fd8d0` (privacy), `f02563b` (product) are not ancestors.
- **397/397 tests pass** on the candidate (`npm test`, exit 0, zero skipped) — but that is the *old* tree.
- The synthetic demo is deterministic (two runs byte-identical) and its arithmetic is exact to the micro-dollar: findings $4.15+$1.83+$2.07+$0.94 = **$8.99** = headline avoidable spend; measured $28.57; $30.17 ÷ 2 = $15.085 displayed as $15.09 with exact value disclosed; waste ratio 899/2857 = 31.47% exact.
- Real-mode honesty re-verified by live network instrumentation: missing token → exit 2 refusal; invalid token → exit 3 typed `GithubAdapterError UPSTREAM_ERROR` over **real** HTTPS I/O (upstream 401), token value never echoed; malformed policy env → exit 2 with **zero** network calls.
- My independent adversarial batteries all hold on this tree: **privacy 60/60**, **certain-waste/economics 24/24**, **tenant isolation clean** (after correcting two wrong probe assumptions), **seam contract 3/3**.
- P0 #12 remains objectively unmet: public API shows **total_count=0 Actions runs ever on `lab/integration`** and Product CI red on `main` (latest run on `34ed2c31`, conclusion `failure`, 2026-08-26T03:24:15Z). The one-toggle external ask from the previous cycle has still not been granted.

---

## 2. Environment and exact commands

```
node v22.23.2, npm 10.9.8, linux x64
repo: /home/runner/work/Beetlejuice/Beetlejuice @ fd9b0db (= origin/lab/integration)
probes preserved under /tmp/opencode/probe_*.mjs; merge reproduction in /tmp/opencode/merge-repro (scratch worktree)
```

| # | Command | Result |
|---|---------|--------|
| E1 | `npm install --ignore-scripts` | exit 0, 0 vulnerabilities |
| E2 | `npm test` | exit 0 — `# tests 397 / # pass 397 / # fail 0 / # skipped 0 / # todo 0` |
| E3 | `npm run demo` ×2 → `diff` | exit 0 both; **byte-identical** |
| E4 | demo arithmetic recompute | Σfindings [415,183,207,94]¢ = 899¢ = headline; ratio 899/2857 = 31.47% ✓ |
| E5 | `git diff 5799144..HEAD -- packages apps test` | empty — candidate product tree == prior verified head |
| E6 | `git merge-base HEAD origin/cycle/32957437769/{core,github,privacy,product}` | `980b223` for all four — **no lane work integrated** |
| E7 | scratch worktree @ fd9b0db: merge core lane → `npm test` | clean merge; **420/420 pass, rc=0** |
| E8 | same: + github lane → `npm test` | clean merge; **# pass 433 / # fail 3, rc=1** ← reproduces the committed `integration_test_rc=1` |
| E9 | same: + privacy lane + product lane → `npm test` | clean merges; **456 pass / 3 fail** |
| E10 | failure inspection | all 3 failures are `UPSTREAM_ERROR: upstream 404 for GET /repos/demo-fixture/agentic-pipeline/actions/runs/5100/jobs` in `apps/cli/test/cross-package-seam.test.js` and `test/integration/github-real-mode.test.js` — the github lane's new workflow-jobs collector hits a route those two older transports don't mock |
| E11 | add one line per transport (`if (/\/actions\/runs\/(\d+)\/jobs$/.test(p)) return { status: 200, headers: {}, json: { total_count: 0, jobs: [] } };`) → `npm test` | **459/459 pass, rc=0** — full four-lane merge green |
| E12 | `npm run demo` on fully merged+fixed tree | exit 0; economics verbatim ($28.57 / $15.09 / $8.99 / 31.47%) |
| E13 | `--core-audit` zero-cost export on merged tree | headline renders `no measurable cost evidence supplied` (product lane repair works) |
| E14 | `env -u BEETLEJUICE_GITHUB_TOKEN node apps/cli/src/demo.js --github acme/widget` | exit 2 `[GITHUB_TOKEN_MISSING]` + setup guidance; no fabricated audit |
| E15 | `BEETLEJUICE_GITHUB_TOKEN=<invalid> node apps/cli/src/demo.js --github octocat/Hello-World` | exit 3, stderr `GITHUB AUDIT FAILED (GithubAdapterError UPSTREAM_ERROR): upstream 401 for GET /repos/octocat/Hello-World/pulls`; `grep -c INVALIDTOKENVALUE` stdout/stderr → 0/0 (no credential echo) |
| E16 | instrumented `runCli(['--github','acme/widget'])` with malformed `BEETLEJUICE_BRANCH_PREFIXES="a b"` | exit 2 `[GITHUB_POLICY_ENV_INVALID]`, fetch_calls=0 — fails fast pre-network |
| E17 | zero-cost canonical-core report on **candidate** | headline prints `Total measured cost **$0.00**` and `Cost per successful outcome **$0.00**` while `Unavailable cost components = 1` — LIVE-REPORT-ZERO-DOLLARS persists here (its fix sits unintegrated on the product lane) |
| E18 | `curl -s https://api.github.com/repos/Mickalive/Beetlejuice/actions/runs?branch=lab%2Fintegration` | `total_count = 0` — CI has never observed the candidate branch |
| E19 | `curl -s …/actions/runs?per_page=20` | Product CI on `main@34ed2c31` → `failure` (03:24:15Z); supervisors green; no workflow-capable context added this cycle |
| E20 | `git ls-tree -r --name-only origin/main \| wc -l`; grep for tests/packages | 26 files; **0** test files, no `packages/` — main remains a docs-only control plane |
| E21 | privacy battery `/tmp/opencode/probe_privacy.mjs` | **60 pass / 0 fail** (see §5) |
| E22 | waste+economics battery `/tmp/opencode/probe_waste.mjs` | **24 pass / 0 fail** (see §6) |
| E23 | real-mode battery `/tmp/opencode/probe_realmode.mjs` | missing-token exit 2 ✓; invalid-token real I/O + typed error + no leak ✓; malformed-policy callCount=0 ✓; zero-dollar headline confirmed ✗(expected finding) |

---

## 3. P0 scorecard (docs/PRODUCT_OBJECTIVE.md items 1–12)

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | `AGENTIC_TASK` canonical model, versioned | **PASS** | Probed directly on stored events: `schema_version="1" event_version="1" collector_version="beetlejuice-core-collector@1.0.0" normalization_version="beetlejuice-core-normalization@1.0.0"`; event schema is fail-closed (unknown payload fields rejected `FORBIDDEN_FIELD` — probed via cost-shape negatives inside E22 fixtures); vendor neutrality enforced by adapter-extensibility suite inside npm test. |
| 2 | GitHub adapter ingests realistic Actions/PR evidence without becoming the domain | **PASS** | Canonical-contract + e2e-fixture suites inside E2 keep GitHub values in adapter metadata (`source.*`), never domain keys; raw provider payloads are rejected at both product seams (E22 seam battery: injected `workflow_run` rejected). Live positive path was demonstrated last cycle against api.github.com and nothing in this unchanged tree regressed it. |
| 3 | Cost identity `inference+tools+CI+compute(+validation/human)=total` | **PASS** | Three boundaries enforce it: event schema (exact cost-object shapes), normalized-input validator (`total_amount_micro_usd != Σ representable components` → rejected — probed), core-audit seam refuses unbalanced ledgers (`accountingBalanced !== true`). Demo arithmetic exact (E4). Unknown components counted, contribute $0, never guessed (E22: superseded unknown-cost unit rendered unquantified at $0). |
| 4 | Conservative outcome attribution | **PASS** | Probes: unresolved task never counted success with cost visible on books; closed-unmerged PR attributes failed/closed, never `"accepted"`; merged+revert flagged `revert`; `costPerAcceptedOutcomeMicroUsd` exact ($1.50 = $3.00 ÷ 2) from fixtures; core-audit seam rejects identity-violating exports. |
| 5 | ≥1 certain-waste detector end-to-end with evidence | **PASS** | Four rules ship; demo emits F-001..F-004 summing exactly to the headline. Every certainty precondition I attacked abstained correctly (24-probe battery, §6): overlapping windows, mixed-status partitions, null/unknown revisions, transient-first premises, success-poisoned groups, mode-disagreement retries, non-superseded chains, cross-revision same-key charges. Double-count strip exact ($0.50 not $1.00 on overlapping rule claims). |
| 6 | Synthetic demo complete without external account | **PASS** | E3/E4/E12: deterministic, credentials-free, economics-first, every savings dollar traced to finding IDs. |
| 7 | Read-only GitHub mode runs when credential supplied | **PASS** | Missing token refuses honestly (exit 2); invalid token performs REAL network I/O and surfaces a typed upstream 401 without echoing the credential (E15); malformed policy fails pre-network with zero requests (E16); committed CLI-driven success tests with injected transport assert `callCount()>0` (inside E2). Residual unchanged: no valid credential exists in this environment to drive the positive path through the CLI binary end-to-end. |
| 8 | Report leads with cost/outcome/waste, not tokens | **PASS** | Headline table order verified in output; tokens confined to "Secondary diagnostics (not economics)"; data-quality section separates measured/estimated/unavailable. |
| 9 | Global-learning export contains no source content/linkable identity | **PASS under attack** | Closed-world 17-field enum GLR; allowlist transform rejects near-miss keys with precise codes; hostile free text in identity fields rejected; cohort floors suppress unique combinations; DP misuse shapes rejected; seed caller-private; rejection entries never echo offending values (60-probe battery, §5). No id/hash/pseudonym field can be expressed in the schema. |
| 10 | Privacy/re-id/cost/outcome/isolation tests pass | **PASS** | 397/397 zero-skipped (E2) plus my independent batteries E21–E23 all green. Tenant isolation re-verified: ledger B exposes none of ledger A's refs/amounts through any audit export; duplicate explicit `event_id` rejected `DUPLICATE_EVENT_ID`. |
| 11 | README quickstart; synthetic vs real distinguished | **PASS** | Every advertised command executed (E1–E4, E14–E15); modes labeled `synthetic demo` / `normalized-input` / `canonical-core` / `real-github-read-only` and mutually exclusive. |
| 12 | CI green on integration candidate | **FAIL** | Local CI steps all pass on HEAD (E1–E4), but remote CI has never observed any ref carrying the product: **0 Actions runs ever on `lab/integration`** (E18) and Product CI red on docs-only `main` (E19/E20). The workflows-permission toggle identified last cycle as the smallest external action has still not been granted. |

**Score: 11 PASS · 1 FAIL (#12)** — identical to last cycle because the shipped candidate is functionally the same tree. Per the stop rule this is not P0_READY.

---

## 4. NEW DEFECT — the cycle's integration dropped all lane work (this is the headline)

### D1 — INTEGRATION-DROP: candidate contains none of cycle 32957437769's lane work (CRITICAL)
- Evidence:
  - Lane tips exist with substantial work: core `a4e8dfa` (+704 lines incl. new `WASTE_EXECUTION_AFTER_ABORT` rule + cost-evidence-state suite), github `ab157fe` (+1235 lines incl. data-minimizing workflow-jobs collector, cost-source adapters), privacy `b6fd8d0` (+725 lines incl. no-echo + contribution-cap batteries), product `f02563b` (+229 lines incl. the zero-dollar-headline honesty repair).
  - `git merge-base HEAD <each lane tip>` = `980b223` for all four → none integrated.
  - `git show --stat fd9b0db`: touches ONLY `reports/integration-runtime-status.txt` (1 line).
  - That file now records `integration_test_rc=1` — the director observed the cross-lane failure and shipped anyway.
- Impact: the factory's own product progress (~2,900 lines, including repairs for previously audited findings) silently vanished from the integration line; `state/factory.json` still says `cycle: 32941279561` with prior-cycle evidence — the supervisor cannot see this cycle's true state. WC-006's integration contract ("bring useful changes into lab/integration; repair cross-lane interfaces; leave the branch strictly more product-complete") and PRODUCT_OBJECTIVE's director rule (update factory.json every cycle) were both violated. The commit message "integrate product candidate" misdescribes its content.
- Smallest repair (verified end-to-end by me):
  1. Merge the four lanes into `lab/integration` (all merge cleanly, zero conflicts — E7–E9).
  2. Add ONE stub line to each of the two stale transports so they serve the new jobs route: `if (/\/actions\/runs\/(\d+)\/jobs$/.test(p)) return { status: 200, headers: {}, json: { total_count: 0, jobs: [] } };` (exact patch applied in my scratch worktree).
  3. Result: **459/459 tests pass** (E11), demo unchanged (E12), zero-dollar repair live (E13).

### D2 — CONTRADICTORY-EVIDENCE: failing rc committed as an "integrated candidate" (HIGH)
- Evidence: E2 vs `reports/integration-runtime-status.txt`. The pushed tree passes 397/397 locally, yet the file committed alongside it declares `integration_test_rc=1` with no explanation, no blocker note, and no factory.json update. A reader cannot tell whether tests were broken (they weren't, on the pushed tree) or integration was abandoned (it was).
- Smallest repair: land R1 above; rewrite the runtime status to record per-step results truthfully (lane merges, test rc before/after repair); update `state/factory.json` with this cycle's evidence and `cycle: 32957437769`.

### D3 — CI-NEVER-GREEN — P0 #12 unmet (carried, HIGH, external toggle still pending)
- Evidence: E18 (lab/integration runs ever = 0), E19 (Product CI red on main), E20 (main = 26 files, 0 tests, no product code).
- Smallest repairs (supervisor-side, unchanged from last cycle): (a) grant the factory App the `workflows` permission so the prepared `ci.yml` (workflow_dispatch) lands and self-verifies; or (b) merge `lab/integration` → `main` from any workflows-capable/user context (fires CI AND fixes the docs-only default branch); or (c) open a PR `lab/integration` → `main` with a user token (pull_request trigger needs no workflows permission). Never flip `integration_ci_green` without an observed remote run.

### D4 — LIVE-REPORT-ZERO-DOLLARS persists ON THE CANDIDATE (LOW, carried — fix already exists on the unintegrated product lane)
- Evidence: E17 vs E13. On the candidate, a real-mode-shaped report with zero representable spend and unavailable cost components prints `$0.00` headlines; on the fully merged tree the product lane renders `no measurable cost evidence supplied`.
- Smallest repair: subsumed by D1/R1 — integrate the product lane.

### BOOKKEEPING-NIT (resolved last cycle, watch item)
`state/factory.json` citations now separate product head from state commits correctly; this cycle's regression is the missing update itself (D1/D2), not citation framing.

---

## 5. Privacy falsification attempts — gate holds (60/60)

Battery `/tmp/opencode/probe_privacy.mjs` against the candidate:

- **Identifier smuggling:** 18 hostile input keys (`repository_name`, `commit_sha`, `pr_number`, `developer_login`, `customer_id`, `tenant_hash`, `html_url`, `api_key`, `prompt_text`, `run_id`, `started_at`, `branch_name`, `__proto__`, `constructor`, `id`, `sha256`, `email`) — every one rejected fail-closed with a precise reason code, including prototype-chain keys (own-property allowlist check confirmed in code and by execution).
- **Content smuggling through allowed text fields:** URL-bearing agent names, credential assignments, multiline values, issue-reference patterns, paths, IPs, oversized blobs — all rejected via the content scanner on the text-only path; where an explicit enum twin is supplied the raw text is dropped by documented precedence and provably never echoed into the record (checked byte-level).
- **Closed world:** GLR with an extra identifier field, a missing field, or a non-vocabulary enum value is invalid; no record shape exists that could carry an id/hash/pseudonym join key.
- **Cohort suppression:** unique 3-field-deviant combination suppressed at k=5; cohort of 6 admitted; a lone unique record is never admitted row-level; purpose floors enforced (telemetry/benchmark k≥5, research k≥25; requested k below floor clamps up, k=1 rejected).
- **Purpose binding & rights surfaces:** missing/unknown purpose rejected; research licensing requires explicit acknowledgement; installation alone grants nothing.
- **Differential privacy misuse shapes:** ε without flag, DP without aggregate mode, missing/empty seed, ε above ceiling (clamped down per-purpose), negative ε — all rejected or safely clamped; noise is seed-dependent and reproducible under fixed seed; counts are non-negative integers; **seed never appears in the published envelope** (string-scanned).
- **Bucketing collapses near-identical magnitudes:** cost_usd 5.01 vs 9.99 → byte-identical bucket `1_to_10`, no raw magnitude anywhere in the normalized record.
- **No value echo:** rejection entries contain reason codes and field names only; hostile values unrecoverable from any output channel (checked for URL/PR-number leakage).

Cross-layer producer bridge (`mapAuditTaskToPrivacyInput`) was poison-tested last cycle on this same tree and is included in the 397 (gate rejects poisoned hints even through the sanctioned producer).

## 6. Certain-waste falsification attempts — rules abstain exactly when they should (24/24)

Battery `/tmp/opencode/probe_waste.mjs`:

- **WASTE_DUP_CI_V1:** positive control charges exactly one post-pass repeat ($0.50); overlapping windows abstain (G3); missing timing abstains (G4); any non-passed member poisons the partition — including failed→passed flips and cancelled members (G5); omitted `revision_key` partitions abstain entirely (G6 — note the schema forces omission, null is rejected, so unknown revisions cannot sneak in); same equivalence key across different revisions never charges (G2).
- **WASTE_DET_RETRY_V1:** three blind repeats after classified deterministic failure charge both repeats ($0.50 total, first failure free); transient-first establishes no premise; success in group poisons (G1) in either position; mode disagreement poisons (G4/EPI-1); a second *different* deterministic class also poisons.
- **WASTE_EXEC_SUPERSEDED_V1:** positive charges $0.70 once; completed (non-superseded) chains never charge; unknown-cost components render unquantified at $0 rather than guessed.
- **Composition:** overlapping rule claims are stripped globally — no evidence ref claimed twice; totals exact ($0.50 attributed once, not double-counted).
- **Economics/attribution:** unresolved ≠ success with cost on books; closed-unmerged ≠ accepted; revert flagging; `costPerAcceptedOutcomeMicroUsd` exact; bundle validator rejects unbalanced component sums and raw GitHub payload fields.

No finding emitted by the shipped fixtures violates its rule preconditions. Nothing labeled "certain" is merely probable on this tree.

## 7. Demo-only vs real GitHub mode

- Synthetic demo: clearly labeled; no ingestion path accepts raw provider payloads (validator rejects GitHub marker keys — probed).
- Committed `--github` command performs REAL network I/O: instrumented and spawned-process verified (exit 3, typed `UPSTREAM_ERROR`, genuine upstream 401, zero credential echo); refusals (missing token, matched-nothing policy, malformed env) happen honestly with actionable guidance and, where applicable, zero requests.
- The distinction is load-bearing and holds: no simulation masquerades as GitHub data; the real path is not dead code.

## 8. What held up / what did not

**Held up (credit):** the entire V1 economic engine, privacy gate, honest-refusal semantics, determinism, and every adversarial battery I threw at the product tree — 84 independent checks plus 397 committed tests, zero product defects found beyond the carried LOW cosmetic item.

**Did not hold up (process):** the integration function itself. This cycle produced four lanes of real, mutually compatible product progress and shipped a candidate containing none of it, with a failing-rc status file as the only trace. The sole technical obstacle was two lines of test fixture. An autonomous factory whose integration step silently discards a cycle's work will oscillate forever at 11/12 regardless of how good the lanes are.

## 9. Recommended next actions (ordered, smallest first)

1. **Land the lanes** (repairs D1/D2): merge core→github→privacy→product into `lab/integration`; add the two one-line jobs-route stubs (E11 proves 459/459 green); update runtime status truthfully; refresh `state/factory.json` to cycle 32957437769 with executed evidence.
2. **Close P0 #12** (supervisor-side): grant the factory App the `workflows` permission (then the prepared ci.yml self-verifies), or merge/PR the candidate into `main` from a workflows-capable context; flip `integration_ci_green` only from an observed run conclusion.
3. Only after (2) observes green: set status `P0_READY` per the stop rule.
4. Optional hygiene: assert in CI that lane tips are ancestors of `lab/integration` at close time (cheap guard against silent drops like D1).

---

*Audit method note: every verdict above is backed by an executed command listed in §2 or a probe preserved under `/tmp/opencode/`. Documentation, committed tests and state-file claims were treated as claims until re-executed. All product-code experiments (lane merges, fixture stubs) were performed in a disposable scratch worktree (`/tmp/opencode/merge-repro`); the audited repository was not modified.*
