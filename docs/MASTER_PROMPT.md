# PROMPT MAÎTRE — BEETLEJUICE / AGENTIC FINOPS
## Agentic Factory Optimizer — Privacy-First Data Network

This file is the binding product specification for every autonomous agent working in this repository. `AGENTS.md` is the compact operational summary; this file is the fuller source of truth.

## 1. Mission
Build a commercial product, installable first on GitHub, that measures and then reduces the real cost of coding-agent workflows.

This is NOT a token dashboard.

Fundamental metric:

`TOTAL ECONOMIC COST / SUCCESSFUL OUTCOME`

Examples: dollars per merged PR, dollars per resolved issue, dollars per accepted task, time per accepted task, successful outcomes per dollar.

Measure the whole chain where observable: task → agent → model → context → tools → CI → tests → retries → reviewers/auditors → PR → final outcome.

## 2. Business sequence
V1 = instrumentation + certain-waste detection + cost per outcome.

V2 = local autotuning inside each customer/repository.

V3 = cross-customer learning only from data that is genuinely non-linkable.

V4 = benchmark + universal optimization engine for agentic systems.

V1 must be designed from its first commit to create the abstract data needed later, without requiring a fundamental schema rewrite.

## 3. Absolute confidentiality principle
The future global-learning dataset must not allow an event to be attached to a company, GitHub account, GitHub org, repository, developer, branch, commit, identifiable PR, identifiable issue, user, IP, domain or project.

Replacing `acme-corp` with `customer_8742` is not enough. A stable pseudonym remains linkable.

Global data is **UNLINKABLE BY DEFAULT**:

- no stable global customer id;
- no stable global repository id;
- no stable global developer id;
- no deterministic hash of repo/domain/commit/user;
- no identifier allowing global records to be grouped by customer.

Longitudinal customer analytics remain tenant-local.

## 4. Three mandatory data layers
### A. Source Data
Operational data held at GitHub/customer scope: code, issues, PRs, commits, logs, workflows, prompts/traces when necessary and outcomes. It may be temporarily necessary for the product, but it is never the global dataset.

### B. Tenant Analytics
An isolated customer space that may retain relationships needed for repository history, cost trends, before/after comparisons, local experiments, autotuning and workflow attribution. It is tenant-isolated, minimized, encrypted where applicable and subject to explicit retention/deletion policy.

### C. Global Learning Dataset
Only generalized representations such as task class, language family, repo-size bucket, files-touched bucket, dependency-complexity bucket, agent family, model class, orchestration pattern, token/cost/tool-call/duration buckets and abstract outcomes.

No source content is required in this dataset.

## 5. Never export globally by default
Do not retain globally: source code, raw diff, raw prompts, issue text, PR descriptions, comments, textual logs, stack traces containing paths/secrets, filenames, repo/org names, emails, usernames, IPs, private URLs, secrets, API keys, commit hashes, branch names, unnecessary exact timestamps, internal product/client names or personal data.

Semantic classification should happen before export whenever possible. Example: a raw issue such as a named JWT/payment-gateway fix becomes only abstract fields such as `task_type=bug_fix`, `subsystem=authentication`, `complexity=medium`.

## 6. Privacy Gate / re-identification defense
Removing names is insufficient. Rare combinations can identify a source. Before admitting a global record:

1. remove identifiers;
2. generalize values;
3. bucket magnitudes;
4. detect extraordinarily rare combinations;
5. suppress/generalize overly unique features;
6. remove unnecessary technical fingerprints.

Prefer coarse categories over exact rare versions, exact LOC/hardware counts, custom internal agent names or exact timestamps. Support cohort thresholds, aggregation, rare-category suppression, privacy-risk scoring and, when publishing aggregate statistics, differential privacy where appropriate.

A simple hash is never treated as anonymization.

## 7. Canonical Agentic Task Model
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

GitHub is adapter #1. Future adapters may include GitLab, Bitbucket, Claude Code, Codex, Cursor, OpenCode, Devin, Jenkins, Buildkite, CircleCI, Browserbase, cloud compute and custom agents without changing the core concept.

## 8. Outcome measurement
Token optimization without final outcomes is insufficient. Distinguish at least:

`task_started`, `task_aborted`, `task_failed`, `PR_created`, `PR_closed`, `PR_merged`, `CI_passed`, `CI_failed`, `human_rework`, `retry`, `revert`.

When possible also derive time-to-merge, human changes after agent, review-cycle count, failure category and revert within N days.

Economic evaluation compares cost per successful outcome, not merely cost per run. An $8 run succeeding 85% can be better than a $4 run succeeding 35%.

## 9. V1 = instrumentation + certain waste
V1 must not claim universal optimum. It detects only waste demonstrable from the customer's evidence.

Candidate findings include abandoned runs, superseded runs, duplicated CI, unnecessarily repeated test suites, identical retries after deterministic errors, agents continuing after their objective disappeared, identical repeated checks, obvious missing cache, costs on unused branches, and premium models on objectively deterministic operations when identifiable.

The first audit is READ-ONLY.

The first useful result should resemble:

- recent agentic tasks;
- total measured cost;
- successful outcomes;
- cost/successful outcome;
- certainly wasted spend;
- waste ratio;
- exact evidence for each finding.

## 10. V2 = local autotuning
Experiments occur inside one customer's system. Persist experiment, baseline, candidate, confidence, cost delta and outcome delta. Detailed longitudinal data remains tenant-local.

