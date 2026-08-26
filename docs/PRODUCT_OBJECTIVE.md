# BEETLEJUICE — PRODUCT OBJECTIVE

## The product we are shipping
A GitHub-first, privacy-first optimizer for agentic software-engineering workflows. Its job is to answer one economic question with evidence:

> For this class of agentic work, what configuration produces the greatest accepted useful work per dollar?

The first release MUST create value with one customer/repository and MUST NOT depend on cross-customer learning.

## V1 promise
Connect/install Beetlejuice read-only, reconstruct recent agentic-task economics from GitHub history, then show:

- measured agentic engineering cost for the components actually evidenced;
- successful/accepted outcomes;
- cost per successful outcome only at the evidence completeness actually available;
- certainly avoidable spend only where monetary evidence exists;
- useful non-dollar operational waste evidence when billing is incomplete;
- evidence for every waste finding;
- conservative recommendations.

Never present guessed savings as certain savings. Never present partial cost evidence as a total cost. Missing billing is an explicit evidence state, not zero.

## P0 definition of done
The repository is not “done” because architecture exists. P0 is done only when all of the following are true:

1. `AGENTIC_TASK` is implemented as the vendor-neutral canonical model and versioned.
2. A GitHub adapter can ingest realistic GitHub Actions/PR evidence into that model without making GitHub the domain model.
3. Cost accounting proves `inference + tools + CI + compute = total cost` for represented components.
4. Outcome attribution links cost to accepted/failed/aborted outcomes conservatively.
5. At least one certain-waste detector works end-to-end and produces evidence, not a vague recommendation.
6. A synthetic fixture/demo produces a complete audit without any external account.
7. A read-only GitHub mode can run against a repository when a token/app credential is supplied.
8. A user-facing report/dashboard leads with cost/outcome and avoidable waste, not token counts.
9. Global-learning export contains no source content or linkable stable tenant/repo/developer identity.
10. Privacy tests, rare-record/reidentification tests, cost tests, outcome tests and tenant-isolation tests pass.
11. README contains a reproducible local quickstart and clearly distinguishes synthetic demo from real GitHub mode.
12. CI is green on the integration candidate.

## P0.5 — real-world robustness and billing viability gate
P0 passing is not enough to productize. Before P1, Beetlejuice MUST be falsified against messy real GitHub histories and the billing-evidence problem.

Binding workcard: `docs/workcards/WC-007-REAL-WORLD-ROBUSTNESS.md`.

The gate requires executed evidence from at least 5, preferably 10, real public repositories containing genuine agentic/bot software work and varied workflow histories. It must exercise pagination, large histories, reruns/cancellations, incomplete PR↔Actions relationships, ambiguous outcomes, classification uncertainty, network/rate-limit failures and real HTTPS GitHub ingestion.

The gate also proves three billing states:

- **GitHub-only/no model billing:** remain useful for observable outcomes/retries/waste evidence, but do not claim total dollars or total cost per outcome.
- **Partial billing:** compute only evidenced components and label coverage/partiality explicitly; never extrapolate a fake total.
- **Complete billing:** only here may Beetlejuice label the result total measured economic cost and total cost per successful outcome.

A known false-positive finding labeled `certain`, an unhandled real-history crash, or a product that becomes useless unless missing billing is guessed is a P0.5 failure.

Persist the executed verdict in `reports/real-world-robustness.md`. Do not mark P0.5 ready from fixtures alone.

## P1 — installable GitHub App prototype
Only after P0.5 is green, finish the minimum GitHub App surface:

- least-privilege, read-only permissions by default;
- webhook signature verification;
- installation/repository scoping;
- historical bootstrap audit;
- incremental event ingestion;
- explicit credential/env setup documentation;
- under-five-minute target when sufficient history is available.

## P2 — measured recommendations
Add more certain-waste rules only when they are objectively defensible from observable evidence: superseded runs, duplicated checks/tests, identical retries after deterministic failure, abandoned work, obvious missing caching and similarly provable waste.

## Not in the critical path
Do not spend P0/P0.5 time on pricing, enterprise billing infrastructure, a generic observability platform, full orchestration, model training, cross-customer recommender training, SPIDER hypothesis testing, or a polished marketing site. Billing evidence ingestion needed to falsify the V1 economics claim IS in the P0.5 critical path; building a full billing product is not.

## Required data boundaries
Keep three layers distinct:

- **Source Data:** operational raw data temporarily needed for ingestion.
- **Tenant Analytics:** customer-isolated longitudinal data.
- **Global Learning Dataset:** abstract, privacy-gated, unlinkable-by-default records only.

No stable global customer/repository/developer id and no deterministic hash that recreates one.

## Execution lanes
Parallel work is permitted only where ownership is clear:

- `lab/core`: canonical model, accounting, outcomes, fixtures.
- `lab/github`: GitHub read-only ingestion/App adapter.
- `lab/privacy`: privacy gate, safe exporter, privacy/security tests.
- `lab/product`: report/dashboard/CLI and user workflow.
- `lab/integration`: integrates accepted lane work, fixes cross-lane failures and maintains the runnable product candidate.

Agents should avoid root/config churn unless their workcard explicitly requires it. Integration owns cross-cutting fixes.

## Persistent factory state
`state/factory.json` is the durable autonomous-build state. It must remain machine-readable and use at least:

```json
{
  "schema_version": "1",
  "status": "BUILDING",
  "continue": true,
  "next_action": "IMPLEMENT_P0_5_REAL_WORLD_GATE",
  "blocking_reason": null,
  "p0_checks": {},
  "last_verified_commit": null
}
```

Allowed top-level status values: `BUILDING`, `INTEGRATING`, `BLOCKED_EXTERNAL`, `P0_READY`, `P0_5_READY`, `COMPLETE`.

The supervisor relaunches only while `continue=true` and status is not `BLOCKED_EXTERNAL`/`COMPLETE`.

## Product director rule
At the end of every integration cycle, update `state/factory.json` from verified repository evidence. If a missing item is buildable inside the repository, keep `continue=true` and name the next concrete action. Use `BLOCKED_EXTERNAL` only when progress genuinely requires an external credential/account/decision that cannot be simulated or deferred.

After P0 is green, P0.5 outranks P1 until `reports/real-world-robustness.md` proves the real-world gate. P1 work may be retained if already built, but it must not be used as a substitute for P0.5 evidence.

## Stop rule
The autonomous loop may stop only when:

- P0.5 is verified and state is `P0_5_READY` pending intentionally external installation/product steps; or
- the requested product scope is complete; or
- there is a real external blocker documented with the exact smallest user action required.

A failed agent call, transient network failure, merge conflict, test failure or unfinished code is NOT a valid stop reason.
