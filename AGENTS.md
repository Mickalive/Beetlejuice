# BEETLEJUICE — AGENT NORTH STAR

Beetlejuice is a commercial architecture-first optimizer for agentic software factories, privacy-first and GitHub-first.

## Mission
Build a real installable product that learns **which automation architectures produce useful agentic work efficiently**, then calibrates that structural model with the customer's real local billing.

This is not a token dashboard and not merely a FinOps dashboard.

The explanatory object is the **architecture of the automation**. Cost is a local calibration/label layered onto that architecture when billing evidence exists.

Customer-facing economic metric when sufficiently evidenced:

`TOTAL ECONOMIC COST / SUCCESSFUL OUTCOME`

Global learning question:

`ARCHITECTURE + TASK CONTEXT + MODEL/AGENT CONFIGURATION -> OUTCOME / WASTE / RESOURCE FOOTPRINT`, later calibrated with privacy-safe real economic labels.

## Architecture-first rule
Beetlejuice must be able to identify structural inefficiency before complete billing exists, when the inefficiency is defensible from observable execution structure.

Canonical architectural features may include, when observable:
- task class / difficulty proxy;
- agent/tool family and version;
- model/provider/configuration with provenance/confidence;
- execution graph/topology;
- sequencing vs parallelism / fan-out;
- retry and escalation policy;
- validation/reviewer topology;
- CI/test topology and duplication;
- caching/reuse behavior;
- loop depth and repeated unchanged work;
- handoffs between agents/models/tools;
- early-stop / termination behavior;
- supersession/abandonment behavior;
- tool-call/resource footprint;
- outcome, latency, human rework and revert evidence.

Unknown remains unknown. Never manufacture an architectural feature or promote an inferred model/configuration to fact.

## Non-negotiable product sequence
- V1: architectural instrumentation + certain structural-waste detection + local cost/outcome calibration when billing evidence exists.
- V2: local per-tenant/repository autotuning of architecture/configuration.
- V3: cross-customer learning from genuinely unlinkable architectural records, enriched by privacy-safe real billing/outcome labels where consent and evidence allow.
- V4: benchmark + architecture optimization engine for agentic systems.

V1 MUST already emit a canonical, versioned architecture representation that can support V3/V4 without redesigning the fundamentals.

## Two economic layers
### Tenant-local exact economics
When a developer connects GitHub plus the relevant model/tool/CI billing sources, Beetlejuice may retain tenant-local correlation needed to compute actual costs for that customer's concrete agent/model/pricing/workflows.

The customer should receive real measured cost/outcome numbers at the evidence completeness actually available.

### Global learning economics
Cross-customer learning never requires source content or stable identity. Only privacy-gated abstract architectural features, outcomes/resource signals and generalized economic labels may leave the tenant boundary, subject to rights/consent.

The global model learns structural relationships first. Real billing progressively calibrates those relationships economically.

## Absolute privacy boundary
Source data and tenant analytics may contain the relationships needed for the customer product. The global learning dataset MUST NOT contain stable or deterministic identifiers that allow records to be linked to a company, GitHub account/org, repository, developer, branch, commit, PR, issue, user, IP, domain, project, or customer.

No stable global customer_id/repository_id/developer_id. No deterministic hashes of repo/domain/commit/user. No raw source code, raw diffs, prompts, issue/PR text, comments, textual logs, stack traces with paths/secrets, filenames, URLs, secrets, API keys, commit hashes, branch names, exact timestamps unless strictly needed, internal product/customer names, emails/usernames/IPs or personal data in the global dataset.

Privacy-safe export is **UNLINKABLE BY DEFAULT** and passes a privacy gate that strips identifiers, generalizes values, buckets magnitudes, suppresses rare combinations and unnecessary technical fingerprints, and can apply cohort thresholds/aggregation/privacy-risk scoring.

## Canonical domain model
Never build the product around `github_action_run`. Build around vendor-neutral `AGENTIC_TASK` plus its architecture:

TASK -> executions -> agents -> model invocations -> tool invocations -> compute -> CI -> validations -> retries -> human intervention -> outcome.

The model must preserve enough topology/order/correlation to characterize the automation architecture without making GitHub the domain.

GitHub is only adapter #1. Future adapters must fit without changing the fundamental model.

