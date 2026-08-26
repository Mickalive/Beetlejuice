# WC-002 — GitHub read-only adapter

Owner: `github_builder` / `lab/github`
Priority: P0 → P1

## Outcome
GitHub history becomes canonical Beetlejuice evidence without turning the domain into a GitHub-specific model.

## Build
- normalized mapping for workflow runs/jobs/checks and PR lifecycle evidence;
- read-only historical collector with fixture-backed tests;
- correlation strategy from GitHub evidence to canonical tasks, with confidence/unknown states rather than fabricated certainty;
- GitHub App prototype surface and least-privilege permission documentation;
- webhook signature verification and incremental event normalization for P1;
- explicit cost-source adapters: measured values where supplied, transparent unknown/estimated categories otherwise.

## Acceptance
- fixture audit works without credentials;
- real mode can read an explicitly configured repo with credentials when available;
- no write permission is needed for initial audit;
- webhook verification is tested;
- raw GitHub identifiers remain in tenant/source scope and never leak into the global exporter interface.

## Do not build
A GitHub replacement, autonomous code-writing actions, billing or a GitHub-specific core schema.
