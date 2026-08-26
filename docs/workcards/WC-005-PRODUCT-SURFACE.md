# WC-005 — Audit report / dashboard

Owner: `product_builder` / `lab/product`
Priority: P0

## Outcome
A user can run a synthetic audit immediately and understand economic performance and provable waste before seeing implementation detail.

## First surface
Lead with:
- analysis period;
- agentic tasks;
- total measured cost;
- successful outcomes;
- cost per successful outcome;
- certainly avoidable spend;
- waste ratio/potential measured savings;
- evidence-backed finding list.

Provide an explicit data-quality section showing measured, estimated and unavailable cost components.

## Acceptance
- one documented command launches or generates the complete synthetic demo;
- output is usable without any GitHub credentials;
- a real-read-only mode consumes normalized GitHub adapter output without UI-specific parsing of raw GitHub objects;
- token counts are secondary diagnostics only;
- every savings number can be traced to a certain-waste finding.

## Do not build
Marketing pages, billing, elaborate design system, user management platform or generic LLM observability charts.
