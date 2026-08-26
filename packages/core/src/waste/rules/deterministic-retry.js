/**
 * WASTE_DET_RETRY_V1 — identical retries after a classified deterministic failure.
 *
 * Certain when: model invocations share the adapter-provided
 * `attempt_equivalence_key` (provably identical inputs) and an earlier attempt
 * failed with a failure class from DETERMINISTIC_FAILURE_CLASSES, AND every
 * observed repeat after that premise reproduced the identical deterministic
 * failure class. Re-running identical input through a deterministic failure
 * path cannot succeed, so every blind repeat AFTER the first classified
 * deterministic failure whose own evidence confirms reproduction is charged.
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
 * - G4 (repair EPI-1): once the premise is established, any later attempt whose
 *   OWN outcome disagrees with it poisons certainty for the WHOLE group — the
 *   group abstains. A repeat failing with a different failure class (whether a
 *   transient class or a second "deterministic" one) is direct observable
 *   evidence that identical inputs do NOT reproduce identically under this
 *   key: either the inputs were not actually identical (the adapter's
 *   equivalence key is untrustworthy) or the classification premise is wrong.
 *   Under either reading "this retry could not succeed" is indefensible for
 *   every unit in the group, including earlier same-class repeats. This mirrors
 *   WASTE_DUP_CI_V1 guard G5: observed disagreement poisons its entire group.
 *   A missing failure_class on a post-premise error is treated as disagreement
 *   (reproduction unobservable => ambiguous); the event schema normally makes
 *   this unreachable by requiring `failure_class` on failed invocations.
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
      let poisoned = false; // G4: observed premise disagreement anywhere in the group
      const groupCandidates = [];
      for (const invocation of ordered) {
        const status = invocation.payload.status;
        const failureClass = invocation.payload.failure_class;
        const failedDeterministically =
          status === 'error' && DETERMINISTIC_FAILURE_CLASSES.includes(failureClass);
        if (!seenDeterministicFailure) {
          if (!failedDeterministically) continue; // no determinism premise yet
          // G2: the first classified deterministic failure is information,
          // not waste — but it establishes the premise for everything after.
          seenDeterministicFailure = true;
          firstDetRef = invocation.ref;
          firstDetClass = failureClass;
          continue;
        }
        // G4 (EPI-1): certainty survives only while every later attempt
        // REPRODUCES the established deterministic class. Any other observed
        // outcome — success (unreachable via G1), a different failure class,
        // or an unclassifiable error — is empirical disproof of "identical
        // inputs fail identically" for this group, so nothing in it stays
        // chargeable as certain.
        if (status !== 'error' || failureClass !== firstDetClass) {
          poisoned = true;
          break;
        }
        // The repeat reproduced the identical deterministic failure on
        // provably identical inputs: provably blind, provably doomed.
        const known = invocation.cost?.known === true;
        groupCandidates.push({
          evidenceUnits: [
            known
              ? { ref: invocation.ref, kind: invocation.kind, microUsd: invocation.cost.micro_usd }
              : { ref: invocation.ref, kind: invocation.kind, microUsd: 0, unquantified: true },
          ],
          explanation: (units) =>
            `Model invocation "${invocation.ref}" repeated equivalence key "${key}" after attempt "${firstDetRef}" had ` +
            `already failed with deterministic class "${firstDetClass}", and this retry reproduced the identical ` +
            `deterministic class. Deterministic failures reproduce identically, so this retry could not succeed ` +
            `and its measured cost ${formatUsd(units[0].microUsd)} was certainly avoidable.`,
          recommendation: `Fail fast on deterministic class "${firstDetClass}" instead of retrying identical attempt key "${key}".`,
        });
      }
      if (!poisoned) candidates.push(...groupCandidates);
    }
    return candidates;
  },
});

