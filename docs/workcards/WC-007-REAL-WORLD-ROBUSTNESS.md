# WC-007 — P0.5 REAL-WORLD ARCHITECTURE-LEARNING GATE

## Purpose
Prove that Beetlejuice can reconstruct and learn from real agentic automation architectures before P1 productization. Passing unit/integration tests is necessary but not sufficient.

P1 MUST NOT be treated as the next product milestone until this gate is closed from executed evidence.

The primary learned object is **automation architecture**, not raw cost. Billing is a later/local calibration label layered onto the architecture model.

## Corpus strategy — identifiability before breadth
Do NOT begin with arbitrary public agentic repositories. The first learning/validation corpus must be deliberately biased toward high-identifiability cases so that hypotheses are clean and falsifiable.

A repository/task slice is admissible in the primary corpus only when most of the following are observable with high confidence rather than guessed:

- the work is genuinely agentic and attributable to a known bot/agent/tool family;
- the task or intended change is recoverable from stable GitHub evidence without needing private prompt text;
- the model/provider/configuration is explicit from public workflow/configuration/tool metadata, or is strongly constrained by the agent/tool version and documented configuration; any inference carries confidence/provenance and is never silently promoted to fact;
- the relevant agent run, PR/branch/commit and CI executions can be correlated within a defensible execution window;
- the outcome is observable enough to classify accepted/merged, failed, aborted, superseded or reverted, with abstention for ambiguity;
- important execution conditions that may confound comparison are observable or explicitly marked unknown;
- the case supplies a useful architecture-learning row without exporting source content or stable tenant/repository/developer identity into the global-learning layer.

Prefer a smaller high-confidence corpus over a larger contaminated one. Ambiguous real repositories are valuable later as a robustness/abstention stress set, not as ground-truth training labels.

## Canonical architecture representation
Every admitted learning row should represent the architecture at the level supported by evidence, including provenance/confidence and missingness.

Where observable, capture:

- task class and reproducible difficulty/complexity proxies;
- agent/tool family + version;
- model/provider/configuration;
- execution graph topology and ordering;
- serial vs parallel execution and fan-out;
- agent/model/tool handoffs;
- retry policy and retry depth;
- escalation / fallback policy;
- validation/reviewer graph;
- CI/test graph and repeated full/partial validation;
- cache/reuse strategy and repeated unchanged work;
- loop depth / cyclic execution;
- termination / early-stop policy;
- supersession / cancellation handling;
- tool-call / CI / compute / duration footprint where observable;
- human intervention/rework;
- final outcome and latency.

Do not reduce architecture to a flat count vector when topology/order/policy are observable and materially relevant.

## Primary identifiable corpus
Build and preserve a reproducible primary corpus of at least 5 and preferably 10 repositories/task slices with genuine agentic software work and materially different workflow shapes, selected under the identifiability rules above.

Across the set, seek:

- more than one agent/tool family and, where observable, more than one model family/configuration;
- different task classes and outcome types;
- materially different orchestration architectures;
- multi-page PR and Actions history;
- cancelled and rerun workflows;
- failed, merged, closed-unmerged and reverted outcomes where available;
- at least one large-history case.

For every corpus row persist provenance/confidence for: agent identity, task class, model/provider/configuration, architecture features, execution correlation, outcome, billing evidence state and waste labels. Unknown remains unknown.

## Secondary messy robustness set
Separately keep messy cases with missing Actions, ambiguous PR/run linkage, deleted/renamed branches, mixed bots or incomplete metadata. These cases test safe abstention, zero-crash behavior and error handling. They MUST NOT be used as clean ground-truth training examples merely to increase corpus size.

## Required executed gates
1. ZERO-CRASH: every corpus repo either produces a valid audit or a typed, actionable refusal. No uncaught exception, hang or silent partial success.
2. PAGINATION/STRESS: prove traversal beyond one API page and bounded behavior on a large history.
3. RATE-LIMIT/NETWORK: explicit adversarial tests for GitHub 403/429, Retry-After/rate-limit reset behavior, timeouts and transient 5xx. Retry conservatively; never spin indefinitely.
4. CLASSIFICATION: manually review a sampled set of agentic/non-agentic PRs from the corpus. Report false positives, false negatives and ambiguous records.
5. ARCHITECTURE RECONSTRUCTION: manually review sampled task slices and verify that topology/order/retry/validation/termination features match observable evidence. A materially wrong architecture row is a gate failure or must be downgraded/abstained.
6. OUTCOME ATTRIBUTION: manually review sampled accepted/failed/aborted/reverted outcomes. Any ambiguous case must abstain rather than fabricate certainty.
7. CERTAIN-WASTE PRECISION: manually inspect every `certain` structural-waste finding produced on the primary corpus, or a statistically meaningful sample if volume becomes high. A known false-positive `certain` finding is a gate failure until repaired or downgraded.
8. DETERMINISM: same frozen input/evidence yields byte-equivalent architecture/economic results.
9. DATA-MISSING HONESTY: missing model/tool/billing evidence remains unavailable, never silently converted to zero or fact.
10. REAL-GITHUB POSITIVE PATH: at least one end-to-end audit must use actual GitHub HTTPS responses rather than an injected test transport.
11. PRIVACY: no public-repo test may weaken tenant/global-learning boundaries or cause raw repo content to enter global-learning export.

