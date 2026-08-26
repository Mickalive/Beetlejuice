# BEETLEJUICE — Adversarial Product Audit (latest)

- **Auditor:** product_auditor
- **Date:** 2026-08-26
- **Audited candidate:** Factory cycle `32921371826` — branch `cycle/32921371826/audit` == `origin/lab/integration` @ `5b2a828`
- **Cycle lane snapshots also audited:** `origin/cycle/32921371826/core` @ `4ebc931`, `origin/cycle/32921371826/product` @ `47d255f`
- **Verdict: REJECT — NOT P0_READY.** `state/factory.json` (`status=BUILDING`, all `p0_checks=false`) is accurate and must not be advanced.

---

## 1. Executive summary

The integration candidate contains **zero product code**: only docs, CI configuration, agent definitions and bootstrap state. The cycle's two lane branches contain genuinely good engineering (59 + 34 passing tests; a working synthetic demo with hand-verifiable arithmetic), but **they were never integrated**, they implement **two divergent canonical models**, and the two P0-critical lanes (**privacy gate WC-003, GitHub adapter WC-002**) produced **no code at all** in this cycle.

Adversarial probes **falsified the "certain" confidence of waste findings** in both lanes at rule boundaries, found a ledger-integrity defect that lets unvalidated events flip outcome attribution, and confirmed CI cannot be green on the candidate by its own rules. Cost-accounting identity and tenant isolation, by contrast, **held up under attack**.

Documentation-only claims (README privacy invariant, "real read-only mode") are not counted as evidence anywhere below.

---

## 2. Environment and exact commands

```
node v22.23.2, npm 10.9.8, linux
repo: /home/runner/work/Beetlejuice/Beetlejuice (branch cycle/32921371826/audit)
lanes mounted via: git worktree add /tmp/opencode/bj-core origin/cycle/32921371826/core
                   git worktree add /tmp/opencode/bj-product origin/cycle/32921371826/product
```

| # | Command | Where | Result |
|---|---------|-------|--------|
| E1 | `npm install --ignore-scripts && npm test` | candidate | exit 0 — **0 tests, 0 pass** (vacuous green) |
| E2 | `npm run demo` | candidate | exit 1 — `Cannot find module '.../apps/cli/src/demo.js'` |
| E3 | pristine checkout: `git archive HEAD \| tar -x -C fresh && <ci.yml guard find>` | fresh copy of candidate | `TEST_COUNT=0` → guard exits 1 ("zero-test green build is forbidden") |
| E4 | `npm test` | bj-core lane | exit 0 — **59/59 pass** (~0.5 s) |
| E5 | `npm test` | bj-product lane | exit 0 — **34/34 pass** |
| E6 | `npm run demo` | bj-product lane | exit 0 — full report; `$28.57 measured / $30.17 representable / 2 merged / $15.09 per success / $8.99 avoidable (31.47%)` — **all six figures re-derived by hand from the fixture and correct** |
| E7 | `npm run demo -- --out DIR` and `--input fixture.json --out DIR` | bj-product lane | exit 0 — `audit-report.md` + `audit-report.json` written as documented |

Note on E1/E3: in this dirty workspace the CI guard's `find` counts **149 "test files"**, all vendored `zod` tests under untracked `.opencode/node_modules`. On a real checkout there are none → CI red (E3). The guard's prune list is defective (see R6).

---

## 3. P0 scorecard (docs/PRODUCT_OBJECTIVE.md "P0 definition of done", items 1–12)

