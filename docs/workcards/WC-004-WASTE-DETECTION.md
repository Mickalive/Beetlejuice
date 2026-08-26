# WC-004 — Certain-waste engine

Owner: `core_builder`, integrated by `integration_director`
Priority: P0/P2

## Outcome
At least one end-to-end waste finding that Beetlejuice can defend as certainly avoidable from observed evidence.

## First rules
Implement the narrowest high-confidence rules first, for example:
- exact duplicated CI/check execution tied to the same relevant revision/configuration;
- superseded/abandoned execution whose result can no longer contribute to the accepted outcome;
- identical retry after a classified deterministic failure, only where equivalence is provable.

Each finding contains: rule id/version, evidence refs limited to tenant scope, measured cost attributed to the waste, confidence class, explanation and recommended action.

## Acceptance
- synthetic fixture contains positive and negative controls;
- no finding is emitted when evidence is ambiguous;
- avoidable spend is the sum of accepted certain findings without double counting;
- UI/report can explain exactly why each amount was classified as waste.

## Do not build
Speculative model-routing advice masquerading as certain savings.