## Architecture-learning viability gate
The corpus is useful only if it supports explicit falsifiable hypotheses such as:

`TASK CONTEXT + AGENT/MODEL CONFIG + ARCHITECTURE -> OUTCOME / LATENCY / STRUCTURAL WASTE / RESOURCE FOOTPRINT`

Examples of hypotheses that are admissible when their variables are observable:

- repeated deterministic retries after the same failure signature reduce useful-work efficiency;
- full validation after every agent handoff is dominated by staged validation for a defined task class;
- excessive fan-out creates redundant work without improving accepted-outcome rate;
- missing early-stop after supersession produces structurally avoidable execution;
- a particular escalation policy improves outcome probability for one task class but not another;
- cache/reuse architecture reduces repeated unchanged work;
- certain validation/reviewer topologies correlate with lower rework or revert rates.

Do not infer causality merely from cross-sectional correlation. Preserve intervention/before-after fields so later local autotuning can generate stronger labels.

## Economic calibration gate
P0.5 is NOT enough merely because Beetlejuice can parse real repositories. It must prove that the architectural corpus can later absorb real billing labels without redesign.

At least one of the following two paths must be demonstrated:

### PATH 1 — COMPLETE ECONOMIC LABELS
For a useful subset, all required cost components can be attributed sufficiently to the agentic unit of work to support true measured total cost and total cost per successful outcome. Accounting identity must hold end-to-end.

### PATH 2 — LEARNABLE ARCHITECTURE NOW, CALIBRATABLE ECONOMICS LATER
If complete per-task billing is unavailable on much of the corpus, the non-monetary architecture rows must still contain stable, comparable variables sufficient to learn useful relations about agentic workflow performance under explicit hypotheses.

The canonical architecture schema must support attaching later economic labels such as:

- actual total cost;
- cost by model/tool/CI/compute component;
- actual cost per accepted outcome;
- measured avoidable spend;
- before/after economic delta from an architecture intervention.

A billing connector must not require redefining what an `AGENTIC_TASK` or architecture row fundamentally is.

## Customer billing behavior
### A. GitHub-only / no model billing
- Show architecture, outcomes, retries, cancelled/superseded runs, CI/resource evidence and structural waste.
- Do NOT claim total economic cost, dollar savings or total cost per successful outcome.
- State exactly which monetary components are unavailable.

### B. Partial billing
- Accept operator/provider monetary evidence only for components actually evidenced.
- Compute represented spend exactly and show coverage/completeness.
- Do not extrapolate missing components into a fake total.

### C. Complete billing
- When all required components are supplied, prove the accounting identity end-to-end and expose a true measured total-cost surface linked to the reconstructed architecture.

## Global learning rule
Tenant-local analytics may use exact repository/run/model/pricing correlations required to serve that customer.

Global learning receives only rights-cleared, privacy-gated, unlinkable abstract records. These may include generalized architecture features, task class, agent/model class, outcomes, resource footprints, intervention type and generalized economic labels.

The global asset is therefore an **architectural performance corpus progressively calibrated by real economics**, not a global ledger of identifiable customer bills.

## Ground-truth report
Persist `reports/real-world-robustness.md` containing:

- primary corpus and selection rationale;
- secondary messy robustness set;
- exact commands / commit / timestamps;
- per-repo audit result;
- architecture reconstruction sample table;
- classification/outcome manual sample table;
- every certain structural-waste finding reviewed and dispositioned;
- billing evidence state per repo;
- architecture-learning hypotheses actually testable from the corpus;
- evidence that later billing labels fit the canonical architecture schema;
- rate-limit/network stress evidence;
- defects found and repairs;
- explicit verdict `P0_5_READY: true|false`.

Do not mark P0.5 ready from fixtures alone.

## Exit criterion
P0.5 is complete only when the integrated candidate is CI-green and the real-world report demonstrates:

1. robust real GitHub ingestion;
2. high-confidence architecture reconstruction on the primary corpus;
3. precise structural-waste/outcome evidence;
4. a genuinely learnable architecture corpus;
5. a demonstrated path to attach true local billing labels without schema redesign;
6. preserved privacy boundaries.

Only then resume P1 installable GitHub App work.
