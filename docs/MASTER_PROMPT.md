# PROMPT MAÎTRE — BEETLEJUICE / AGENTIC FACTORY OPTIMIZER
## Architecture-First Optimization — Privacy-First Economic Learning Network

This file is the binding product specification for every autonomous agent working in this repository. `AGENTS.md` is the compact operational summary; this file is the fuller source of truth.

## 1. Mission
Build a commercial product, installable first on GitHub, that reconstructs the architecture of coding-agent automations, identifies structural inefficiency, and then calibrates that architecture with the customer's real local economics when billing evidence is connected.

This is NOT a token dashboard and NOT merely a FinOps dashboard.

The primary explanatory object is the automation architecture.

Architecture-learning relation:

`TASK CONTEXT + AGENT/MODEL CONFIGURATION + AUTOMATION ARCHITECTURE -> OUTCOME / LATENCY / STRUCTURAL WASTE / RESOURCE FOOTPRINT`

When complete local billing exists, add:

`ARCHITECTURE + TRUE BILLING -> TOTAL ECONOMIC COST / SUCCESSFUL OUTCOME`

The bill is a calibration/economic label. It is not the only way to know that an architecture is inefficient.

Measure the whole chain where observable: task → agent/model configuration → execution topology → context/tools → CI/tests → retries/escalations → validators/reviewers → handoffs → termination/supersession → PR/outcome.

## 2. Business sequence
V1 = architecture instrumentation + certain structural-waste detection + local economic calibration where billing exists.

V2 = local autotuning of architecture/configuration inside each customer/repository.

V3 = cross-customer architecture learning only from data that is genuinely non-linkable, progressively enriched by privacy-safe real economic labels.

V4 = benchmark + architecture optimization engine for agentic systems.

V1 must create the abstract architectural data needed later without requiring a fundamental schema rewrite.

## 3. Core architecture-first principle
Beetlejuice must preserve enough topology, order and policy to distinguish materially different automations.

Where observable, characterize:

- task class and reproducible difficulty/complexity proxies;
- agent/tool family and version;
- model/provider/configuration with provenance/confidence;
- execution graph/topology;
- serial vs parallel execution and fan-out;
- agent/model/tool handoffs;
- retry policy and retry depth;
- fallback/escalation policy;
- validation/reviewer topology;
- CI/test topology and repeated validation;
- cache/reuse behavior;
- loop depth and repeated unchanged work;
- early-stop/termination policy;
- supersession/cancellation handling;
- tool-call/resource/duration footprint;
- human intervention/rework;
- final outcome and latency.

Do not collapse observable architecture into flat totals if graph/order/policy information matters.

Unknown remains unknown. Inferred fields carry provenance/confidence and are never silently promoted to measured fact.

## 4. Absolute confidentiality principle
The future global-learning dataset must not allow an event to be attached to a company, GitHub account, GitHub org, repository, developer, branch, commit, identifiable PR, identifiable issue, user, IP, domain or project.

Replacing `acme-corp` with `customer_8742` is not enough. A stable pseudonym remains linkable.

Global data is **UNLINKABLE BY DEFAULT**:

- no stable global customer id;
- no stable global repository id;
- no stable global developer id;
- no deterministic hash of repo/domain/commit/user;
- no identifier allowing global records to be grouped by customer.

Longitudinal customer analytics remain tenant-local.

## 5. Three mandatory data layers
### A. Source Data
Operational data held at GitHub/customer scope: code, issues, PRs, commits, logs, workflows, prompts/traces when necessary and outcomes. It may be temporarily necessary for the product, but it is never the global dataset.

### B. Tenant Analytics
An isolated customer space that may retain relationships needed for repository history, architecture reconstruction, exact model/tool/CI billing correlation, cost trends, before/after comparisons, local experiments and autotuning.

This is where a developer who connects GitHub plus billing sources gets **real costs calculated for their actual model/configuration/pricing**.

### C. Global Learning Dataset
Only generalized, privacy-gated representations such as task class, language/repo/complexity buckets, agent family, model class, orchestration topology/policy, retry/escalation/validation patterns, resource/duration buckets, abstract outcomes, intervention types and generalized economic labels where rights/evidence allow.

No source content or stable customer/repository/developer identity is required.

The global asset is an **architectural performance corpus progressively calibrated by real economics**, not an identifiable billing ledger.

## 6. Never export globally by default
Do not retain globally: source code, raw diff, raw prompts, issue text, PR descriptions, comments, textual logs, stack traces containing paths/secrets, filenames, repo/org names, emails, usernames, IPs, private URLs, secrets, API keys, commit hashes, branch names, unnecessary exact timestamps, internal product/client names or personal data.

Semantic and architectural classification should happen before export whenever possible.

## 7. Privacy Gate / re-identification defense
Removing names is insufficient. Rare combinations can identify a source. Before admitting a global record:

1. remove identifiers;
2. generalize values;
3. bucket magnitudes;
4. detect extraordinarily rare combinations;
5. suppress/generalize overly unique features;
6. remove unnecessary technical fingerprints.

