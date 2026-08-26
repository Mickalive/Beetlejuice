# BEETLEJUICE — PRODUCT OBJECTIVE

## The product we are shipping
A GitHub-first, privacy-first optimizer for agentic software-engineering workflows.

Beetlejuice's primary learned object is **the architecture of the automation**, not its raw bill.

The product must answer two linked questions:

> Which agentic workflow architectures are structurally efficient or inefficient for this class of task?

and, once the customer's real billing is connected:

> What does this concrete architecture actually cost this customer per successful outcome?

The first release MUST create value with one customer/repository and MUST NOT depend on cross-customer learning.

## Architecture-first product rule
Billing is a calibration/label layer, not the only source of truth about inefficiency.

Beetlejuice should learn from observable architecture and execution structure such as task class, agent/model configuration, sequencing/parallelism, fan-out, retries, escalation, validation topology, CI/test topology, caching/reuse, loop depth, handoffs, termination policy, supersession, resource footprint, outcome and human rework.

A structural inefficiency may be reported without complete billing only when it is defensible from the observed architecture. Dollar savings may be reported only when monetary evidence supports them.

Unknown and inferred fields must carry provenance/confidence. Never silently promote an inferred model/configuration to fact.

## Two-layer economics
### Tenant-local exact economics
When a developer connects GitHub plus relevant provider/tool/CI billing, tenant analytics may retain the local correlations necessary to calculate actual costs for the customer's real model, pricing and automation.

With sufficiently complete billing, show true measured total cost, actual cost per successful outcome and evidenced avoidable spend.

### Global architecture learning
The future cross-customer asset is an unlinkable, privacy-gated corpus of abstract architecture + task context + outcomes/resource signals, progressively enriched with generalized real billing labels where rights and evidence allow.

The global model learns architectural efficiency first; real customer billing progressively calibrates the economic value of those structures.

## V1 promise
Connect/install Beetlejuice read-only, reconstruct recent agentic-task architecture and outcomes from GitHub/provider evidence, then show:

- architecture of the agentic workflow at an abstract operational level;
- successful/accepted outcomes;
- certain structural waste with exact evidence;
- retries, duplication, supersession, unnecessary continued work and other defensible inefficiencies;
- measured agentic engineering cost for the components actually evidenced;
- cost per successful outcome only at the evidence completeness actually available;
- certainly avoidable spend only where monetary evidence exists;
- explicit missing-cost/data coverage;
- conservative architecture recommendations.

Never present guessed savings as certain savings. Never present partial cost evidence as a total cost. Missing billing is an explicit evidence state, not zero.

## P0 definition of done
P0 remains verified when all canonical model, GitHub ingestion, accounting, outcome, waste, privacy, product-surface, documentation and CI criteria are green.

## P0.5 — real-world architecture-learning and billing-calibration gate
P0 passing is not enough to productize. Before P1, Beetlejuice MUST be falsified against real GitHub histories and must prove that the architecture-first corpus is genuinely learnable.

Binding workcard: `docs/workcards/WC-007-REAL-WORLD-ROBUSTNESS.md`.

### Primary corpus
Use at least 5, preferably 10, deliberately high-identifiability public repositories/task slices. Select cases where the task, agent/tool family, workflow topology, outcome and relevant model/configuration are explicit or strongly constrained enough to test clean hypotheses.

Do NOT maximize breadth at the expense of label quality. Every training variable carries provenance/confidence. Ambiguous cases belong in a separate robustness/abstention set.

### Architecture-learning requirement
The primary corpus must support explicit falsifiable relations of the form:

`TASK CONTEXT + AGENT/MODEL CONFIG + AUTOMATION ARCHITECTURE -> OUTCOME / LATENCY / WASTE / RESOURCE FOOTPRINT`

Architecture variables should capture topology and policy, not merely counts. Examples include sequencing vs parallelism, fan-out, retry policy, escalation policy, validation graph, test/CI repetition, cache/reuse, loop depth, handoffs, termination/early-stop behavior and supersession handling.

