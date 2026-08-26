# BEETLEJUICE — Adversarial Product Audit (latest)

- **Auditor:** product_auditor
- **Date:** 2026-08-26
- **Audited candidate:** Factory cycle `32941279561` — branch `cycle/32941279561/audit` == `origin/lab/integration`. Product head `25bb22c` (all four lane merges `db927f7` core, `d73e1ca` github, `eb9a833` privacy, `05d6899` product + integration repairs `25bb22c`) with state commit `d56e0c4` on top (`git diff 25bb22c..d56e0c4 --stat`: only `state/factory.json`, so all executions below validate the pushed product head).
- **Verdict: 11/12 P0 criteria PASS on executed evidence. #12 (CI green on the integration candidate) FAILS — and is worse than the state file records: `BEETLEJUICE Product CI` has NEVER been green anywhere in this repository.** The prior audit's blocking defect **A12 is genuinely repaired** (verified by live network instrumentation, not by tests alone). All five prior residuals (EPI-1, TRUST-1, WORD-1, SEAM-DIV, DOC-NIT) landed and survived re-attack. Privacy repelled a harder battery than last cycle, including a cross-layer poison probe through the sanctioned producer. The candidate remains **BUILDING, not P0_READY**, solely because of the CI observation/permission gap.

---

## 1. Executive summary

This cycle's claims check out where they can be executed, and I could execute almost everything from this environment:

- **397/397 tests pass** (`npm test`, zero skipped), including 14 cross-package integration seam tests and 89 core tests.
- The synthetic demo is deterministic (two runs byte-identical) and its arithmetic is internally exact to the micro-dollar: findings $4.15 + $1.83 + $2.07 + $0.94 = **$8.99** = headline; measured $28.57; representable $30.17; $15.085/accepted displayed as $15.09 with the exact value disclosed; ratio 31.47%.
- **A12 is closed at the product surface**: the committed `--github` CLI now performs REAL network I/O. My instrumented probe recorded `fetch_calls=1`, a genuine upstream `401 for GET /repos/octocat/Hello-World/pulls`, exit 3 with typed `UPSTREAM_ERROR` — versus the prior cycle's pre-network `TypeError` with zero fetches. Policy misconfiguration fails fast pre-network (exit 2); missing token refuses with setup guidance (exit 2).
- I additionally ran a **live positive-path read-only audit against real api.github.com** (19 strictly-GET requests → 7 PRs → 54 canonical events → balanced ledger → report labeled `real-github-read-only`, costs honestly unavailable, 6 certain-waste findings emitted with unquantified units at $0.00).
- The privacy gate held against every negative I could construct, including identifier poisoning of every ref/meta field of a tenant ledger pushed through the sanctioned producer bridge into the export envelope: zero needles survive.
- Every "certain waste" rule abstained exactly when it should across 28 new adversarial probes at both the core and product layers.

The one falsification that stuck is **CI**: `integration_ci_green=false` in `state/factory.json` is honest, but understated. Public API evidence shows **zero Actions runs ever on `lab/integration`** and **15/15 failures of Product CI on `main`** — because `main` contains no product code at all (26 files, no packages/, no tests), so the guard correctly fails "No test files found". CI-green has therefore never been demonstrated anywhere, remote or local-on-main. Everything else stands.

---

## 2. Environment and exact commands

```
node v22.23.2, npm 10.9.8, linux x64
repo: /home/runner/work/Beetlejuice/Beetlejuice @ d56e0c4 (= origin/lab/integration; product code identical to 25bb22c)
probes preserved under /tmp/opencode/probe_*.mjs
```