## Outcome-first, architecture-first evaluation
At minimum model: task_started, task_aborted, task_failed, PR_created, PR_closed, PR_merged, CI_passed, CI_failed, human_rework, retry, revert. When possible: time_to_merge, human_changes_after_agent, review cycles, failure category, short-term revert.

A structural finding can be useful without dollar billing. Examples: deterministic retry loop, duplicated full validation, work continuing after supersession, repeated unchanged checks, avoidable fan-out, missing early termination.

Dollar savings may be claimed only where monetary evidence supports them.

## V1 product behavior
Initial audit is READ-ONLY. Reconstruct the customer's agentic automation architecture from GitHub/provider evidence, identify only defensible structural waste, show outcomes and architecture diagnostics, then overlay real local economics when billing evidence is connected.

With full billing, target customer surface: actual agentic engineering cost, successful/accepted outcomes, actual cost per accepted outcome, certainly avoidable spend, and exact architectural reasons.

Without full billing, show the architecture/waste evidence and explicit missing-cost coverage instead of inventing totals.

Time-to-value target: under five minutes when enough history exists.

## Certain structural-waste examples
Abandoned/superseded runs; duplicated CI/test suites/checks; identical retries after deterministic failure; agents continuing after their objective disappeared; unnecessary fan-out or repeated validation when objectively provable; obvious missing cache/reuse; repeated unchanged work; cost on branches never used; premium models on objectively deterministic operations when identifiable.

## Required architecture layers
1. Source Data — temporary/raw operational data needed to function.
2. Tenant Analytics — isolated customer-local longitudinal relationships, architecture and exact billing correlation.
3. Global Learning Dataset — abstract privacy-safe architecture/outcome/resource/economic representations only.

Product telemetry, global benchmark contribution, and external research/data licensing are separate rights/consent surfaces.

## P0.5 learning rule
The primary real-world corpus is deliberately high-identifiability. It exists to learn/test architectural hypotheses cleanly, not to maximize row count.

P0.5 may advance through either:
- complete economic labels on a useful subset; or
- a high-confidence architectural corpus whose variables/outcomes are learnable now and for which later real billing can provide calibration labels.

A messy/ambiguous repo belongs in the robustness/abstention set, not in ground-truth training merely to inflate the corpus.

## Security
Least privilege, read-only default, webhook verification, tenant isolation, encryption in transit/at rest where applicable, secret detection, retention/deletion workflows, access control and auditability. A detected secret must never reach global analytics.

## SPIDER boundary
A distinct, explicitly versioned `AGENTIC_DYNAMICS_EXPORT` may later export abstract state/action/next-state/cost/latency/outcome records for independent research. Never mix product data automatically with existing SPIDER datasets and never bias the product to confirm SPIDER hypotheses.

## Engineering invariants
- Every event is versioned: schema_version, event_version, collector_version, normalization_version.
- Architecture features carry provenance/confidence and data-completeness indicators.
- Support migrations, backward compatibility, provenance and reproducibility.
- Preserve privacy boundaries and canonical schema over convenience.
- Prefer the simplest executable V1 when future complexity conflicts with delivery speed.
- Tests are part of the product, especially privacy, re-identification resistance, tenant isolation, architecture reconstruction, cost accounting, outcome attribution and schema extensibility.

## Definition of product, not architecture theater
Every branch/PR/agent must move at least one user-visible or testable capability toward a functioning GitHub-installed product. Do not build a giant platform, generic LLM FinOps dashboard, GitHub replacement, day-one orchestrator, sensitive data lake, or a system that requires millions of runs before producing value.

## Shared source of truth
The user's original binding prompt is preserved verbatim in `docs/MASTER_PROMPT_ORIGINAL_FR.md`. The normalized engineering specification is `docs/MASTER_PROMPT.md`. The execution target is `docs/PRODUCT_OBJECTIVE.md` plus `docs/workcards/`. Every agent MUST read this `AGENTS.md`, the original prompt, the normalized specification, the objective and its relevant workcard before modifying code.

## North Star
For this class of agentic work, **which automation architecture/configuration produces the greatest accepted useful work with the least structural waste**, and, once local billing is connected, **what does that architecture actually cost this customer per successful outcome?**
