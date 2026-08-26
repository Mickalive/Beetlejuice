# Beetlejuice

Privacy-first Agentic FinOps / Agentic Factory Optimizer.

Beetlejuice measures the **total economic cost per successful agentic outcome** and finds only waste it can defend from observed evidence. GitHub is the first adapter; the core model is vendor-neutral.

## Current build target
P0 is a read-only audit that works first from a synthetic fixture and then from GitHub history:

`task → execution → agent/model/tools/CI/retries/validation → outcome → cost/outcome → certain waste`

The user-facing result leads with total measured cost, successful outcomes, cost per successful outcome and certainly avoidable spend — not token counts.

## Autonomous product factory
The repo is intentionally organized for parallel autonomous work:

- `lab/core`
- `lab/github`
- `lab/privacy`
- `lab/product`
- `lab/integration`

All agents share `AGENTS.md`, `docs/MASTER_PROMPT.md`, `docs/PRODUCT_OBJECTIVE.md`, canonical agent cards and workcards. `state/factory.json` is the durable completion state. GitHub Actions supervisors relaunch unfinished work and retry transient OpenCode/network failures.

## Local commands

```bash
npm test
npm run demo
```

During bootstrap, `npm run demo` becomes valid as WC-005 lands. A missing demo is intentionally a P0 failure, not a fake success.

## Privacy invariant
Source/tenant data may retain relationships necessary for the customer product. The future global-learning export is a separate abstract layer that is unlinkable-by-default: no stable global customer/repo/developer identity, no deterministic hashes standing in for those identities, and no raw code/prompts/issues/PR text/logs/secrets/private URLs.

See `docs/MASTER_PROMPT.md` for the binding specification.