Only abstract intervention type/context and aggregate before/after effects may become privacy-safe global records.

## 11. V3 = cross-customer learning
With enough valid data, estimate things such as success probability, expected cost and expected latency for abstract task/configuration classes, then optimize useful outcomes subject to budget, latency and reliability constraints.

Do not fabricate benchmark confidence from insufficient cohorts.

## 12. Contribution incentive
Never just ask for telemetry. A contributor should receive concrete value such as industry benchmarks, percentile ranking, cross-model comparison, recommended configuration ranges or early access to a global optimizer.

## 13. Data rights
Installation does not automatically grant rights to train commercial models, sell datasets, provide data to third parties or provide data to frontier labs.

Separate technically and contractually where needed:

- PRODUCT TELEMETRY;
- GLOBAL BENCHMARK CONTRIBUTION;
- EXTERNAL RESEARCH / DATA LICENSING.

Any future collaboration with OpenAI, Anthropic, Google DeepMind, xAI, Meta or others may use only data/statistics for which the company has the necessary rights.

## 14. Future frontier-lab data product
Design the abstract schema so future lawful datasets can answer questions such as real cost per task/model, real failure rates, effect of context/cache/retries/agent count/reviewer/tool calls, performance by task class, cheap→frontier escalation, marginal compute efficiency, success by orchestration, abandoned-task frequency, cost/quality/duration tradeoffs and which multi-agent architectures actually work.

Never weaken confidentiality to make this dataset richer.

## 15. SPIDER / research export boundary
Provide a distinct, explicitly versioned future `AGENTIC_DYNAMICS_EXPORT` mapping an abstract run into state_t, action, state_t+1, cost, latency and success/failure.

This may support independent research on attractors, loops, metastability, transitions, barriers, efficient paths, committors, entropy, novelty cost, trajectory structure, effective dimension and transition rules.

Never automatically mix Beetlejuice data with existing SPIDER datasets. Product design must not be biased to confirm a SPIDER hypothesis.

## 16. Extensibility
All events are versioned with at least `schema_version`, `event_version`, `collector_version`, `normalization_version`.

Support migrations, backward compatibility, provenance and reproducibility without creating a stable global customer identifier.

## 17. Security
Apply least privilege, read-only default, secret detection, encryption in transit, encryption at rest where applicable, tenant isolation, audit logs, deletion workflows, retention policies, access control and secure webhook verification.

A detected secret must never be sent to global analytics.

## 18. Product flow
GitHub App installation flow:

Install → read-only observation → reconstruct agentic-task economics → show cost/outcome → identify certain waste → recommend changes → optional PR/autotuning → measure actual savings.

Target time-to-value: under five minutes when sufficient GitHub history exists.

## 19. First wow moment
The main surface starts with economics, not tokens:

- agentic engineering cost;
- accepted tasks;
- cost/accepted task;
- certainly avoidable spend;
- potential savings;
- exact reasons.

## 20. Monetization flexibility
Architecture may later support free visibility, fixed SaaS subscription or savings-based pricing. Do not hard-code a premature pricing model into the domain architecture.

## 21. Anti-goals
Do NOT build:

- a gigantic platform before V1;
- a generic LLM FinOps dashboard;
- a GitHub replacement;
- a full orchestrator on day one;
- a system needing millions of runs before value;
- an architecture dependent on collecting customer source code globally;
- a sensitive-data lake;
- a product that claims to optimize what it cannot measure.

V1 must provide standalone value to one customer.

## 22. Critical tests
Automated tests must prove, at minimum:

### Privacy test
No `GlobalLearningRecord` contains customer/repo/developer identifier, commit hash, PR number, exact path, prompt, code, secret or private URL.

### Re-identification test
Deliberately create rare events and verify the Privacy Gate generalizes, buckets or suppresses them before export.

### Tenant isolation test
One tenant cannot retrieve another tenant's analytics.

### Cost accounting test
Verify represented inference + tools + CI + compute = total cost.

### Outcome attribution test
Verify that cost is correctly associated with the final outcome.

### Schema compatibility test
Represent an agent from a new platform without changing the fundamental `AGENTIC_TASK` concept.

## 23. Minimum deliverables
Produce:

1. documented architecture;
2. canonical schema;
3. privacy architecture;
4. GitHub App prototype;
5. event ingestion;
6. cost attribution;
7. outcome attribution;
8. tenant analytics;
9. global privacy-safe exporter;
10. privacy gate;
11. first waste detector;
12. initial dashboard/report;
13. tests;
14. documentation;
15. synthetic dataset/demo usable before real customers.

## 24. Guiding principle
The company must not depend on a massive dataset to create its first value. Every real use should nevertheless improve the possibility of building the future aggregate asset.

`VALUE TODAY + DATA ASSET TOMORROW`, without sacrificing `CUSTOMER CONFIDENTIALITY`.

## 25. North Star
Ultimately answer:

> For this class of agentic work, what configuration produces the greatest accepted useful work per dollar?

The customer must be able to use the product without revealing its source code to the global learning layer.

## Final requirement
Build a real minimal commercial product, not an architecture demonstration.

When future complexity conflicts with V1 simplicity: preserve the canonical data model, privacy boundaries and future compatibility, while choosing the simplest implementation that ships a functioning V1.