Graded against the **integration candidate**; lane-level results are evidence, not integration credit.

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | `AGENTIC_TASK` canonical model, versioned | **FAIL (not integrated)** | Candidate has no `packages/`, no `apps/` (`git ls-tree -r HEAD`). Core lane implements a strong versioned event model (`schema_version/event_version/collector_version/normalization_version` stamped in `events.js:308-321`; strict payload validation; frozen aggregates) — good, unmerged. |
| 2 | GitHub adapter ingesting realistic Actions/PR evidence into the model | **FAIL (absent everywhere)** | No `packages/github/**` on any branch; `grep -rniE "github" packages/core/src` matches comments only. Only a *contract doc* exists (`apps/cli/docs/NORMALIZED_INPUT.md`). No collector turns GitHub history into that contract. |
| 3 | Cost accounting `inference+tools+CI+compute = total` | **FAIL (candidate)** / PASS-in-lane | Probe E on core lane: components `{inference:1000, tools:200, ci:300, compute:400, validation:50, human:70}` µUSD + 1 unknown-cost component → `knownMicroUsd:2020`, `accountingBalanced:true`; unassigned components included exactly once; unknown cost excluded but counted. Identity holds exactly incl. validation/human kinds. |
| 4 | Conservative outcome attribution | **FAIL (candidate)** / PASS-with-notes-in-lane | Core resolution order merged > task_failed > closed-unmerged > aborted > unresolved; unresolved stays visible with `attribution:'partial'`. Notes (documented behavior, not defects): explicit `task_failed` + merged PR ⇒ accepted (F1); reverted merge still counts in `accepted` while surfacing `acceptedWithRevert:1` (F2). Product lane never counts `pr_open` as success. |
| 5 | ≥1 certain-waste detector end-to-end, evidence-backed | **FAIL — “certain” falsified** | Findings D1–D4 (§5): both lanes emit `confidence=certain` on internally contradictory or unvalidated-precondition evidence. Engine mechanics (double-count protection, abstain-on-missing-timing, first-failure-not-flagged) are sound; boundary preconditions are not. |
| 6 | Synthetic demo produces complete audit without external account | **FAIL (candidate)** / PASS-in-lane | E2 vs E6. Demo numbers fully reproducible by hand; determinism tests pass; artifacts written (E7). |
| 7 | Read-only GitHub mode with token/app credential | **FAIL (absent everywhere)** | No adapter code, no credential path, no webhook verification tests. Product lane's `--input` normalized-bundle mode is **not** GitHub mode: nothing exists to produce a bundle from GitHub. |
| 8 | Report leads with economics, not tokens | **FAIL (candidate)** / PASS-in-lane | Product report verified: headline table leads with cost/outcome/waste; tokens confined to `diagnostics_secondary` with an explicit note; every savings dollar traces to finding IDs (`potential_savings_traceability_finding_ids`). |
| 9 | Global export free of source content/linkable identity | **FAIL — nothing exists** | No `GlobalLearningRecord`, no privacy gate, no exporter on any branch (`grep -rniE "globallearning\|privacy" src` → zero hits in both lanes). There is no executable privacy boundary to attack; README privacy prose is documentation, not proof. |
| 10 | Privacy/re-id/cost/outcome/isolation tests pass | **PARTIAL FAIL** | Cost tests pass (core), isolation holds by construction (Probe G1) — but privacy/re-id tests do not exist, and the tenant-ledger integrity defect D5 undermines stored-evidence guarantees. |
| 11 | README quickstart; synthetic vs real clearly distinguished | **FAIL (candidate)** / PASS-in-lane-with-overclaim | Candidate README honestly states the demo is intentionally missing. Product-lane README quickstart works as documented (E6/E7), but its "Real read-only mode" section presents the bundle contract without any adapter that fulfills it — an overclaim until WC-002 lands. |
| 12 | CI green on integration candidate | **FAIL (deterministic)** | E3: guard exits 1 on fresh checkout (0 test files). Even if it passed, E2 shows `npm run demo` exits 1. Live run status unreadable (`gh` unauthenticated); reproduction uses the workflow's own commands verbatim. |

**Score: 0 / 12 PASS on the integration candidate.** Lanes individually satisfy roughly criteria 1, 3, 4, 6, 8 in part.

---

## 4. End-to-end data flow

Required flow: *Source Data → Tenant Analytics → Global Learning Dataset*.

What exists today:

- **Tenant Analytics (core lane):** `TenantLedger.append()` → schema validation + version stamping + freeze → seq-ordered event log → `reconstructTasks()` projection → `runWasteAnalysis()` + `computeSummary()`. Instance-local, no global registry. This chain is real and tested.
- **Source Data / GitHub ingestion:** missing. Nothing feeds the ledger from GitHub.
- **Global Learning Dataset:** missing. No export surface exists at all.

