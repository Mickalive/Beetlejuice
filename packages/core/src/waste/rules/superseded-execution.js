/**
 * WASTE_EXEC_SUPERSEDED_V1 — superseded / abandoned execution cost.
 *
 * Certain when: an execution within a task explicitly ends `superseded` with a
 * valid reference to a strictly later replacement execution (validated at
 * reconstruction). The replaced work product can no longer contribute to the
 * accepted outcome — the task itself chose a replacement — so the superseded
 * execution's component costs are demonstrably avoidable spend.
 *
 * Note: components attached to the superseded execution may partially overlap
 * with other rules' findings (e.g. a duplicated CI run inside it). The engine
 * strips already-claimed units so totals never double count.
 */
import { formatUsd } from '../../money.js';

export const RULE_EXEC_SUPERSEDED = Object.freeze({
  id: 'WASTE_EXEC_SUPERSEDED_V1',
  version: 1,
  detect(task) {
    const candidates = [];
    for (const execution of task.executions) {
      if (execution.status !== 'superseded' || !execution.supersededBy) continue;

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
      if (units.length === 0) continue;

      candidates.push({
        evidenceUnits: units,
        explanation: (finalUnits) => {
          const total = finalUnits.reduce((acc, u) => acc + u.microUsd, 0);
          const refs = finalUnits.map((u) => `"${u.ref}"`).join(', ');
          return (
            `Execution "${execution.executionRef}" in task "${task.taskRef}" was superseded by later execution ` +
            `"${execution.supersededBy}", so its work product cannot contribute to the task outcome. Measured cost of ` +
            `its components (${refs}) totaling ${formatUsd(total)} was certainly avoidable.`
          );
        },
        recommendation: `Prevent re-doing superseded objectives: cancel or checkpoint superseded executions like "${execution.executionRef}" before their replacement starts.`,
      });
    }
    return candidates;
  },
});
