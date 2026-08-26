/**
 * Registry of certain-waste rules. Order matters: earlier rules claim
 * evidence units first; later rules never double count them.
 *
 * Adding a rule requires: provable equivalence or explicit supersession
 * evidence, deterministic findings, tenant-scope-only refs and an exact
 * explanation. Speculative "possible savings" does not belong here (WC-004).
 */
import { RULE_DUP_CI } from './duplicate-ci.js';
import { RULE_DET_RETRY } from './deterministic-retry.js';
import { RULE_EXEC_SUPERSEDED } from './superseded-execution.js';
import { RULE_EXEC_AFTER_ABORT } from './execution-after-abort.js';

export const DEFAULT_WASTE_RULES = Object.freeze([
  RULE_DUP_CI,
  RULE_DET_RETRY,
  RULE_EXEC_SUPERSEDED,
  // Last: charges only what no more specific rule (dup-CI, det-retry,
  // supersession) already claimed with its sharper explanation.
  RULE_EXEC_AFTER_ABORT,
]);
