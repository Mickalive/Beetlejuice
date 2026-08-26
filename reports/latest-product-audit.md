# BEETLEJUICE — Adversarial Product Audit (latest)

- **Auditor:** product_auditor
- **Date:** 2026-08-26
- **Audited candidate:** Factory cycle `32936499446` — branch `cycle/32936499446/audit` == `origin/lab/integration` @ `bc0f974` (contains lane merges `9964d4d` core, `8a43ded` github, `1e0ba4c` privacy, `05b6ec9` product + integration repairs `3f7b5d7`, `beb0648`, `12eb539`)
- **Verdict: REJECT as P0_READY — 10/12 P0 criteria PASS, #7 FAILS on a newly discovered HIGH defect (A12), #12 passes by local execution but the remote Actions run remains unobserved.** This is the first cycle with a real, mounted, integrated product. Every repair demanded by the previous audit (X1, A7, A9, A10, A11) landed and survived re-execution. The privacy gate repelled a harder attack battery than its own committed tests. One new defect falsifies the "real read-only GitHub mode" product claim: **the committed CLI `--github` command cannot succeed against any repository even with a valid credential**, and one recorded evidence line in `state/factory.json` ("real TLS call to api.github.com") is contradicted by instrumentation.

---

## 1. Executive summary

The mounted candidate is no longer architecture theater. It mounts all four lanes plus cross-seam integration tests, runs **363/363 tests in one suite** (`# skipped 0`), produces a deterministic economics-first demo, ingested a **live public GitHub repository end-to-end** (18 strictly-GET requests → 50 canonical events → balanced ledger → labeled report), and its new tenant→privacy producer bridge held up under an adversarial battery I designed to leak identifiers through it. The prior audit's X1 certainty defect is genuinely repaired — I re-attacked it with both failure directions plus cancellation variants.

The falsification that stuck is narrow and precisely scoped (**A12**): `runGithubReadOnly()` forwards an *optional* `policy` to `collectHistory()`, but the adapter makes policy **mandatory** (`normalizePolicy(undefined)` throws) and the CLI has **no flag or env var** to supply one. Result: every `npm run demo -- --github OWNER/REPO` invocation dies pre-network with exit 3 regardless of token validity. I proved zero network activity with an instrumented `fetch` counter (0 calls, 25 ms). The committed integration test masks this because its "CLI upstream failure" case matches the same stderr regex for either cause and its failing transport is never reached. The library capability itself works — my live probe through `scripts/live-github-audit-probe.mjs` (which supplies a policy inline) completed against real `api.github.com`.

---

## 2. Environment and exact commands

```
node v22.23.2, npm 10.9.8, linux
repo: /home/runner/work/Beetlejuice/Beetlejuice @ bc0f974 (= origin/lab/integration)
probes preserved under /tmp/opencode/audit32936499446/
```