Prefer coarse categories over exact rare versions, exact LOC/hardware counts, custom internal agent names or exact timestamps. Support cohort thresholds, aggregation, rare-category suppression, privacy-risk scoring and differential privacy where appropriate for published aggregates.

A simple hash is never treated as anonymization.

## 8. Canonical Agentic Task + Architecture Model
Do not build the domain around `github_action_run`.

Build around vendor-neutral `AGENTIC_TASK`:

TASK
- execution(s)
- agent(s)
- model invocation(s)
- tool invocation(s)
- compute
- CI
- validation(s)
- retry(s)
- human intervention
- outcome

The canonical representation must preserve enough relations/topology to derive an abstract automation architecture.

GitHub is adapter #1. Future adapters may include GitLab, Bitbucket, Claude Code, Codex, Cursor, OpenCode, Devin, Jenkins, Buildkite, CircleCI, Browserbase, cloud compute and custom agents without changing the core concept.

## 9. Outcome measurement
Token optimization without final outcomes is insufficient. Distinguish at least:

`task_started`, `task_aborted`, `task_failed`, `PR_created`, `PR_closed`, `PR_merged`, `CI_passed`, `CI_failed`, `human_rework`, `retry`, `revert`.

When possible also derive time-to-merge, human changes after agent, review-cycle count, failure category and revert within N days.

Architecture evaluation asks whether a structural pattern improves accepted useful work, latency, reliability or resource efficiency for a defined task context.

Economic evaluation, when billing is complete, compares true cost per successful outcome.

## 10. Structural inefficiency before dollars
Beetlejuice may identify an inefficiency without complete billing when it is structurally defensible from observed evidence.

Candidate findings include:

- abandoned/superseded runs;
- identical retries after deterministic failure;
- duplicated full CI/test suites;
- repeated unchanged validation/tool work;
- agents continuing after their objective disappeared;
- objectively unnecessary fan-out/duplication;
- missing early termination after supersession;
- obvious missing cache/reuse;
- excessive handoff/revalidation patterns when objectively demonstrable;
- premium model use on objectively deterministic operations when model evidence exists.

Dollar savings may be claimed only where monetary evidence supports them.

## 11. V1 product flow
The first audit is READ-ONLY.

Install/connect → reconstruct task + architecture → classify outcomes → identify certain structural waste → show resource/evidence completeness → overlay actual local billing when available → recommend architecture changes.

Without complete billing, the first useful result can still show architecture, outcomes, retries, duplication, waste and missing-cost coverage.

With complete billing, add actual total measured cost, true cost per accepted outcome and evidenced avoidable spend.

Target time-to-value: under five minutes when sufficient history exists.

## 12. Billing evidence states
### A. No model/tool billing
Show architecture/outcome/waste evidence. Do not claim total dollars, dollar savings or total cost per outcome. Unknown is not zero.

### B. Partial billing
Compute only evidenced monetary components. Label represented/partial cost and coverage explicitly. Never extrapolate missing components into a fake total.

### C. Complete billing
Only when required components are evidenced may Beetlejuice call the result total measured economic cost and total cost per successful outcome.

## 13. Local exact economics
Tenant-local data may retain the exact correlations needed to serve the customer: repository/run/task, model/provider, pricing, tool charges, CI/compute and outcome.

The product should make it possible for a developer who connects the relevant sources to see what **their architecture actually costs with their actual models and pricing**.

The global layer does not need those identifying joins.

## 14. P0.5 real-world learning gate
Before P1 is treated as the next milestone, execute `docs/workcards/WC-007-REAL-WORLD-ROBUSTNESS.md`.

Use a deliberately high-identifiability primary corpus, not arbitrary public repos. Prefer 5 clean, falsifiable cases to 100 contaminated ones.

For each primary row, preserve provenance/confidence for task class, agent/tool identity, model/configuration, architecture features, execution correlation, outcome, waste labels and billing-evidence state.

Maintain a separate messy robustness set for abstention/error handling. Ambiguous rows do not become ground-truth training labels merely to increase corpus size.

P0.5 must prove that the corpus supports clean architecture hypotheses now and can accept later true economic labels without canonical-schema redesign.

## 15. V2 = local autotuning
Experiments occur inside one customer's system. Persist experiment, architectural baseline, candidate architecture/configuration, confidence, outcome delta, latency/resource delta and economic delta when billing exists.

Before/after interventions are especially valuable because they provide stronger evidence than passive cross-sectional correlation.

Only abstract intervention type/context and privacy-safe aggregate effects may become global records.

## 16. V3 = cross-customer architecture learning
With enough valid, consented and unlinkable data, estimate things such as success probability, structural waste probability, expected latency/resource footprint and, where calibrated, expected cost for abstract task/architecture/configuration classes.

The global optimizer should learn which architectures work under which conditions, not merely which customers spent less.

Do not fabricate causal or benchmark confidence from insufficient cohorts.

