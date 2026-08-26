# BEETLEJUICE — AGENT NORTH STAR

Beetlejuice is a commercial Agentic FinOps / Agentic Factory Optimizer, privacy-first and GitHub-first.

## Mission
Build a real installable product that measures and then reduces the **total economic cost per successful agentic outcome**. This is not a token dashboard.

Canonical metric:

`TOTAL ECONOMIC COST / SUCCESSFUL OUTCOME`

Examples: cost / merged PR, cost / resolved issue, cost / accepted task, time / accepted task, successful outcomes / dollar.

## Non-negotiable product sequence
- V1: instrumentation + certain-waste detection + cost/outcome attribution.
- V2: local per-tenant/repository autotuning.
- V3: cross-customer learning only from genuinely unlinkable privacy-safe records.
- V4: universal benchmark + optimizer for agentic systems.

V1 MUST already emit a canonical, versioned data model that can support V3/V4 without redesigning the fundamentals.

## Absolute privacy boundary
Source data and tenant analytics may contain the relationships needed for the customer product. The global learning dataset MUST NOT contain stable or deterministic identifiers that allow records to be linked to a company, GitHub account/org, repository, developer, branch, commit, PR, issue, user, IP, domain, project, or customer.

No stable global customer_id/repository_id/developer_id. No deterministic hashes of repo/domain/commit/user. No raw source code, raw diffs, prompts, issue/PR text, comments, textual logs, stack traces with paths/secrets, filenames, URLs, secrets, API keys, commit hashes, branch names, exact timestamps unless strictly needed, internal product/customer names, emails/usernames/IPs or personal data in the global dataset.

Privacy-safe export is **UNLINKABLE BY DEFAULT** and passes a privacy gate that strips identifiers, generalizes values, buckets magnitudes, suppresses rare combinations and unnecessary technical fingerprints, and can apply cohort thresholds/aggregation/privacy-risk scoring.

## Canonical domain model
Never build the product around `github_action_run`. Build around vendor-neutral `AGENTIC_TASK`:

TASK -> executions -> agents -> model invocations -> tool invocations -> compute -> CI -> validations -> retries -> human intervention -> outcome.

GitHub is only adapter #1. Future adapters must fit without changing the fundamental model.

## Outcome-first economics
At minimum model: task_started, task_aborted, task_failed, PR_created, PR_closed, PR_merged, CI_passed, CI_failed, human_rework, retry, revert. When possible: time_to_merge, human_changes_after_agent, review cycles, failure category, short-term revert.

Never claim savings or optimization that cannot be measured. A more expensive run can be economically superior if its success rate makes cost/successful-outcome lower.

## V1 product behavior
Initial audit is READ-ONLY. Reconstruct agentic task economics from GitHub history, show cost/outcome, identify only **certain waste**, explain the evidence, recommend changes, and later allow optional PR/autotuning with measured savings.

Target first screen: total agentic engineering cost, successful/accepted outcomes, cost per accepted outcome, certainly avoidable spend, potential savings, and exact reasons.

Time-to-value target: under five minutes when enough GitHub history exists.

## Certain-waste examples
Abandoned/superseded runs; duplicated CI/test suites/checks; identical retries after deterministic failure; agents continuing after their objective disappeared; obvious missing cache; cost on branches never used; premium models on objectively deterministic operations when identifiable.

## Security
Least privilege, read-only default, webhook verification, tenant isolation, encryption in transit/at rest where applicable, secret detection, retention/deletion workflows, access control and auditability. A detected secret must never reach global analytics.

## Required architecture layers
1. Source Data — temporary/raw operational data needed to function.
2. Tenant Analytics — isolated customer-local longitudinal relationships.
3. Global Learning Dataset — abstract privacy-safe representations only.

Product telemetry, global benchmark contribution, and external research/data licensing are separate rights/consent surfaces.

## SPIDER boundary
A distinct, explicitly versioned `AGENTIC_DYNAMICS_EXPORT` may later export abstract state/action/next-state/cost/latency/outcome records for independent research. Never mix product data automatically with existing SPIDER datasets and never bias the product to confirm SPIDER hypotheses.

## Engineering invariants
- Every event is versioned: schema_version, event_version, collector_version, normalization_version.
- Support migrations, backward compatibility, provenance and reproducibility.
- Preserve privacy boundaries and canonical schema over convenience.
- Prefer the simplest executable V1 when future complexity conflicts with delivery speed.
- Tests are part of the product, especially privacy, re-identification resistance, tenant isolation, cost accounting, outcome attribution and schema extensibility.

## Definition of product, not architecture theater
Every branch/PR/agent must move at least one user-visible or testable V1 capability toward a functioning GitHub-installed product. Do not build a giant platform, generic LLM FinOps dashboard, GitHub replacement, day-one orchestrator, sensitive data lake, or a system that requires millions of runs before producing value.

## Shared source of truth
The user's original binding prompt is preserved verbatim in `docs/MASTER_PROMPT_ORIGINAL_FR.md`. The normalized engineering specification is `docs/MASTER_PROMPT.md`. The execution target is `docs/PRODUCT_OBJECTIVE.md` plus `docs/workcards/`. Every agent MUST read this `AGENTS.md`, the original prompt, the normalized specification, the objective and its relevant workcard before modifying code. If a local task conflicts with the original master prompt, the original master prompt wins.

## North Star
For this class of agentic work, what configuration produces the greatest **accepted useful work per dollar** — without requiring the customer to reveal source code to the global learning layer?
