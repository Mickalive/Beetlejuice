# WC-007 — P0.5 REAL-WORLD ROBUSTNESS GATE

## Purpose
Prove that the P0 engine survives messy real GitHub histories before P1 productization. Passing unit/integration tests is necessary but not sufficient.

P1 MUST NOT be treated as the next product milestone until this gate is closed from executed evidence.

## Corpus strategy — identifiability before breadth
Do NOT begin with arbitrary public agentic repositories. The first learning/validation corpus must be deliberately biased toward high-identifiability cases so that hypotheses are clean and falsifiable.

A repository/task slice is admissible in the primary corpus only when most of the following are observable with high confidence rather than guessed:

- the work is genuinely agentic and attributable to a known bot/agent/tool family;
- the task or intended change is recoverable from stable GitHub evidence without needing private prompt text;
- the model/provider is explicit from public workflow/configuration/tool metadata, or is strongly constrained by the agent/tool version and documented configuration; any inference must carry a confidence/provenance label and must never be silently promoted to fact;
- the relevant agent run, PR/branch/commit and CI executions can be correlated within a defensible execution window;
- the outcome is observable enough to classify accepted/merged, failed, aborted, superseded or reverted, with abstention for ambiguity;
- important execution conditions that may confound comparison (agent/tool version, workflow configuration, model family when known, retries, CI shape) are observable or explicitly marked unknown;
- the case supplies a useful training/analysis row without exporting source content or stable tenant/repository/developer identity into the global-learning layer.

Prefer a smaller high-confidence corpus over a larger contaminated one. Ambiguous real repositories are valuable later as a robustness/abstention stress set, not as ground-truth training labels.

## Primary identifiable corpus
Build and preserve a reproducible primary corpus of at least 5 and preferably 10 repositories/task slices with genuine agentic software work and materially different workflow shapes, selected under the identifiability rules above. Across the set, seek:

- more than one agent/tool family and, where observable, more than one model family/configuration;
- different task classes and outcome types;
- multi-page PR and Actions history;
- cancelled and rerun workflows;
- failed, merged, closed-unmerged and reverted outcomes where available;
- at least one large-history case.

For every corpus row persist provenance/confidence for: agent identity, task class, model/provider/configuration, execution correlation, outcome, billing evidence state and waste labels. Unknown must remain unknown.

## Secondary messy robustness set
Separately keep messy cases with missing Actions, ambiguous PR/run linkage, deleted/renamed branches, mixed bots or incomplete metadata. These cases test safe abstention, zero-crash behavior and error handling. They MUST NOT be used as clean ground-truth training examples merely to increase corpus size.

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

## Economic-or-learning viability gate
P0.5 is NOT enough merely because Beetlejuice can parse real repositories. At least one of the following two paths must be demonstrated from executed evidence.

### PATH 1 — COMPLETE ECONOMIC LABELS
For a useful subset, all required cost components can be attributed sufficiently to the agentic unit of work to support true measured total cost and total cost per successful outcome. Accounting identity must hold end-to-end. If this path works broadly enough, the corpus directly contains economic labels.

### PATH 2 — LEARNABLE HIGH-CONFIDENCE CORPUS WITHOUT COMPLETE BILLING
If complete per-task billing is unavailable on much of the corpus, the non-monetary corpus must still contain stable, comparable variables sufficient to learn useful relations about agentic workflow performance under explicit hypotheses.

At minimum, each admitted training row must have high-confidence labels/provenance for the variables needed by the hypothesis being tested, for example:

- task class / difficulty proxy that is observable and reproducible;
- agent/tool family and version;
- model/provider/configuration when explicit or strongly constrained, with confidence label;
- execution/retry/CI structure;
- outcome and time-to-outcome;
- certain-waste events and observable resource usage;
- data-completeness indicators.

The model must never train as if an inferred model/configuration were a measured fact. Hypotheses must be scoped to what the observables support.

Critically, PATH 2 must define how economics can later be calibrated: either a billing-labeled subset, prospective instrumentation, provider usage/cost adapters, or another defensible source of economic labels. A corpus that can learn only "workflow shape predicts workflow shape" but can never be connected to economic value FAILS this gate.

## Billing evidence states
The product must label evidence explicitly:

### A. GitHub-only / no model billing
- Report observable operational facts: outcomes, retries, cancelled/superseded runs, CI duration/usage evidence GitHub actually exposes, certain waste events, and data-quality gaps.
- Do NOT claim total economic cost, dollar savings, or total cost per successful outcome.
- Preserve the row for learning only when its hypothesis-critical labels satisfy the high-identifiability rules above.

### B. Partial billing
- Accept operator/provider monetary evidence only for actually evidenced components.
- Compute represented spend exactly and expose completeness/coverage.
- Never extrapolate missing components into a fake total.
- Such rows may be useful for partial economic calibration if their attribution is defensible.

### C. Complete billing
- When all required components are supplied and attributable, prove the accounting identity and expose true measured total cost and total cost per successful outcome.

The gate fails if commercial or learning usefulness depends on pretending A or B is C.

## Ground-truth report
Persist `reports/real-world-robustness.md` containing:

- primary identifiable corpus and explicit selection rationale;
- secondary messy robustness set;
- per-row provenance/confidence for agent, task, model/configuration, execution correlation, outcome and billing state;
- exact commands / commit / timestamps;
- per-repo audit result;
- classification/outcome manual sample table;
- every certain-waste finding reviewed and dispositioned;
- billing evidence state per repo;
- rate-limit/network stress evidence;
- defects found and repairs;
- explicit viability verdict: `ECONOMIC_LABEL_PATH`, `LEARNABLE_CORPUS_PATH`, or `FAIL`;
- explicit verdict `P0_5_READY: true|false`.

Do not mark P0.5 ready from fixtures alone or from a noisy corpus whose key labels are guesses.

## Exit criterion
P0.5 is complete only when the integrated candidate is CI-green, the real-world report demonstrates the robustness gates, and either PATH 1 or PATH 2 above is proven. Only then resume P1 installable GitHub App work.
