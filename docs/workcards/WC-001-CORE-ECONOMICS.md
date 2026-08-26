# WC-001 — Canonical economics core

Owner: `core_builder` / `lab/core`
Priority: P0

## Outcome
A vendor-neutral core that can represent an agentic task and compute defensible cost per successful outcome from normalized evidence.

## Build
- versioned `AGENTIC_TASK` and event schema;
- executions, agents, model/tool/compute/CI/validation/retry/human-intervention components;
- explicit outcome model;
- cost-component accounting and unknown-cost handling;
- tenant-scoped analytics primitives;
- synthetic dataset covering success, failure, abort, retry and merged-PR outcomes;
- deterministic unit tests.

## Acceptance
- GitHub-specific fields are adapter metadata, not required domain keys;
- represented components sum exactly to total cost;
- cost/successful-outcome is reproducible from fixtures;
- a second fictional adapter can map into the same model without schema redesign;
- no global stable tenant/repo/developer id is introduced.

## Do not build
UI, billing, cross-customer ML, generic tracing infrastructure.
