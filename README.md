# Beetlejuice

Privacy-first Agentic FinOps / Agentic Factory Optimizer.

Beetlejuice measures the **total economic cost per successful agentic outcome** and finds only waste it can defend from observed evidence. GitHub is the first adapter; the core model is vendor-neutral.

## Quickstart (local, zero credentials)

```bash
npm install --ignore-scripts
npm test          # full workspace test suite (core, github, privacy, product, integration)
npm run demo      # complete synthetic audit — economics-first report, no GitHub account needed
```

The synthetic demo prints a report that leads with economics:

- analysis period and agentic tasks analyzed;
- total measured cost (and estimated/unavailable components, kept separate);
- successful outcomes and **cost per successful outcome**;
- certainly avoidable spend with a traceable evidence-backed finding for every dollar.

Token counts appear only as secondary diagnostics; no savings claim derives from them.

## Auditing a real repository (read-only)

Real mode reconstructs agentic-task economics from repository history using strictly GET requests. It never writes to your repositories.

```bash
export BEETLEJUICE_GITHUB_TOKEN=github_pat_...   # fine-grained PAT or App token,
                                                 # read-only: Actions / Contents / Pull requests:read
npm run demo -- --github OWNER/REPO
```

Behavior you can rely on:

- without a token the command refuses with setup guidance instead of fabricating an audit;
- CI/model/tool costs are reported as *unavailable* unless you supply operator billing evidence — nothing is guessed;
- upstream/network failures exit non-zero with the adapter's redacted error;
- reports are labeled `real-github-read-only`, clearly distinct from the `synthetic demo`.

Two additional ingestion seams exist for pre-normalized data (see `apps/cli/docs/NORMALIZED_INPUT.md`):

```bash
npm run demo -- --input path/to/normalized-bundle.json   # adapter-normalized schema-v2 bundle
npm run demo -- --core-audit path/to/core-export.json    # packages/core TenantLedger.audit() export
```

## What the package layout means

| Path | Layer | Role |
| --- | --- | --- |
| `packages/core` | Tenant Analytics | vendor-neutral `AGENTIC_TASK` model, exact micro-USD accounting, outcome attribution, guarded certain-waste rules |
| `packages/github` | Source Data adapter | read-only GitHub history → canonical events / normalized bundles; webhook verification; least privilege |
| `packages/privacy` | Global Learning boundary | privacy gate, unlinkable-by-default exporter, cohort suppression, consent purposes |
| `apps/cli` | Product surface | synthetic demo + real modes; economics-first markdown/JSON reports |
| `test/integration` | cross-lane seams | committed end-to-end tests across package boundaries |

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

## Privacy invariant
Source/tenant data may retain relationships necessary for the customer product. The future global-learning export is a separate abstract layer that is unlinkable-by-default: no stable global customer/repo/developer identity, no deterministic hashes standing in for those identities, and no raw code/prompts/issues/PR text/logs/secrets/private URLs.

See `docs/MASTER_PROMPT.md` for the binding specification.