| # | Command | Result |
|---|---------|--------|
| E1 | `npm install --ignore-scripts` | exit 0, 0 vulnerabilities |
| E2 | `npm test` | exit 0 — `# tests 363 / # pass 363 / # fail 0 / # skipped 0` |
| E3 | `npm run demo` | exit 0 — `$28.57 measured · 2 accepted · $15.09 per accepted outcome · $8.99 certainly avoidable (31.47%)`, findings F-001..F-004 each with tenant-scope evidence refs and component breakdowns |
| E4 | demo ×2 → `diff` | byte-identical after npm banner (deterministic) |
| E5 | demo `--format json` → recompute | findings sum = `$8.99` = headline; trace IDs `F-001..F-004`; ratio 31.47% ✓ |
| E6 | probe `probe-waste-core.mjs` (battery 1) | X1 regressions PASS (passed→failed abstains; failed→passed flip poisons partition); positive control charges per-run; cancelled repeat abstains; unknown-cost repeat emits unquantified unit at $0; engine strip prevents double count ($2.2 known fully attributed, refs disjoint); backwards supersession rejected at reconstruction; outcome probes O1–O4 correct |
| E7 | probe `probe-privacy.mjs` (battery 2) | maximally identifier-poisoned ledger (org/repo/branch/SHA/email/URL in task refs, execution refs, revision keys, source refs+meta): mapped GLR admitted, **zero needles in record or envelope**; hostile values in allowed keys rejected (`url_detected`, `high_entropy_blob_detected`); forbidden hint keys rejected with precise codes; unique combination among 20 common records suppressed below k=5 floor while crowd admitted; missing purpose / unlicensed research blocked; identical economics across tenants → byte-identical GLRs; unknown CI status fail-closed; partial token coverage stays unknown |
| E8 | probe `probe-product-waste.mjs` (battery 3) | post-abort execution charged, pre-abort untouched; unprovable abort timing abstains; failed outcome never misattributed to abort rule; successful retry guarded (R2); backwards supersession guarded; cost-per-success identity holds over measured+estimated with unavailable counted-not-summed |
| E9 | `node apps/cli/src/demo.js --github acme/widget` (no token) | exit 2 + setup guidance, no fabricated audit ✓ |
| E10 | `BEETLEJUICE_GITHUB_TOKEN=ghp_fake… node apps/cli/src/demo.js --github octocat/Hello-World` | **exit 3 — `GITHUB AUDIT FAILED (TypeError): an explicit policy is required…` — NOT an upstream failure** |
| E11 | E10 instrumented: global `fetch` call counter | **fetch invocations = 0, elapsed 25 ms** → factory's "real TLS call" claim falsified on this tree |
| E12 | `node scripts/live-github-audit-probe.mjs` (live api.github.com, eubby06/kids-store, policy supplied inline, no credentials) | exit 0 — 18 live GETs → 6 PRs → 50 canonical events → report labeled `real-github-read-only`; costs honestly unavailable; 5 certain superseded-execution findings with unquantified units, `$0.00` never invented |
| E13 | `node --test test/integration/*.test.*` | 11/11 seam tests pass incl. adapter-bundle→CLI `--input` (A7 regression) and producer→gate→export (A10) |
| E14 | CI guard find executed in workdir and pristine `git archive HEAD` checkout | workdir 206 files (incl. vendored `.opencode` zod tests), pristine **57 first-party ≥ floor 1** → guard green both ways |
| E15 | `--input apps/cli/fixtures/synthetic-audit-v2.json` | exit 0, $28.57 flows verbatim; legacy v1 fixture correctly refused with migration pointer |
| E16 | tenant isolation negatives + frozen snapshot probe | no cross-ledger visibility; `events().push` throws |

---

