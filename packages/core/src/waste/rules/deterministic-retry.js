/**
 * WASTE_DET_RETRY_V1 — identical retries after a classified deterministic failure.
 *
 * Certain when: model invocations share the adapter-provided
 * `attempt_equivalence_key` (provably identical inputs) and an earlier attempt
 * failed with a failure class from DETERMINISTIC_FAILURE_CLASSES. Re-running
 * identical input through a deterministic failure path cannot succeed, so every
 * blind repeat AFTER the first classified deterministic failure is charged.
 *
 * Rule-boundary guards (certainty preconditions — abstain = no finding):
 * - G1 (repair R1): if ANY attempt under the equivalence key succeeded
 *   (`status: 'ok'`), the determinism premise is empirically false for that
 *   key — the evidence contradicts itself, so the whole group is ambiguous and
 *   NOTHING is charged for it. A successful attempt is never waste, and its
 *   existence poisons certainty for every other attempt in the group.
 * - G2: the FIRST failing attempt is never charged — discovering the failure
 *   has informational value; only blind repeats are certain waste.
 * - G3: attempts without a provable equivalence key are never compared.
 */
import { DETERMINISTIC_FAILURE_CLASSES } from '../../events.js';
import { formatUsd } from '../../money.js';

export const RULE_DET_RETRY = Object.freeze({
  id: 'WASTE_DET_RETRY_V1',
  version: 1,
  detect(task) {
    const attemptsByTask = [];
    for (const execution of task.executions) {
      attemptsByTask.push(...execution.components.modelInvocations);
    }
    attemptsByTask.push(...task.unassignedComponents.modelInvocations);

    const groups = new Map();
    for (const invocation of attemptsByTask) {
      const key = invocation.payload.attempt_equivalence_key;
      if (!key) continue; // G3: no provable attempt equivalence -> abstain
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(invocation);
    }

    const candidates = [];
    for (const [key, invocations] of groups) {
      const ordered = [...invocations].sort((a, b) => a.seq - b.seq);

      // G1 (R1): one success disproves determinism for the entire key.
      if (ordered.some((invocation) => invocation.payload.status === 'ok')) continue;

      let seenDeterministicFailure = false;
      let firstDetRef = null;
      let firstDetClass = null;
      for (const invocation of ordered) {
        const failedDeterministically =
          invocation.payload.status === 'error' &&
          DETERMINISTIC_FAILURE_CLASSES.includes(invocation.payload.failure_class);
        if (!seenDeterministicFailure) {
          if (!failedDeterministically) continue; // no determinism premise yet
          // G2: the first classified deterministic failure is information,
          // not waste — but it establishes the premise for everything after.
          seenDeterministicFailure = true;
          firstDetRef = invocation.ref;
          firstDetClass = invocation.payload.failure_class;
          continue;
        }
        // Every later attempt on identical inputs is a provably blind repeat,
        // whatever its own failure class turned out to be.
        const known = invocation.cost?.known === true;
        candidates.push({
          evidenceUnits: [
            known
              ? { ref: invocation.ref, kind: invocation.kind, microUsd: invocation.cost.micro_usd }
              : { ref: invocation.ref, kind: invocation.kind, microUsd: 0, unquantified: true },
          ],
          explanation: (units) =>
            `Model invocation "${invocation.ref}" repeated equivalence key "${key}" after attempt "${firstDetRef}" had ` +
            `already failed with deterministic class "${firstDetClass}". Deterministic ` +
            `failures reproduce identically, so this retry could not succeed and its measured cost ${formatUsd(
              units[0].microUsd
            )} was certainly avoidable.`,
          recommendation: `Fail fast on deterministic class "${firstDetClass}" instead of retrying identical attempt key "${key}".`,
        });
      }
    }
    return candidates;
  },
});