So the product currently has a middle layer with no upstream adapter and no downstream privacy-safe export — one third of the mandatory architecture, correctly built.

---

## 5. Adversarial findings (highest severity first)

### D1 — CORE: deterministic-retry rule declares a *successful* invocation certain waste (severity: HIGH for the V1 promise)
- **Repro:** `/tmp/opencode/probes/probeA-det-retry-success.mjs` against core lane:
  `m1 status=error failure_class=auth_error attempt_equivalence_key=K1` → `m2 status=ok same key`.
  Output: `FINDING WASTE_DET_RETRY_V1 confidence=certain wasted_micro_usd=50000 … "this retry could not succeed"` — in a task whose outcome is `accepted`.
- **Why it matters:** observed success falsifies the determinism/equivalence premise. The engine's own header says ambiguous evidence never produces findings; this is contradictory evidence producing a `certain` finding that inflates certainly-avoidable spend using the cost of the very call that delivered the outcome.
- **Aggravating:** `packages/core/test/waste-det-retry.test.js:27-38` *asserts* this behavior (`M3 status ok` expected flagged).
- **Smallest repair (R1):** in `waste/rules/deterministic-retry.js`, skip any unit whose own `payload.status === 'ok'`, and conservatively stop flagging further units of that equivalence key once a success is observed; invert the test expectation for M3 into a negative control.

### D2 — PRODUCT: identical-retry rule flags a retry execution that succeeded (same defect class)
- **Repro:** `/tmp/opencode/probes/probeB-product-retry-success.mjs`: execution `e-02` retries deterministic-failed `e-01` with identical `work_signature`, succeeds, PR merges. Output: `confidence=certain avoided_cost_cents=115`, `successful_outcomes: 1`.
- **Smallest repair (R2):** in `apps/cli/src/waste.js::findIdenticalRetryWaste`, require the retry itself to show a failed outcome (`failure_category != null`) before flagging; add negative control.

### D3 — CORE: duplicate-CI “certainty” rests entirely on an unvalidated adapter field
- **Repro:** `/tmp/opencode/probes/probeCD-dupci-supersede.mjs`: two CI runs share `equivalence_key='build-and-test'` but carry **different `revision_key`s** (code changed between runs). Output: `confidence=certain wasted_micro_usd=40000 … "on identical inputs … its result could not differ"` — false premise.
- **Why it matters:** an adapter that keys by workflow name alone would make Beetlejuice systematically report non-waste as *certain* waste. Certainty must not depend on an unchecked string.
- **Smallest repair (R3):** when both runs define `revision_key` and differ, abstain; document/enforce `equivalence_key ≡ f(revision, config)`; add negative test with differing revisions.

### D4 — PRODUCT: superseded-execution rule lacks core's strictly-later-start validation
- **Repro:** same probe file: `late` (started 11:00) superseded-by `early` (started 08:30). Product emits `confidence=certain avoided=200`; the core throws `BAD_SUPERSESSION` for identical input.
- **Smallest repair (R4):** require `replacement.started_at > superseded.started_at` in the product rule (mirror core), plus negative test.

### D5 — CORE: `TenantLedger.events()` returns the live internal array (integrity defect)
- **Repro:** Probe G2: `ledger.events().push({…})` succeeds; size 1→2; a second probe shows one unvalidated push flips `accepted: 0 → 1` in audit output.
- **Smallest repair (R5):** return a frozen shallow copy (`Object.freeze([...this.#events])`).

### D6 — CI: test-count guard is blind to vendored dependencies outside `./node_modules`
- In this workspace the guard counts 149 vendored zod tests under `.opencode/node_modules` and would wave through a zero-test product build; on clean checkouts it correctly fails. Either way it does not measure what it claims.
- **Smallest repair (R6):** prune `-path './.opencode'` (and any dot-dir) in addition to `./node_modules`.

