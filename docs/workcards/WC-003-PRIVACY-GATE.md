# WC-003 — Privacy gate and global exporter

Owner: `privacy_builder` / `lab/privacy`
Priority: P0

## Outcome
A global-learning export that is privacy-safe by construction and rejects linkable/raw customer data.

## Build
- explicit `GlobalLearningRecord` schema containing only abstract/bucketed fields;
- forbidden-field/content checks before export;
- bucketing/generalization helpers;
- rare-combination/cohort suppression mechanism;
- privacy-risk result explaining suppressed/generalized fields;
- separate consent-purpose enum/surfaces for product telemetry, benchmark contribution and external research/data licensing;
- privacy, re-identification and tenant-isolation tests.

## Acceptance
- tests deliberately inject repo/customer/developer ids, hashes, paths, PR numbers, URLs, code, prompts and secrets and prove they cannot enter a valid global record;
- a deliberately unique synthetic record is generalized or suppressed;
- no deterministic pseudonym is used as a global join key;
- transformations are versioned and reproducible;
- output contains enough abstract economics/outcome information for future benchmarking.

## Do not build
A global data lake, raw-text classifier requiring cloud export, cross-customer ML or claims of legal anonymity beyond what tests support.
