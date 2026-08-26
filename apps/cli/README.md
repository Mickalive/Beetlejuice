# @beetlejuice/product-cli — audit report surface (WC-005)

The user-facing economics surface: one command produces the complete agentic
audit — total measured cost, successful outcomes, cost per successful outcome,
certainly avoidable spend with exact evidence, and a data-quality section that
separates **measured / estimated / unavailable** costs. Token counts are
secondary diagnostics only. Read-only by construction.

## Quickstart (no GitHub credentials, no network)

From the repository root:

```bash
npm install --ignore-scripts
npm run demo            # complete synthetic audit on stdout
```

Write artifacts instead of printing only:

```bash
npm run demo -- --out apps/cli/out   # writes out/audit-report.md + .json
```

`npm run demo` is deterministic: identical inputs produce byte-identical
reports (pinned by `test/determinism.test.js`).

## Real read-only modes

| Mode | Command | Input contract |
| --- | --- | --- |
| normalized-input | `npm run demo -- --input FILE.json` | versioned schema-v2 bundle of canonical `agentic_task` records — see [docs/NORMALIZED_INPUT.md](docs/NORMALIZED_INPUT.md); produce envelopes with `buildNormalizedBundle()` |
| canonical-core | `npm run demo -- --core-audit FILE.json` | versioned `packages/core` `TenantLedger.audit()` export (`ledger.exportCoreAudit()`) — economics are computed by core and consumed verbatim |

Both modes refuse raw provider payloads with exit code 2 — adapters must
normalize before this boundary.

## Library use (dashboard/server ready)

```js
import {
  buildAuditReport,
  buildReportFromCoreAudit,
  renderMarkdownReport,
} from "@beetlejuice/product-cli";
```

One report model feeds the CLI today and any future product surface; nothing
here recomputes canonical-core economics or parses provider payloads.

## Tests

```bash
npm test                # from repo root: runs every workspace suite
node --test apps/cli/test   # this package only
```

`test/cross-package-seam.test.js` executes the full
github → core → product journey when sibling packages are mounted
(integration trees) and skips with an explicit reason on lane-only checkouts.
