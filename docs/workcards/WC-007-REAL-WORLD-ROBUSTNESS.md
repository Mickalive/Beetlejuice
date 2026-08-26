# WC-007 — P0.5 REAL-WORLD ROBUSTNESS GATE

## Purpose
Prove that the P0 engine survives messy real GitHub histories before P1 productization. Passing unit/integration tests is necessary but not sufficient.

P1 MUST NOT be treated as the next product milestone until this gate is closed from executed evidence.

## Real-repository corpus
Build and preserve a reproducible corpus of at least 5 and preferably 10 public repositories with genuine agentic/bot-authored software work and materially different workflow shapes. The corpus must include, across the set:

- multi-page PR and Actions history;
- cancelled and rerun workflows;
- failed, merged, closed-unmerged and reverted outcomes where available;
- repositories with Actions missing for some PRs and Actions runs not cleanly attributable to PRs;
- deleted/renamed branches or other stale references where available;
- more than one bot/agent identity or classification pattern;
- at least one large-history stress case.

Do not cherry-pick only clean examples. Record why each repo was selected and the observed pathologies.

## Required executed gates
1. ZERO-CRASH: every corpus repo either produces a valid audit or a typed, actionable refusal. No uncaught exception, hang or silent partial success.
2. PAGINATION/STRESS: prove traversal beyond one API page and bounded behavior on a large history.
3. RATE-LIMIT/NETWORK: explicit adversarial tests for GitHub 403/429, Retry-After/rate-limit reset behavior, timeouts and transient 5xx. Retry conservatively; never spin indefinitely.
4. CLASSIFICATION: manually review a sampled set of agentic/non-agentic PRs from the corpus. Report false positives, false negatives and ambiguous records. Do not hide uncertainty behind defaults.
5. OUTCOME ATTRIBUTION: manually review sampled accepted/failed/aborted/reverted outcomes. Any ambiguous case must abstain rather than fabricate certainty.
6. CERTAIN-WASTE PRECISION: manually inspect every `certain` waste finding produced on the corpus, or a statistically meaningful sample if volume becomes high. A known false-positive `certain` finding is a gate failure until repaired or downgraded.
7. DETERMINISM: same frozen input/evidence yields byte-equivalent economic results.
8. DATA-MISSING HONESTY: missing CI/model/tool/billing evidence must remain unavailable, never silently converted to zero.
9. REAL-GITHUB POSITIVE PATH: at least one end-to-end audit must use actual GitHub HTTPS responses rather than an injected test transport.
10. PRIVACY: no public-repo test may weaken tenant/global-learning boundaries or cause raw repo content to enter global-learning export.

## Billing viability gate
The product must be useful across three evidence states and must label them explicitly:

### A. GitHub-only / no model billing
- Beetlejuice may report observable operational facts: outcomes, retries, cancelled/superseded runs, CI duration/usage evidence GitHub actually exposes, certain waste events, and data-quality gaps.
- It MUST NOT claim total economic cost, dollar savings, or cost per successful outcome when the required monetary evidence is absent.
- The report must say exactly which cost components are unavailable.
- The product must still generate at least one useful non-dollar diagnostic when the history contains objectively detectable waste; otherwise say that no defensible waste was observed.

### B. Partial billing
- Accept operator-supplied/provider-adapter monetary evidence for only the components actually evidenced.
- Compute represented spend exactly and show coverage/completeness; never extrapolate missing components into a fake total.
- `cost per successful outcome` may only be labeled as total if all required cost components are evidenced. Otherwise label it represented/partial cost per successful outcome.

### C. Complete billing
- When all required components are supplied, prove the accounting identity end-to-end and expose a true measured total-cost surface.

The gate fails if commercial usefulness depends on pretending state A or B is state C.

## Ground-truth report
Persist `reports/real-world-robustness.md` containing:

- corpus and selection rationale;
- exact commands / commit / timestamps;
- per-repo audit result;
- classification/outcome manual sample table;
- every certain-waste finding reviewed and dispositioned;
- billing evidence state per repo;
- rate-limit/network stress evidence;
- defects found and repairs;
- explicit verdict `P0_5_READY: true|false`.

Do not mark P0.5 ready from fixtures alone.

## Exit criterion
P0.5 is complete only when the integrated candidate is CI-green and the real-world report demonstrates all gates above. Only then resume P1 installable GitHub App work.
