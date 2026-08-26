/**
 * WASTE_DUP_CI_V1 — duplicated CI / check execution.
 *
 * Certain when: two or more CI runs inside one task share BOTH
 * - the adapter-provided `equivalence_key` (identical revision + configuration), AND
 * - the same `revision_key` partition (repair R3),
 * and a later run STARTED AFTER an earlier same-partition run had already
 * FINISHED with `passed`. Identical inputs cannot produce a different decision,
 * so every post-pass repeat is provably avoidable.
 *
 * Rule-boundary guards (certainty preconditions — abstain = no finding):
 * - G1: no `equivalence_key` -> never compared. Adapters SHOULD define
 *   `equivalence_key ≡ f(revision, config)`; the core defends the boundary
 *   even when an adapter keys on configuration alone (G6).
 * - G2 (repair R3): runs are only compared inside the same `revision_key`
 *   partition. Two runs whose revisions differ are NOT provably identical —
 *   keying equivalence by workflow name alone must never manufacture "certain"
 *   waste. Runs with an absent `revision_key` form their own conservative
 *   partition, are never mixed with revisioned runs, and never produce
 *   findings at all (G6).
 * - G3: runs that overlap in time are NOT flagged: the agent could not have
 *   known the first result yet — ambiguous evidence is never waste.
 * - G4: missing timing data makes the rule abstain rather than guess.
 * - G5 (repair X1): if ANY recorded run in a partition terminated with a
 *   status other than `passed`, the determinism premise is EMPIRICALLY FALSE
 *   for that partition — identical inputs demonstrably produced different
 *   decisions somewhere (or the inputs were not actually identical, meaning
 *   the equivalence key itself is untrustworthy). Under either reading the
 *   explanation "its result could not differ" cannot be defended, so the
 *   WHOLE partition abstains. This mirrors deterministic-retry guard G1/R1:
 *   observed disagreement poisons certainty for its entire group. It applies
 *   to post-pass repeats that failed/cancelled/timed out AND to earlier
 *   disagreements (e.g. failed -> passed flips on the same keys).
 * - G6 (repair TRUST-1): a partition whose `revision_key` is UNKNOWN (absent)
 *   can never produce a certain finding. Without observed revision identity,
 *   "identical inputs" is unprovable no matter how clean the statuses and
 *   timings look: an adapter keying equivalence on configuration alone would
 *   otherwise have cross-revision re-runs charged as duplicates (audit A-N2).
 *   The documented adapter contract (`equivalence_key ≡ f(revision, config)`)
 *   is therefore REQUIRED at the boundary: adapters must supply
 *   `revision_key` for duplicate-CI detection; unknown-revision partitions
 *   abstain instead of trusting an unverifiable key construction.
 */
import { formatUsd } from '../../money.js';

export const RULE_DUP_CI = Object.freeze({
  id: 'WASTE_DUP_CI_V1',
  version: 1,
  detect(task) {
    // groups: equivalence_key -> revision partition -> chronological runs
    const groups = new Map();
    for (const bucket of ciBuckets(task)) {
      for (const run of bucket) {
        const key = run.payload.equivalence_key;
        if (!key) continue; // G1: without a provable equivalence key we abstain
        if (!groups.has(key)) groups.set(key, new Map());
        const partitions = groups.get(key);
        const partition = run.payload.revision_key ?? null; // G2: null = unrevised/unknown
        if (!partitions.has(partition)) partitions.set(partition, []);
        partitions.get(partition).push(run);
      }
    }

    const candidates = [];
    for (const [key, partitions] of groups) {
      for (const [partition, runs] of partitions) {
        // G6 (TRUST-1): unknown revision identity => "identical inputs" is
        // unprovable; the partition abstains regardless of statuses/timings.
        if (partition === null) continue;
        const chronological = [...runs].sort((a, b) => a.seq - b.seq);
        // G5 (repair X1): any non-passed termination in the partition disproves
        // the "identical inputs cannot produce a different decision" premise.
        // A post-pass repeat that itself FAILED is the direct counterexample:
        // charging it as certain would contradict its own evidence. Abstain
        // for the whole partition — ambiguity never becomes waste here.
        if (!chronological.every((run) => run.payload.status === 'passed')) continue;
        let keptPass = null; // earliest passing run that finished in this partition
        for (const run of chronological) {
          if (keptPass && startsAfter(run, keptPass)) {
            const startIso = run.payload.started_at ?? '(unknown start)';
            candidates.push({
              evidenceUnits: [
                {
                  ref: run.ref,
                  kind: run.kind,
                  microUsd: run.cost?.known ? run.cost.micro_usd : 0,
                  ...(run.cost?.known ? {} : { unquantified: true }),
                },
              ],
              explanation: (units) =>
                `CI run "${run.ref}" started ${startIso} re-executed equivalence key "${key}" at unchanged revision ` +
                `"${partition}" after run "${keptPass.ref}" had already finished as passed on identical inputs at ` +
                `${keptPass.payload.finished_at}. Its result could not differ, so its measured cost ` +
                `${formatUsd(units[0].microUsd)} was certainly avoidable.`,
              recommendation: `Skip CI re-execution for unchanged equivalence key "${key}"; reuse the existing passed result.`,
            });
          }
          if (
            run.payload.status === 'passed' &&
            run.payload.finished_at &&
            (!keptPass || seqOf(run) < seqOf(keptPass))
          ) {
            keptPass = run;
          }
        }
      }
    }
    return candidates;
  },
});

function ciBuckets(task) {
  const buckets = [];
  for (const execution of task.executions) buckets.push(execution.components.ciRuns);
  buckets.push(task.unassignedComponents.ciRuns);
  return buckets;
}

function seqOf(componentRecord) {
  return componentRecord.seq;
}

function startsAfter(run, earlier) {
  const start = run.payload.started_at;
  const finish = earlier.payload.finished_at;
  if (!start || !finish) return false; // G4: missing timing -> ambiguous, abstain
  return Date.parse(start) >= Date.parse(finish);
}