## 17. Contribution incentive
Never just ask for telemetry. A contributor should receive concrete value such as architecture benchmarks, percentile ranking, cross-model/configuration comparison, recommended architecture ranges or early access to a global optimizer.

## 18. Data rights
Installation does not automatically grant rights to train commercial models, sell datasets, provide data to third parties or provide data to frontier labs.

Separate technically and contractually where needed:

- PRODUCT TELEMETRY;
- GLOBAL BENCHMARK CONTRIBUTION;
- EXTERNAL RESEARCH / DATA LICENSING.

Any future collaboration with frontier labs may use only data/statistics for which the company has the necessary rights.

## 19. Future frontier-lab data product
A lawful aggregate dataset may eventually answer questions such as:

- which multi-agent architectures actually work by task class;
- retry/escalation/validation policies associated with success or waste;
- effect of fan-out, context, cache/reuse, handoffs and reviewer topology;
- real failure/revert/rework rates;
- real resource and economic efficiency by architecture;
- cheap→frontier escalation performance;
- marginal compute efficiency;
- cost/quality/duration tradeoffs.

Never weaken confidentiality to make the dataset richer.

## 20. SPIDER / research export boundary
Provide a distinct, explicitly versioned future `AGENTIC_DYNAMICS_EXPORT` mapping an abstract run into state_t, action, state_t+1, cost, latency and success/failure.

Never automatically mix Beetlejuice data with existing SPIDER datasets. Product design must not be biased to confirm a SPIDER hypothesis.

## 21. Extensibility
All events are versioned with at least `schema_version`, `event_version`, `collector_version`, `normalization_version`.

Architecture-derived fields must carry provenance/confidence/data-completeness metadata.

Support migrations, backward compatibility and reproducibility without creating a stable global customer identifier.

A future billing adapter must be able to attach economic labels to the canonical architecture/task model without redefining it.

## 22. Security
Apply least privilege, read-only default, secret detection, encryption in transit, encryption at rest where applicable, tenant isolation, audit logs, deletion workflows, retention policies, access control and secure webhook verification.

A detected secret must never be sent to global analytics.

## 23. Monetization flexibility
Architecture may later support free visibility, fixed SaaS subscription or savings-based pricing. Do not hard-code a premature pricing model into the domain architecture.

## 24. Anti-goals
Do NOT build:

- a gigantic platform before V1;
- a generic LLM FinOps dashboard;
- a pure billing aggregator;
- a GitHub replacement;
- a full orchestrator on day one;
- a system needing millions of runs before value;
- an architecture dependent on collecting customer source code globally;
- a sensitive-data lake;
- a product that claims dollar savings it cannot measure;
- a global dataset whose usefulness depends on stable customer identity.

V1 must provide standalone value to one customer.

## 25. Critical tests
Automated and executed real-world tests must prove, at minimum:

### Architecture reconstruction test
Known execution topology/policy is reconstructed correctly from fixture and real frozen evidence; uncertainty is explicit.

### Privacy test
No `GlobalLearningRecord` contains customer/repo/developer identifier, commit hash, PR number, exact path, prompt, code, secret or private URL.

### Re-identification test
Rare events are generalized, bucketed or suppressed before global export.

### Tenant isolation test
One tenant cannot retrieve another tenant's analytics.

### Cost accounting test
Verify represented inference + tools + CI + compute = represented total and that incomplete billing is never labeled complete.

### Outcome attribution test
Verify that evidence is correctly associated with the final outcome, with abstention on ambiguity.

### Schema compatibility test
Represent an agent from a new platform and later attach billing labels without changing the fundamental `AGENTIC_TASK`/architecture concept.

## 26. Minimum deliverables
Produce:

1. documented architecture;
2. canonical task + architecture schema;
3. privacy architecture;
4. GitHub App prototype;
5. event ingestion;
6. architecture reconstruction;
7. outcome attribution;
8. structural-waste detection;
9. local billing/economic attribution seam;
10. tenant analytics;
11. global privacy-safe architecture exporter;
12. privacy gate;
13. initial dashboard/report;
14. tests and real-world robustness evidence;
15. synthetic dataset/demo usable before real customers.

## 27. Guiding principle
The company must not depend on a massive dataset or complete billing to create its first structural value. Every real use should nevertheless improve the possibility of building the future aggregate architecture asset.

`ARCHITECTURE VALUE TODAY + ECONOMIC CALIBRATION LOCALLY + PRIVACY-SAFE DATA ASSET TOMORROW`

## 28. North Star
Ultimately answer:

> For this class of agentic work, which automation architecture/configuration produces the greatest accepted useful work with the least structural waste — and, once real billing is available, what does that architecture actually cost per successful outcome?

The customer must be able to use the product without revealing its source code to the global learning layer.

## Final requirement
Build a real minimal commercial product, not an architecture demonstration.

When future complexity conflicts with V1 simplicity: preserve the canonical architecture/task model, privacy boundaries and future economic-label compatibility, while choosing the simplest implementation that ships a functioning V1.