| # | Command | Result |
|---|---------|--------|
| E1 | `npm install --ignore-scripts` | exit 0, 0 vulnerabilities |
| E2 | `npm test` | exit 0 — `# tests 397 / # pass 397 / # fail 0 / # skipped 0 / # todo 0` |
| E3 | `npm run demo` ×2 → `diff` | exit 0 both; **byte-identical** |
| E4 | demo economics recompute | F-001..F-004 sum 8,990,000µ$ = $8.99 = headline; measured $28.57; representable $30.17; $30.17÷2 = $15.085 → "$15.09 (exact value preserved as $15.085)"; ratio 31.47% ✓ |
| E5 | `node apps/cli/src/demo.js --input apps/cli/fixtures/synthetic-audit-v2.json` | exit 0 — same economics verbatim ($28.57 / 2 accepted) |
| E6 | `node apps/cli/src/demo.js --core-audit apps/cli/fixtures/core-audit-export-v1.json` | exit 0 — canonical-core mode renders ($12.65 measured, $5.45 waste, mode labeled) |
| E7 | `node apps/cli/src/demo.js --input apps/cli/fixtures/legacy-v1/synthetic-audit-v1.json` | refused with `INVALID NORMALIZED INPUT … schema_version "1" … migrateNormalizedBundleV1ToV2` (migration pointer works) |
| E8 | `node apps/cli/src/demo.js --out /tmp/opencode/outdir` | wrote `audit-report.md` + `audit-report.json` |
| E9 | `unset BEETLEJUICE_GITHUB_TOKEN; node apps/cli/src/demo.js --github acme/widget` | exit 2 `[GITHUB_TOKEN_MISSING]` + setup guidance; no fabricated audit |
| E10 | `BEETLEJUICE_BRANCH_PREFIXES="a b" BEETLEJUICE_GITHUB_TOKEN=fake … --github acme/widget` | exit 2 `[GITHUB_POLICY_ENV_INVALID]` **before any request** (fail-fast policy validation) |
| E11 | instrumented `runCli(['--github','octocat/Hello-World'])` with fake token, global fetch counter | **exit=3 fetch_calls=1 elapsed≈225ms — `GITHUB AUDIT FAILED (GithubAdapterError UPSTREAM_ERROR): upstream 401 for GET /repos/octocat/Hello-World/pulls`** — real TLS I/O through the committed CLI (A12 falsification test of the prior cycle now inverted: the wiring works) |
| E12 | `node scripts/live-github-audit-probe.mjs eubby06/kids-store` (real api.github.com, unauthenticated, GET-only) | exit 0 — **19 live GETs → 7 PRs → 54 canonical events**, report labeled `real-github-read-only`, 5 accepted outcomes, 6 certain superseded-execution findings, cost components honestly `$0.00/unavailable` |
| E13 | `node --test test/integration/github-real-mode.test.js` | 8/8 pass — incl. CLI success path THROUGH `runCli(['--github',…])` with injected transport (`report.mode=real-github-read-only`, policy disclosure), upstream case asserts `UPSTREAM_ERROR\|NETWORK_ERROR_REDACTED` **and `callCount()>0`** (A12-MASK repaired), malformed env → exit 2 pre-network (`callCount()==0`), emptied policy → exit 2 `matched 0 of 1 pull request(s)` AFTER sweep succeeded |
| E14 | `node --test test/integration/github-bundle-input-seam.test.js test/integration/privacy-audit-producer.test.mjs` | 6/6 pass |
| E15 | `probe_privacy.mjs` (27 checks) + manual follow-ups | gate rejects repository_name / commit_sha / pr_number / developer_login / html_url / api_key / prompt_text / customer_id / tenant_hash; enum-field secret smuggling neutralized; free-text `agent_name` with internal URL rejected; custom agent/model names classified, never echoed; rare combination suppressed; unique record never admitted row-level; purpose required; research licence gate holds; DP flag/aggregate/seed misuse all rejected; cohortThreshold=1 rejected (floor ≥5 per purpose in practice); DP reproducible under fixed seed, seed-dependent, seed never published, counts clamped integers; cost_usd 5.01 vs 9.99 → byte-identical rows in bucket `1_to_10` |
| E16 | `probe_econ_waste.mjs` (17 checks) | dup-CI overlapping windows / non-passed-partition / null-revision partition all ABSTAIN; det-retry transient-first / success-in-group / mode-disagreement all ABSTAIN; inverted supersession rejected (`BAD_SUPERSESSION`); positive controls charge exactly; engine double-count strip exact ($0.50 not $0.60); unresolved ≠ success with cost on books; closed-unmerged → failed; merged+revert flagged; unknown compute counted-not-summed; bundle with `total != Σ components` REJECTED; raw GitHub payload field rejected by normalized-input contract |
| E17 | `probe_product_waste.mjs` (11 checks) | RT-2 v1.2.0 mode-disagreement retry abstains (positive twin charges); R2 successful-retry abstains; WORD-1 wording conditional on `ended_at` (both directions verified); missing `aborted_at` abstains; pre-abort start untouched; R4 non-later replacement abstains; single-claim guard prevents double counting across rules; additive totals exact |
| E18 | `probe_tenant.mjs` (5 checks) | no cross-ledger visibility; frozen `events()` snapshot resists push-corruption; duplicate event_id rejected (`DUPLICATE_EVENT_ID`) |
| E19 | `probe_cross_privacy.mjs` (4 checks) | ledger poisoned in task_ref/execution_ref/revision_key/invocation_ref/tool_ref/ci_ref/pr_ref/source.adapter/source.ref/source.meta → mapped through `mapAuditTaskToPrivacyInput` → exported: **zero needles** (incl. timestamps, org names, SHAs, secrets); out-of-vocab semantic hint rejected without echoing content |
| E20 | pristine `git archive HEAD` checkout + both guard expressions | current ci.yml floor: 59 ≥ 1 ✓; proposed first-party floor: 59 ≥ 20 ✓ |
| E21 | public API `repos/Mickalive/Beetlejuice/actions/runs?branch=lab/integration` | **total_count = 0** (no run ever, any conclusion) |
| E22 | public API all runs, filter `BEETLEJUICE Product CI` | **15 runs, ALL on main, ALL `completed failure`** (run #15 @ 34ed2c31 … run #1 @ de560301). Failure step: "Require a real test suite" → main tree has **26 files total, 0 test files, no packages/apps dirs** |
| E23 | `git ls-tree -r --name-only main \| wc -l`; test-file count | 26 files; **0** matching test patterns — red CI on main is structurally guaranteed until the candidate lands |

---

## 3. P0 scorecard (docs/PRODUCT_OBJECTIVE.md items 1–12)

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | `AGENTIC_TASK` canonical model, versioned | **PASS** | Stored events stamped `schema_version/event_version/collector_version/normalization_version` (probed directly: all four present); fail-closed payload specs (my `tokens` typo was rejected `FORBIDDEN_FIELD` — unknown fields cannot enter); vendor neutrality proven by fictional GitForge adapter suite (89 core tests incl. waste findings without special-casing). |
| 2 | GitHub adapter ingests realistic Actions/PR evidence without becoming the domain | **PASS** | Live execution E12 (19 real GETs → 54 canonical events into a real `TenantLedger`, balanced); committed fixture e2e + canonical-contract suites enforce that GitHub values stay in adapter metadata (`source.*`), never domain keys. |
| 3 | Cost identity `inference+tools+CI+compute(+validation/human)=total` | **PASS** | Enforced at three boundaries: event schema (unknown fields/cost shapes fail-closed), normalized-input validator (`total_amount_micro_usd != Σ representable components` rejected — probed E16), core exporter UNBALANCED_LEDGER guard; unknown-cost components counted, contribute $0, never guessed (E16 C4). Demo arithmetic exact (E4). |
| 4 | Conservative outcome attribution | **PASS** | Priority merged > task_failed > closed-unmerged > aborted > unresolved; unresolved stays partial with cost visible and is never counted successful (E16 C1); revert flags accepted-but-reverted work (E16 C3); privacy mapping demotes reverted acceptance to `revert`. |
| 5 | ≥1 certain-waste detector end-to-end with evidence | **PASS** | Four rules ship with evidence-unit breakdowns; every certainty precondition I attacked abstained correctly (E16/E17): overlap, mixed-status partitions, null revisions, transient-first premises, success-poisoned groups, mode-disagreement retries, backwards supersession, unprovable abort timing, non-later replacements. Double counting impossible by construction (claimed-unit strip, verified both layers). Findings also produced on LIVE data (E12). |
| 6 | Synthetic demo complete without external account | **PASS** | E3–E5: deterministic, economics-first, zero credentials, every savings dollar traced to finding IDs, speculative savings explicitly unestimated. |
| 7 | Read-only GitHub mode runs when credential supplied | **PASS** | A12 repaired and verified three ways: (a) committed CLI-driven success-path test with injected transport passes (E13); (b) committed CLI performs real network I/O and fails honestly upstream with an invalid token (E11 — the exact probe that caught A12 last cycle now exercises the repaired path); (c) full live pipeline executes against a real public repository (E12). Residual: a positive-path run *through the CLI binary* with a valid token was not executable from this environment (no credential available here); the committed success test + live library path cover the seam. |
| 8 | Report leads with cost/outcome/waste, not tokens | **PASS** | Headline table opens with period/tasks/cost/successful outcomes/cost-per-outcome/avoidable spend; tokens confined to "Secondary diagnostics (not economics)"; data-quality section separates measured/estimated/unavailable; JSON report keys confirm structure (E4). |
| 9 | Global-learning export contains no source content/linkable identity | **PASS under attack** | Closed-world 17-field enum GLR; allowlist transform rejects near-miss keys with precise codes; content defense rejects hostile values inside allowed text fields; cohort floors suppress unique combinations (k≥5 effective everywhere); DP aggregates hide exact counts, seed caller-private and never published; cross-layer poison probe clean (E15/E19). No deterministic pseudonym join key exists anywhere in the schema (no id/hash field can be expressed). |
| 10 | Privacy/re-id/cost/outcome/isolation tests pass | **PASS** | 397/397 zero-skipped (E2) plus my independent batteries (E15–E19) all green. |
| 11 | README quickstart; synthetic vs real distinguished | **PASS** | Every advertised command executed (E1–E9); modes labeled `synthetic demo` / `normalized-input` / `canonical-core` / `real-github-read-only` and mutually exclusive; README documents token + policy env vars, `-` opt-out, fail-fast behavior, refusal semantics — all verified true by execution. |
| 12 | CI green on integration candidate | **FAIL** | Local CI steps all pass on HEAD (E1–E3, E20), but remote CI has never observed this candidate: **0 Actions runs ever on `lab/integration`** (E21) and Product CI is **red 15/15 on `main`** because `main` carries zero product code/tests (E22/E23). `state/factory.json` honestly records false and does not claim P0_READY — bookkeeping accurate, but the criterion is objectively unmet. |

**Score: 11 PASS · 1 FAIL (#12).** Per the stop rule this is not P0_READY, and per the director contract `continue=true` with status `BUILDING` is correct bookkeeping.

---

## 4. Certain-waste falsification attempts — every rule re-attacked

All prior-cycle residuals were confirmed repaired by execution, then re-attacked with new negatives:

- **WASTE_DUP_CI_V1** — G5 (any non-passed termination poisons the partition) and G6 (null-revision partitions never produce findings) both hold; overlapping windows abstain (G3); missing timing abstains (G4); positive control charges each post-pass repeat individually. TRUST-1 from last cycle is closed: config-only equivalence keys can no longer manufacture cross-revision charges because unknown-revision partitions abstain entirely (E16 N2/N3).
- **WASTE_DET_RETRY_V1 (+ product IDENTICAL_RETRY_AFTER_DETERMINISTIC_FAILURE v1.2.0)** — EPI-1/RT-2 alignment is real and symmetrical across layers: a post-premise repeat whose own failure class differs poisons the whole group (core G4, product `retry_mode_disagreement` counter — E16 N6, E17). Success in group poisons (G1/R1); first failure stays free (G2); missing equivalence key abstains (G3); successful retry abstains at product layer (R2). Positive twin controls still charge (both layers).
- **WASTE_EXEC_SUPERSEDED_V1** — strictly-later replacement enforced at reconstruction (`BAD_SUPERSESSION` on inverted chains, E16 N7) AND at product layer (R4 guard counts abstentions). Charging a superseded exec whose replacement later failed remains documented hindsight accounting; defensible within stated epistemics.
- **EXECUTION_AFTER_TASK_ABORT (product extension)** — only post-abort starts charged; missing `aborted_at` abstains; WORD-1 wording now conditions "ran to completion" on recorded `ended_at` (verified both directions, E17).
- **Composition** — claimed-unit strips make totals exact under rule overlap (E16 P3: $0.50 attributed once, disjoint refs; E17 single-claim guard). Demo savings equal the exact sum of findings (E4).

No finding in the shipped fixtures or live output violates its rule preconditions. Nothing labeled "certain" is merely probable on this tree.

---

## 5. Demo-only vs real GitHub mode

- **Synthetic demo**: labeled as such; no ingestion path exists for raw provider payloads (validator rejects GitHub marker keys — probed).
- **Committed `--github` command**: now genuinely real. It resolves the classification policy pre-network (env override / explicit `-` opt-out / documented conservative default), refuses honestly on missing token or matched-nothing policies, performs real GET requests (instrumented: fetch_calls=1, live 401 surfaced as typed `UPSTREAM_ERROR`), and labels every report `real-github-read-only`.
- **Library path**: proven live end-to-end against api.github.com during this audit (E12), producing honest unavailability rather than invented costs.
- No simulation masquerades as GitHub data anywhere; conversely, the real mode can no longer be mistaken for dead code.

---

## 6. Findings (highest severity first) and smallest repairs

### CI-NEVER-GREEN — P0 #12 unmet; CI has never passed anywhere (HIGH, carried/structural)
- Evidence: E21 (lab/integration runs ever = 0), E22 (Product CI 15/15 failure on main), E23 (main has 26 files, 0 tests — the "Require a real test suite" guard fails correctly). Note: pushes made with the repository App/GITHUB_TOKEN do not trigger workflows, which is why lab/integration has no runs despite containing passing steps locally.
- Impact: P0 cannot be declared; the default branch presents a docs-only repo with permanently red CI to any external observer.
- Smallest repairs (in order of preference, all supervisor-side):
  1. From a workflows-capable context, merge `lab/integration` (25bb22c/d56e0c4) into `main` — push-to-main triggers Product CI AND fixes the red-default-branch problem in one action; observe the run via the checks API; flip `integration_ci_green`.
  2. Or create a PR `lab/integration` → `main` using a USER token (pull_request trigger fires CI; creating a PR does not require the workflows permission — only pushing workflow-file edits does).
  3. Or grant the factory App the `workflows` permission so the pending `reports/ci-guard-proposal.md` hardening commit can land and future pushes self-verify.

### MAIN-DIVERGENCE — default branch lacks the entire product (MEDIUM, structural observation)
- Evidence: E23. `main` = control plane only; every product capability lives on lane branches. This is what makes CI-on-main meaningless and hides the product from anyone but the factory.
- Smallest repair: same action as CI-NEVER-GREEN option 1 (merge candidate to main once CI is observed green).

### LIVE-REPORT-ZERO-DOLLARS — headline can read "$0.00 total / $0.00 per outcome" when no billing evidence exists (LOW, cosmetic honesty risk)
- Evidence: E12 output — a real repository audit with zero supplied cost sources prints `Total measured cost **$0.00**` and `Cost per successful outcome **$0.00**`. Technically honest ($0 representable spend), but economically misleading at headline position; the data-quality section does disclose unavailability.
- Smallest repair: when representable spend is $0 AND unavailable components > 0, render the headline cells as "no measurable cost evidence supplied" instead of "$0.00", keeping the numeric table unchanged.

### BOOKKEEPING-NIT — factory evidence line says "pushed head 25bb22c"; `git ls-remote` now returns d56e0c4 (LOW)
- Evidence: `git ls-remote origin refs/heads/lab/integration` → `d56e0c4…`; diff 25bb22c..d56e0c4 touches only `state/factory.json`.
- Smallest repair: next state update should cite "product head 25bb22c + state commit d56e0c4" to keep ls-remote checks trivially verifiable.

### DP-SEED-COLLISION — different dpSeeds can yield identical published counts at high epsilon (INFO, expected statistics, not a defect)
- Evidence: with ε=2 (scale 0.5) seeds 12345/999 produced 26 vs 25 for size-25 cohorts; at ε=0.1 the same seeds diverge 47 vs 19. Seed-dependence verified working; rounding can coincide at low noise scales.
- Smallest repair: none required; optionally document that count equality across seeds is possible by construction.

---

## 7. Verification of `state/factory.json` claims (this cycle)

| Claim | Audit result |
|---|---|
| 397/397 tests on pushed head | ✅ reproduced exactly (E2) |
| demo ×2 byte-identical; $28.57 / 2 accepted / $15.09 | ✅ reproduced exactly (E3/E4) |
| A12 closed: instrumented rerun exit=3 fetch_calls=1 UPSTREAM_ERROR | ✅ reproduced independently before reading the claim (E11) |
| CLI-driven success tests incl. callCount>0 assertions (A12-MASK) | ✅ committed tests pass and assert exactly that (E13) |
| input seam $28.57 verbatim; no-token refusal exit 2 | ✅ (E5/E9) |
| quickstart_docs flip justified | ✅ every advertised command executed successfully (E1–E9) |
| pristine archive guard 59 ≥ 20 green | ✅ (E20) |
| lab/integration Actions total_count=0 | ✅ confirmed via public API (E21) |
| workflow-file push remote-rejected without workflows permission | consistent with observed App-token behavior; proposal doc preserved (reports/ci-guard-proposal.md) |
| "every other criterion already flipped on executed evidence this cycle" | ✅ all 11 other criteria re-verified by execution above |

The state file is accurate on every point I could execute. Its one soft spot is framing, not fact: `next_action` says "sole remaining P0 item" — correct — but the CI gap is older than this cycle implies: CI has never been green on ANY ref (E22).

---

## 8. What held up under attack (credit)

- **A12 repair is real**, verified by network instrumentation rather than by trusting tests; the masking test hole (A12-MASK) is closed with transport-call-count assertions.
- **Every prior residual landed**: EPI-1 (both layers), TRUST-1 (G6), WORD-1 (conditional wording), SEAM-DIV (documented divergence NORMALIZED_INPUT.md §outcome mapping), DOC-NIT (correct producer reference).
- **Privacy depth increased safely**: seeded Laplace DP with per-purpose epsilon ceilings was added WITHOUT weakening row-level gates; misuse shapes (ε without flag, DP without aggregate mode, missing seed, threshold below floor) are all rejected; seed never published; mechanism disclosed.
- **Honesty mechanisms everywhere**: unknown ≠ zero; estimated ≠ measured; unresolved never success; unbalanced never exported; secrets never echoed; savings never speculative.
- **Factory bookkeeping**: fully consistent with executed reality this cycle.

## 9. Recommended next actions (ordered, smallest first)

1. Execute CI on the candidate (supervisor-side; options in CI-NEVER-GREEN) and flip `integration_ci_green` from the observed run conclusion — the only open P0 item.
2. Merge the candidate to `main` (fixes MAIN-DIVERGENCE and makes CI-on-main meaningful).
3. Land `reports/ci-guard-proposal.md` (needs workflows permission) so scaffold-only green builds stay impossible.
4. Optional LOW repairs: LIVE-REPORT-ZERO-DOLLARS headline wording; BOOKKEEPING-NIT citation precision.
5. Only after (1) observes green: set status `P0_READY` per the stop rule.

---

*Audit method note: every verdict above is backed by an executed command or probe preserved under `/tmp/opencode/probe_*.mjs`. Documentation, docstrings, committed tests and state-file claims were treated as claims until re-executed — the two places where this audit's environment diverged from the state file's narrative (no valid GitHub credential available; remote CI unobservable) are recorded explicitly rather than smoothed over.*