## 3. P0 scorecard (docs/PRODUCT_OBJECTIVE.md items 1–12)

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | `AGENTIC_TASK` canonical model, versioned | **PASS** | Vendor-neutral event types with strict payload specs (packages/core/src/events.js); every stored event stamped `schema_version/event_version/collector_version/normalization_version` (verified in E6 fixtures); fail-closed normalization rejects unknown fields/types; adapter-extensibility suite proves a second platform maps in without schema change; live events from GitHub accepted unmodified (E12). |
| 2 | GitHub adapter ingests realistic Actions/PR evidence into the model | **PASS** | Live execution E12: 18 GET-only requests → 50 canonical events into real `TenantLedger` with zero shims; committed fixture e2e (E13); collector enforces bounded sweep + data minimization (check-runs probed only for ingested PR revisions). |
| 3 | Cost accounting identity `inference+tools+CI+compute(+validation/human) = total` | **PASS** | Identity holds by construction over canonical components; exporter refuses unbalanced ledgers (export.js UNBALANCED_LEDGER guard); product validator enforces `total_amount_micro_usd == Σ representable components` per execution (schema.js L173–181); unavailable components counted, contribute $0, never guessed (E3/E12/E15). |
| 4 | Conservative outcome attribution | **PASS** | Priority merged > task_failed > closed-unmerged > aborted > unresolved; unresolved stays `partial` with cost visible (O4); revert flags accepted-but-reverted work (O1) and privacy mapping demotes it to `revert` rather than claiming acceptance; nothing counts unresolved as success. LOW divergence noted (§5 SEAM-DIV). |
| 5 | ≥1 certain-waste detector end-to-end with evidence | **PASS** | Dup-CI X1 repaired (G5) and verified under both failure directions + cancellation (E6); det-retry R1/G2/G3 hold incl. unknown-cost honesty; superseded rule validated at reconstruction (strictly-later replacement) and produced evidence-backed findings on LIVE data (E12) with unquantified units kept out of dollar totals; engine strip guarantees no double counting (E6 S1). Residual epistemic observations logged (§5), none falsify a shipped finding. |
| 6 | Synthetic demo produces complete audit without external account | **PASS** | E3/E4/E5: complete economics-first audit, deterministic, zero credentials, sanity notes present, speculative savings explicitly unestimated. |
| 7 | Read-only GitHub mode runs when token/app credential is supplied | **FAIL — A12** | The committed product surface (`demo.js --github`) cannot complete ANY audit: mandatory classification policy is never wired and no flag/env exists to supply it; fails pre-network for every invocation (E10/E11). Library path + probe script DO work live (E12), so this is wiring, not capability. Smallest repair in §8. |
| 8 | Report leads with cost/outcome and avoidable waste, not tokens | **PASS** | Demo and live reports open with headline economics table; tokens confined to "Secondary diagnostics (not economics)"; every savings dollar traces to finding IDs (E5); data-quality section separates measured/estimated/unavailable. |
| 9 | Global-learning export contains no source content/linkable identity | **PASS under attack** | Battery E7 beyond committed tests: poisoned identifiers in every ref/meta field, hostile values in allowed keys, near-miss key names, unique-combination re-identification, purpose/license gates, float micro→USD bucketing — all repelled; closed-world 17-field enum+boolean GLR; byte-identical records across tenants. |
| 10 | Privacy/re-id/cost/outcome/isolation tests pass | **PASS** | 363/363, zero skipped (E2), including dedicated reidentification/joinkeys/content-defense/tenant-isolation/accounting suites and three cross-package seam suites executed on the integrated tree (E13). |
| 11 | README quickstart; synthetic vs real clearly distinguished | **PASS (with A12 contamination noted)** | Local quickstart verified reproducible (E1–E3); modes explicitly labeled (`synthetic demo`, `normalized-input`, `canonical-core`, `real-github-read-only`) and mutually exclusive. However the README's real-mode quickstart command is exactly the broken A12 surface — docs currently advertise an unrunnable command. |
| 12 | CI green on integration candidate | **PASS by local execution; remote run unobserved** | All four CI steps executed locally on HEAD bc0f974: install ✓ (E1), guard ✓ (E14: 57 pristine ≥ 1), npm test ✓ (E2), demo ✓ (E3). Remote Actions status is not observable from this environment (gh unauthenticated) — factory's own `integration_ci_green:false` is honest bookkeeping of exactly that gap. |

