/**
 * WASTE_EXEC_AFTER_ABORT_V1 — executions started after the task objective
 * disappeared (abort).
 *
 * Certain when: the task carries an explicit `task_aborted` signal and an
 * execution STARTED strictly after that signal in the ledger total order.
 * Once the objective is declared gone, any newly started execution
 * demonstrably cannot contribute to this task's outcome, so every component
 * cost attached to it is certainly avoidable spend.
 *
 * This is the canonical-core equivalent of the product-surface rule
 * EXECUTION_AFTER_TASK_ABORT (same epistemics: only post-abort STARTS are
 * charged — never pre-abort executions merely because they kept running).
 *
 * Rule-boundary guards (certainty preconditions — abstain = no finding):
 * - G1 (terminal-consistency): the resolved outcome must be exactly
 *   `aborted`. Any merged PR (`accepted`), explicit failure signal or
 *   closed-without-merge PR (`failed`) downstream of the abort is observable
 *   evidence that either the objective did not permanently disappear or the
 *   post-abort work interacted with a live objective — under either reading
 *   "this spend could not contribute" becomes indefensible, so NOTHING is
 *   charged for the task. Mirrors the conservative attribution hierarchy:
 *   merged > failed > closed-unmerged > aborted.
 * - G2 (strictly-after start): only executions whose recorded start position
 *   is STRICTLY after the abort signal are candidates. Executions that began
 *   while the objective still existed stay on the books uncharged, even if
 *   they kept running afterwards — continuation alone is not proof the spend
 *   was avoidable at start time. The ledger `seq` total order (strictly
 *   monotonic per tenant ledger) is used instead of wall-clock timestamps:
 *   reconstruction order IS the canonical observation order, immune to clock
 *   skew and timezone ambiguity.
 * - G3 (last abort wins): when several `task_aborted` signals were observed,
 *   only starts after the LAST one are charged; the window between two aborts
 *   is ambiguous (a re-scoped objective may have existed) and abstains.
 * - G4 (attribution requirement): only components ATTACHED to the post-abort
 *   execution are charged. Unassigned components carry no provable execution
 *   start, so they are never attributed to post-abort work by this rule.
 * - G5 (nothing to charge): an execution without components produces no
 *   candidate.
 *
 * Double counting: components claimed by earlier rules (duplicated CI,
 * deterministic retries, superseded execution) are stripped globally by the
 * engine, so this rule only charges what no more specific rule already
 * attributed with its sharper explanation.
 */
import { formatUsd } from '../../money.js';

export const RULE_EXEC_AFTER_ABORT = Object.freeze({
  id: 'WASTE_EXEC_AFTER_ABORT_V1',
  version: 1,
  detect(task) {
    // G1: charge only when the abort survived as the resolved outcome.
    if (task.outcome?.kind !== 'aborted') return [];

    const abortSeq = task.abortedSeq;
    if (!Number.isInteger(abortSeq)) return []; // defensive: no observed abort position

    const candidates = [];
    for (const execution of task.executions) {
      // G2/G3: strictly-after-start requirement against the last abort signal.
      if (!Number.isInteger(execution.startedSeq) || execution.startedSeq <= abortSeq) continue;

      const units = [];
      for (const bucket of Object.values(execution.components)) {
        for (const component of bucket) {
          if (component.cost?.known === true) {
            units.push({ ref: component.ref, kind: component.kind, microUsd: component.cost.micro_usd });
          } else {
            units.push({ ref: component.ref, kind: component.kind, microUsd: 0, unquantified: true });
          }
        }
      }
      if (units.length === 0) continue; // G5

      candidates.push({
        evidenceUnits: units,
        explanation: (finalUnits) => {
          const quantified = finalUnits.filter((u) => !u.unquantified);
          const refs = finalUnits.map((u) => `"${u.ref}"`).join(', ');
          const base =
            `Task "${task.taskRef}" was aborted (objective disappeared), but execution "${execution.executionRef}" ` +
            `started only AFTER that abort signal in the observed event order, so its work demonstrably could not ` +
            `contribute to any accepted outcome of this task`;
          if (quantified.length === 0) {
            return (
              `${base}. Its components (${refs}) carried no priceable cost, so no measurable amount can be ` +
              `attributed, but the spend itself (recorded as unquantified evidence) was certainly avoidable.`
            );
          }
          const total = quantified.reduce((acc, u) => acc + u.microUsd, 0);
          const unquantified = finalUnits.length - quantified.length;
          return (
            `${base}. Measured cost of its components (${refs}) totaling ${formatUsd(total)} was certainly avoidable` +
            (unquantified > 0
              ? `; ${unquantified} further component(s) carried unpriceable cost and are listed as unquantified evidence`
              : '') +
            '.'
          );
        },
        recommendation:
          `Propagate task cancellation to running agents and stop scheduling new executions once the objective ` +
          `disappears, so no compute starts after an abort as it did on "${execution.executionRef}".`,
      });
    }
    return candidates;
  },
});