### Structural finding S1 — two divergent canonical models were built instead of one
Core lane: event-sourced `AGENTIC_TASK`, integer **micro-USD**, rules `WASTE_DET_RETRY_V1/WASTE_DUP_CI_V1/WASTE_EXEC_SUPERSEDED_V1`, outcomes `accepted/failed/aborted/unresolved`.
Product lane: flat `agentic_task` records, integer **cents**, rules `IDENTICAL_RETRY_AFTER_DETERMINISTIC_FAILURE/SUPERSEDED_EXECUTION/EXECUTION_AFTER_TASK_ABORT`, outcomes `pr_merged/pr_open/task_failed/task_aborted`. The CLI depends on `packages/core` nowhere.
Both are individually versioned and tested; together they violate "one canonical data model". This is now the single largest integration risk.
- **Smallest repair (R7):** make the CLI consume `packages/core` `TenantLedger.audit()` output (keep cents only at display edge) **or** write an explicitly versioned transform between the schemas and unify rule IDs; pick one outcome vocabulary.

### Missing P0 scope M1/M2 — WC-003 (privacy) and WC-002 (GitHub adapter) have no code in this cycle
No privacy gate, no `GlobalLearningRecord`, no forbidden-field/content checks, no rare-combination suppression, no consent surfaces; no read-only collector, no webhook verification tests, no credential path. Privacy negatives could not even be attempted against an exporter because none exists. Re-identification resistance therefore remains **unproven by construction and untested** — P0 items 9/10 stay false regardless of lane quality.

---

## 6. What held up under attack (credit where due)

- **Cost identity:** exact across all six component kinds, unassigned components and unknown-cost handling (Probe E). Unknown costs are never guessed.
- **Schema strictness:** malformed probe events are rejected with precise error codes (`MISSING_FIELD` on first attempt); duplicate component refs, self/unknown/duplicate refs, supersession ordering (`BAD_SUPERSESSION`), and cross-field rules all enforced.
- **Versioning:** every stored event carries all four required version stamps, attached by the core so adapters cannot forget them.
- **Tenant isolation:** instance-local ledgers, no module registry, no cross-ledger path (Probe G1); core introduces no global stable identifier.
- **Waste-engine mechanics:** global single-claim of evidence units prevents double counting in core; per-execution claim guard in product; overlapping/unterminated CI runs and pre-abort executions correctly abstain; first deterministic failure is never charged.
- **Product hygiene:** raw-provider-marker rejection (`workflow_run`, `head_sha`, `html_url`, …) keeps GitHub objects out of the product surface; savings traceability field; honest `measured/estimated/unavailable` separation; deterministic outputs; `factory.json` states are truthful (all-false) in every branch — nobody inflated progress.

---

## 7. Demo-only vs real GitHub mode

- Everything demonstrated today is **synthetic/demo or fixture-backed**. The product lane's `--input` mode accepts versioned *normalized bundles*, which is the right contract, but **no code can produce such a bundle from GitHub** — neither historical collection nor incremental/webhook ingestion exists, and webhook signature verification is absent (P1 item, unstarted).
- Any statement implying "connect your repository today" would be unsupported. Current README wording stops just short of that claim; keep it that way until WC-002 ships.

## 8. Recommended next actions (smallest repairs first)

1. **Integrate the two existing lanes into `lab/integration`** after resolving S1/R7 (one canonical schema, one money unit at rest, unified rule IDs). Until then every other repair lands twice.
2. Land R1–R4 (rule-boundary guards + inverted/negative tests) so "certain" survives adversarial input; land R5 (frozen events view).
3. Implement WC-003 minimally: `GlobalLearningRecord` allowlist schema, forbidden-field/content rejection, bucketing, rare-combination suppression, versioned transforms, plus the MASTER_PROMPT §22 privacy/re-id tests. No global claims before this exists.
4. Implement WC-002 minimally: fixture-backed read-only GitHub collector emitting the product bundle contract, with webhook verification tests; then wire the documented `--input` path end-to-end.
5. Fix the CI guard prune list (R6); keep the zero-test prohibition.
6. Only after 1–5 re-verify and consider flipping individual `p0_checks` in `state/factory.json`, each backed by an executed command recorded in this report's style.

---

*Audit method note: every FAIL above is backed by an executed command or a deterministic reproduction of the workflow's own steps; documentation was never accepted as runtime proof. Probes preserved under `/tmp/opencode/probes/`.*