**Score: 10 PASS · 1 FAIL (#7, A12) · 1 conditional (#12).** P0_READY requires repairing A12 and observing the remote CI run.

---

## 4. End-to-end data flow (all seams executed this cycle)

| Seam | Status | Proof |
|------|--------|-------|
| GitHub source → core ledger (tenant analytics) | **WORKS — proven live** | E12: real api.github.com, GET-only, 50 events, balanced ledger, conservative attribution (5 accepted / 1 unresolved on a living repo). |
| Core audit → product surface (`--core-audit`) | **WORKS** | E12 renders via `buildReportFromCoreAudit`; committed seam tests pass (E13). |
| Adapter → normalized bundle → product `--input` (A7) | **WORKS — closed** | `buildNormalizedBundle` exists in packages/github sharing the event mappers' correlation decisions; committed round-trip test passes (E13); bundle deliberately emits NO superseded/retry relations from bare commit succession (correctly refuses to manufacture certain waste). |
| Tenant analytics → privacy gate → global export (A10) | **WORKS — closed and attacked** | `mapAuditTaskToPrivacyInput` extracts only numbers/enums/booleans; battery E7 shows nothing identifier-shaped survives; cohort floors suppress rare combinations from small tenants (committed test) and unique rows among crowds (my probe). |
| Real mode CLI wiring (A11) | **BROKEN — A12** | E10/E11. Everything behind it works (E12); the last inch — supplying the mandatory operator policy — is missing. |

---

## 5. Certain-waste falsification attempts (every rule re-attacked)

**WASTE_DUP_CI_V1 — holds after X1 repair.** G5 now abstains the whole partition when any run terminated non-passed: passed→failed charged-nothing (prior defect), failed→passed flip poisons later repeats, cancelled repeat abstains, positive control still charges each post-pass repeat individually. Missing timing (G4), differing revisions (G2/R3), overlapping runs (G3), absent equivalence key (G1) all abstain. Residual **TRUST-1 (LOW)**: when adapters omit `revision_key` entirely AND key equivalence on configuration alone, runs at different actual revisions land in the shared null partition and were charged by my probe (A-N2). This violates the documented SHOULD (`equivalence_key ≡ f(revision, config)`), so it is an adapter-contract trust residual, not a core bug — but requiring revision presence (or embedding it in the key) would close it.

**WASTE_DET_RETRY_V1 — holds; one epistemic asymmetry logged.** Success poisons the group (R1 re-verified); first deterministic failure free; blind repeats charged; unknown costs emit unquantified units at $0. **EPI-1 (LOW-MEDIUM)**: a retry failing with a *different, non-deterministic* class after a deterministic failure is still charged (core D1; product layer RT-2 behaves identically). Unlike X1 there is no self-contradiction — the charged retry did not succeed, so "could not succeed" was not falsified — but observed mode-variance weakens the same premise dup-CI's G5 treats as disproof. Either align (treat class-disagreement as poisoning) or document the asymmetry explicitly in the rule header.

**WASTE_EXEC_SUPERSEDED_V1 — holds within its stated boundary.** Strictly-later replacement enforced at reconstruction (backwards chains rejected, E6-S3); charging a superseded exec whose replacement then failed remains defensible hindsight accounting (documented stance, E6-S2); engine strip keeps multi-rule totals exact (E6-S1: $2.20 known attributed once, disjoint refs).

**EXECUTION_AFTER_TASK_ABORT (product-surface extension) — holds.** Only post-abort starts charged; pre-abort executions untouched; unprovable timing abstains; non-aborted outcomes never trigger it. **WORD-1 (LOW)**: explanation asserts "ran to completion" without checking `ended_at` — the avoidability claim stands regardless, but the wording claims more than the evidence shows when completion isn't recorded.

**Composition/sanity.** Demo savings $8.99 = exact sum of F-001..F-004 (E5); per-execution single-claim guards prevent double counting in both layers; ratio computed against measured spend with a sanity note channel for ≥100%.

**Cross-seam note (SEAM-DIV, LOW):** closed-without-merge attributes `failed` via the event path (PR-closed evidence) but `aborted` via the bundle path (explicit design note in bundle.js). Both are conservative non-success attributions; document the intentional divergence.

---

## 6. Privacy / re-identification attack battery (E7 detail) — all repelled

| Attack | Result |
|--------|--------|
| Ledger poisoned with org/repo/branch/commit-SHA/email/PR-URL across task refs, execution refs, revision keys, CI equivalence keys, `source.ref`/`source.meta` | mapped GLR admitted; serialized record and full export envelope contain **zero** needles (incl. timestamps and the word "github") |
| Forbidden hint keys (`repository`, `customer_id`, `commit_hash`) | rejected with precise reason codes (`forbidden_repo_or_project_field`, `forbidden_customer_or_tenant_field`, `forbidden_vcs_ref_field`) |
| Allowed KEY with hostile VALUE: repo URL as `agent_name`; high-entropy blob as `model_name` | content defense rejects before admission (`url_detected`, `high_entropy_blob_detected`) — raw value never echoed |
| Out-of-vocab semantic hint (`task_class: fix_juliett_payment_gateway`) | `invalid_enum_value`; named-issue semantics cannot enter |
| Unique combination among 20 common records (k floor 5, PRODUCT_TELEMETRY) | outlier suppressed, crowd admitted; risk block explains counts |
| Lowering cohort threshold below absolute minimum (k=1 attempt) | `INVALID_COHORT_THRESHOLD` thrown — floors cannot be negotiated away |
| Export without purpose / research purpose without licence acknowledgement | `PURPOSE_REQUIRED` / `LICENSE_ACKNOWLEDGEMENT_REQUIRED` (installation grants nothing — MASTER_PROMPT §13 honored) |
| Float money from integer micros (0.232 USD) | bucketed `under_1`; raw magnitude absent |
| Unknown CI terminal status | mapping throws — refuses to guess rather than mislabel |
| Partial token coverage | no `tokens_total` derived; `token_bucket` defaults to `unknown` honestly |
| Cross-tenant linkability | identical economics from differently-keyed tenants → byte-identical GLRs |

Residual (unchanged, acceptable): the GLR intentionally carries coarse buckets only; wall-clock durations are never derived tenant-side unless explicitly pre-bucketed by policy.

---

## 7. Demo-only vs real GitHub mode

- **Synthetic demo**: labeled `synthetic demo — bundled fixture, no GitHub credentials used`; deterministic; no raw-payload ingestion path exists.
- **Real mode, library + probe script**: genuinely real — E12 made 18 live TLS requests to api.github.com and produced a `real-github-read-only` report with honest unavailability. No simulation masquerades as GitHub data anywhere.
- **Real mode, committed CLI command**: currently demo-grade in the opposite direction — it can NEVER produce output at all (A12). Until repaired, README's `--github` quickstart documents a dead command, and `state/factory.json`'s line recording "real TLS call … honest upstream failure" for that exact invocation is contradicted by instrumentation (E11: 0 fetches).

---

## 8. Findings (highest severity first) and smallest repairs

### A12 — PRODUCT/INTEGRATION: committed `--github` CLI mode is unrunnable; mandatory policy never wired (HIGH, NEW — blocks P0 #7)
- Evidence: E10 (exit 3 `an explicit policy is required…`), E11 (0 fetch calls, 25 ms — pre-network), packages/github/src/policy.js L31–36 (policy mandatory), apps/cli/src/github_mode.js L88–94 (forwards only `...(policy ? {policy} : {})`), apps/cli/src/demo.js L129–133 (never supplies one; grep: no policy flag/env anywhere in apps/cli or packages/github src).
- Impact: P0 criterion #7 fails at the product surface despite working library capability; README quickstart advertises a command that always fails; factory evidence line for this command is inaccurate.
- Smallest repair: give `runGithubReadOnly` an operator-policy default resolved inside the CLI — e.g. read `BEETLEJUICE_BOT_ACTORS` / `BEETLEJUICE_BRANCH_PREFIXES` env vars (comma-separated), falling back to a documented conservative default built from the adapter's exported `SUGGESTED_AGENTIC_ACTORS` plus common agent prefixes; keep the existing optional override. Then (a) extend `test/integration/github-real-mode.test.js` with a success-path test driven THROUGH `runCli(["--github", ...])` using the injected transport, (b) re-run the live probe via the CLI command, (c) update factory evidence.

### A12-MASK — INTEGRATION: real-mode test masks A12 by asserting an ambiguous regex (MEDIUM, NEW)
- Evidence: test/integration/github-real-mode.test.js L172–186 — expects `/GITHUB AUDIT FAILED|UPSTREAM_ERROR|NETWORK_ERROR_REDACTED|error:/`; the missing-policy TypeError satisfies it, and the failing transport is explicitly unused (`void failing`). The suite reports green for a path it never exercises.
- Smallest repair: assert the specific upstream code (`UPSTREAM_ERROR`/`NETWORK_ERROR_REDACTED`) and require `collection.requests.length > 0` in that test; add the CLI success-path test above so the regex can never mask wiring again.

### EPI-1 — CORE+PRODUCT: retry rules charge retries whose failure MODE contradicts the determinism premise (LOW-MEDIUM, NEW observation)
- Evidence: E6-D1 (charged $2 after invalid_request→provider_timeout on identical attempt key); E8 RT-2 (product layer identical).
- Impact: defensible today (the charged retry did not succeed; classification trust documented), but inconsistent with dup-CI G5's "observed disagreement poisons certainty" epistemics; invites the next X1-style challenge.
- Smallest repair: either treat any post-deterministic failure whose class differs from the established deterministic class as disproof (abstain group), or document the asymmetry explicitly in both rule headers with rationale.

### TRUST-1 — CORE: null-revision partition mixes runs across actual revisions for config-only equivalence keys (LOW, documented residual)
- Evidence: E6 A-N2 (charged across different revisions when `revision_key` absent everywhere).
- Smallest repair (optional hardening): abstain unless `revision_key` present OR the docstring contract (`equivalence_key ≡ f(revision, config)`) is enforced somewhere observable; otherwise keep as documented adapter trust.

### WORD-1 — PRODUCT: abort-rule explanation asserts "ran to completion" without checking `ended_at` (LOW)
- Evidence: E8 AB-1 (execution with `ended_at: null` still described as completed).
- Smallest repair: condition the phrase on `ended_at != null`, else "started afterwards".

### SEAM-DIV — GITHUB: closed-unmerged PRs map `failed` (event path) vs `aborted` (bundle path) (LOW)
- Evidence: task.js resolveOutcome vs bundle.js L222 comment. Both conservative; divergent vocabulary for the same repository depending on seam.
- Smallest repair: one paragraph in NORMALIZED_INPUT.md stating the intentional difference and why.

### DOC-NIT — docs: NORMALIZED_INPUT.md L41 imports `buildNormalizedBundle` from `apps/cli/src/index.js`; actual producer is `@beetlejuice/github` (LOW)
- Smallest repair: fix the snippet (L62 already states it correctly).

### CI-RESIDUAL — ci.yml still lacks `.opencode` prune (LOW, carried; proposal pending credential)
- Evidence: E14 — workdir count 206 includes 149 vendored zod tests; pristine checkout unaffected (57 first-party ≥ floor 1, guard green). `reports/ci-guard-proposal.md` preserves the intended edit.
- Smallest repair: land the proposal when a workflows-permitted credential exists (as factory already plans).

---

## 9. What held up under attack (credit where due)

- **Every prior-audit repair landed and stuck**: X1/G5 (verified in both failure directions), A7 (`buildNormalizedBundle` + committed round-trip), A9/A11 (committed cross-package seam tests now run in CI), A10 (producer mapping + round-trip privacy test over real ledger shapes).
- **The live pipeline is real**: unauthenticated, GET-only, bounded sweep of a living public repository reconstructed balanced economics and certain-waste findings whose unknown costs stayed honestly unquantified.
- **Honesty mechanisms everywhere**: unknown ≠ zero; estimated ≠ measured; unresolved never success; speculative savings never estimated; unbalanced never exported; unique never exported; secrets never echoed.
- **Factory bookkeeping mostly accurate**: 363-test, demo, and live-probe claims reproduced exactly; the lone inaccuracy is the fake-token TLS claim (E11) — everything else I re-executed matched.

## 10. Recommended next actions (in order, smallest first)

1. **Repair A12 + A12-MASK** (env/default policy plumbing, CLI-driven success test, corrected assertions) — restores P0 #7 with roughly a day of scoped work.
2. Re-run `scripts/live-github-audit-probe.mjs` **through the CLI command** and update `state/factory.json` evidence lines accordingly (delete the falsified TLS-call line).
3. Confirm the remote Actions run on `lab/integration` (needs only authenticated visibility) and flip `integration_ci_green`.
4. Address EPI-1 and WORD-1 (both are hours: one guard clause or two docstring paragraphs each).
5. Land the CI-guard prune from `reports/ci-guard-proposal.md` when credentials allow.
6. Optional hardening: TRUST-1 revision-presence guard; SEAM-DIV documentation; DOC-NIT import fix.

Only then flip `p0_checks.real_read_only_github_mode` and declare P0_READY — each flip backed by an executed command recorded here.

---

*Audit method note: every verdict above is backed by an executed command or probe preserved under `/tmp/opencode/audit32936499446/`. Documentation, docstrings and committed tests were never accepted as runtime proof — the one place they diverged (A12/A12-MASK) is exactly where the audit caught it.*
