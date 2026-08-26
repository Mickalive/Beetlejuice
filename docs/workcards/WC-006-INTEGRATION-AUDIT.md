# WC-006 — Integration, adversarial audit and continuation

Owners: `integration_director`, `product_auditor`, `product_director`
Priority: continuous P0 control plane

## Outcome
Parallel work converges into one runnable candidate; failures become the next build action rather than dead ends.

## Integration contract
- inspect all cycle lane snapshots;
- bring useful changes into `lab/integration`;
- repair cross-lane interfaces/root configuration;
- run full tests and synthetic demo;
- update machine-readable product evidence.

## Audit contract
Try to falsify every P0 claim, especially privacy, cost accounting, outcome attribution, real-vs-demo GitHub behavior and “certain waste”. Record exact commands and evidence.

## Director contract
Update `state/factory.json` from verified evidence. Keep `continue=true` while any P0 gap is fixable in-repo. A network failure, failed test, merge conflict, failed lane or incomplete implementation is not a stop condition.

## External-blocker threshold
`BLOCKED_EXTERNAL` is valid only when all work that can be performed with fixtures/simulation/local code is complete and the remaining validation requires a specific external account, installation, credential or human decision. State the smallest required action.

## Acceptance
The supervisor can decide whether to relaunch using only `state/factory.json`, without guessing from workflow conclusions.