### Economic calibration requirement
P0.5 must demonstrate at least one credible path from architecture rows to real economics:

1. **Complete economic labels** on a useful subset, attributable to agentic units of work; or
2. **Learnable architecture rows now + demonstrated calibration path later**, where a subset with real provider/tool/CI billing can attach true economic labels without rewriting the canonical architecture model.

The second path is valid only if billing labels are target/calibration variables rather than hidden prerequisites for identifying architecture.

### Billing states in the customer product
- **GitHub-only/no model billing:** show architecture/outcome/waste evidence and explicit missing cost coverage; no fake dollars.
- **Partial billing:** compute only evidenced components and label coverage/partiality explicitly.
- **Complete billing:** only here may Beetlejuice label the result total measured economic cost and total cost per successful outcome.

A known false-positive `certain` finding, an unhandled real-history crash, a contaminated primary corpus, or a model that cannot later accept real billing labels without redesign is a P0.5 failure.

Persist the executed verdict in `reports/real-world-robustness.md`. Do not mark P0.5 ready from fixtures alone.

## P1 — installable GitHub App prototype
Only after P0.5 is green, finish the minimum GitHub App surface:

- least-privilege, read-only permissions by default;
- webhook signature verification;
- installation/repository scoping;
- historical bootstrap audit;
- incremental event ingestion;
- optional/local provider billing connectors or evidence ingestion;
- explicit credential/env setup documentation;
- under-five-minute target when sufficient history is available.

## P2 — local architecture recommendations
Add and validate measured architecture interventions only when they are objectively defensible: retry/termination policy, validation topology, test duplication, superseded work, caching/reuse, escalation/model routing and similar structural changes.

## P3 — privacy-safe aggregate learning
Once enough consented, privacy-safe rows exist, learn cross-customer architecture/outcome relationships and calibrate them with generalized true billing labels. Do not require stable customer/repository/developer identity.

## Required data boundaries
Keep three layers distinct:

- **Source Data:** operational raw data temporarily needed for ingestion.
- **Tenant Analytics:** customer-isolated longitudinal architecture, outcomes and exact billing correlation.
- **Global Learning Dataset:** abstract, privacy-gated, unlinkable-by-default architecture/outcome/resource/economic records only.

No stable global customer/repository/developer id and no deterministic hash that recreates one.

## Execution lanes
Parallel work is permitted only where ownership is clear:

- `lab/core`: canonical model, architecture representation, accounting, outcomes, fixtures.
- `lab/github`: GitHub read-only ingestion/App adapter.
- `lab/privacy`: privacy gate, safe exporter, privacy/security tests.
- `lab/product`: report/dashboard/CLI and user workflow.
- `lab/integration`: integrates accepted lane work, fixes cross-lane failures and maintains the runnable product candidate.

## Persistent factory state
`state/factory.json` is the durable autonomous-build state. After P0, P0.5 outranks P1 until the real-world architecture-learning gate is verified.

Allowed top-level status values: `BUILDING`, `INTEGRATING`, `BLOCKED_EXTERNAL`, `P0_READY`, `P0_5_READY`, `COMPLETE`.

## Product director rule
At the end of every integration cycle, update `state/factory.json` from verified repository evidence. If a missing item is buildable inside the repository, keep `continue=true` and name the next concrete action. Use `BLOCKED_EXTERNAL` only when progress genuinely requires an external credential/account/decision that cannot be simulated or deferred.

P1 work may be retained if already built, but it must not substitute for architecture-learning evidence.

## Stop rule
The autonomous loop may stop only when:

- P0.5 is verified and state is `P0_5_READY` pending intentionally external installation/product steps; or
- the requested product scope is complete; or
- there is a real external blocker documented with the exact smallest user action required.

A failed agent call, transient network failure, merge conflict, test failure or unfinished code is NOT a valid stop reason.
