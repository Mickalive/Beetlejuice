/**
 * AGENTIC_TASK reconstruction: project an ordered canonical event stream into
 * vendor-neutral task aggregates with conservative outcome attribution.
 *
 * Attribution is deliberately conservative (MASTER_PROMPT §8):
 * - `accepted` requires a positive merge signal; nothing else counts.
 * - `failed` / `aborted` require explicit terminal signals.
 * - Everything else stays `unresolved` and is reported as such — never guessed.
 * - Cost always rolls up per task; unresolved tasks keep their cost visible
 *   but are flagged `attribution: 'partial'`.
 */
import { EVENT_TYPES, deepFreeze } from './events.js';
import { ErrorCodes, schemaViolation } from './errors.js';

const COMPONENT_EVENT_TYPES = Object.freeze({
  [EVENT_TYPES.MODEL_INVOCATION_RECORDED]: { bucket: 'modelInvocations', kind: 'inference', refField: 'invocation_ref' },
  [EVENT_TYPES.TOOL_INVOCATION_RECORDED]: { bucket: 'toolInvocations', kind: 'tools', refField: 'tool_ref' },
  [EVENT_TYPES.COMPUTE_USAGE_RECORDED]: { bucket: 'computeUsage', kind: 'compute', refField: 'resource_ref' },
  [EVENT_TYPES.CI_RUN_RECORDED]: { bucket: 'ciRuns', kind: 'ci', refField: 'ci_ref' },
  [EVENT_TYPES.VALIDATION_RECORDED]: { bucket: 'validations', kind: 'validation', refField: 'validation_ref' },
  [EVENT_TYPES.HUMAN_INTERVENTION_RECORDED]: { bucket: 'humanInterventions', kind: 'human', refField: 'intervention_ref' },
});

function emptyComponents() {
  return {
    modelInvocations: [],
    toolInvocations: [],
    computeUsage: [],
    ciRuns: [],
    validations: [],
    humanInterventions: [],
  };
}

export function reconstructTasks(events) {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  const tasks = new Map();

  const taskFor = (ref) => {
    let t = tasks.get(ref);
    if (!t) {
      t = {
        state: null, // mutable build state; replaced by frozen aggregate below
        taskRef: ref,
      };
      tasks.set(ref, t);
    }
    return t;
  };

  for (const ev of ordered) {
    const t = taskFor(ev.task_ref);
    if (!t.state) initTaskState(t, ev);
    applyEvent(t, ev);
  }

  const aggregates = new Map();
  for (const [ref, t] of tasks) {
    aggregates.set(ref, finalizeTask(t));
  }
  return aggregates;
}

function initTaskState(t, firstEvent) {
  t.state = {
    startedSeq: null,
    taskClass: null,
    executions: new Map(),
    executionOrder: [],
    componentsByExecution: new Map(), // execution_ref -> components
    unassignedComponents: emptyComponents(),
    seenComponentRefs: new Set(),
    pullRequests: new Map(), // prRef -> { created, closed, merged, seqs:{} }
    retries: [],
    reworks: [],
    reverts: [],
    failedSignal: null,
    abortedSignal: null,
    lastSeq: firstEvent.seq,
    lastTime: firstEvent.time ?? null,
    eventCount: 0,
    sources: new Set(),
  };
}

function componentsFor(t, executionRef) {
  if (!executionRef) return t.state.unassignedComponents;
  let c = t.state.componentsByExecution.get(executionRef);
  if (!c) {
    c = emptyComponents();
    t.state.componentsByExecution.set(executionRef, c);
  }
  return c;
}

function ensureExecution(t, executionRef, ev, { isStart = false } = {}) {
  let e = t.state.executions.get(executionRef);
  if (!e) {
    e = {
      executionRef,
      revisionKey: null,
      status: 'running',
      failureClass: null,
      supersededBy: null,
      startedSeq: ev.seq,
      finishedSeq: null,
      startedExplicitly: false,
    };
    t.state.executions.set(executionRef, e);
    t.state.executionOrder.push(executionRef);
  }
  if (isStart) {
    // The explicit start event defines the true start position even if the
    // execution object was created earlier by a finishing event.
    e.startedSeq = ev.seq;
    e.startedExplicitly = true;
    if (!e.revisionKey) e.revisionKey = ev.payload.revision_key ?? null;
  }
  return e;
}

function registerComponent(t, executionRef, ev, meta) {
  const ref = ev.payload[meta.refField];
  if (t.state.seenComponentRefs.has(ref)) {
    throw schemaViolation(
      ErrorCodes.DUPLICATE_COMPONENT_REF,
      `duplicate component ref "${ref}" within task "${t.taskRef}"`,
      { taskRef: t.taskRef, ref }
    );
  }
  t.state.seenComponentRefs.add(ref);
  const record = deepFreeze({
    ref,
    kind: meta.kind,
    seq: ev.seq,
    cost: ev.payload.cost ?? { known: false, reason: 'component type without measured cost' },
    payload: ev.payload,
  });
  componentsFor(t, executionRef)[meta.bucket].push(record);
}

function applyEvent(t, ev) {
  const s = t.state;
  s.eventCount += 1;
  s.lastSeq = ev.seq;
  if (ev.time) s.lastTime = ev.time;
  if (ev.source?.adapter) s.sources.add(ev.source.adapter);

  switch (ev.type) {
    case EVENT_TYPES.TASK_STARTED:
      s.startedSeq = ev.seq;
      break;

    case EVENT_TYPES.EXECUTION_STARTED: {
      const e = ensureExecution(t, ev.payload.execution_ref, ev, { isStart: true });
      e.revisionKey = e.revisionKey ?? ev.payload.revision_key ?? null;
      break;
    }

    case EVENT_TYPES.EXECUTION_FINISHED: {
      const e = ensureExecution(t, ev.payload.execution_ref, ev);
      e.status = ev.payload.status;
      e.failureClass = ev.payload.failure_class ?? null;
      e.finishedSeq = ev.seq;
      // Cross-execution supersession integrity is proven once the whole task
      // stream is known (finalizeTask) so adapter delivery order cannot
      // manufacture or break evidence.
      if (ev.payload.status === 'superseded') {
        e.supersededBy = ev.payload.superseded_by_execution_ref;
      }
      break;
    }

    case EVENT_TYPES.MODEL_INVOCATION_RECORDED:
    case EVENT_TYPES.TOOL_INVOCATION_RECORDED:
    case EVENT_TYPES.COMPUTE_USAGE_RECORDED:
    case EVENT_TYPES.CI_RUN_RECORDED:
    case EVENT_TYPES.VALIDATION_RECORDED:
    case EVENT_TYPES.HUMAN_INTERVENTION_RECORDED:
      registerComponent(t, ev.execution_ref, ev, COMPONENT_EVENT_TYPES[ev.type]);
      break;

    case EVENT_TYPES.RETRY_RECORDED:
      s.retries.push({ seq: ev.seq, retryOfRef: ev.payload.retry_of_ref ?? null });
      break;

    case EVENT_TYPES.PULL_REQUEST_CREATED:
    case EVENT_TYPES.PULL_REQUEST_CLOSED:
    case EVENT_TYPES.PULL_REQUEST_MERGED: {
      const prRef = ev.payload.pr_ref;
      let pr = s.pullRequests.get(prRef);
      if (!pr) {
        pr = { prRef, created: false, closed: false, merged: false, createdSeq: null, closedSeq: null, mergedSeq: null };
        s.pullRequests.set(prRef, pr);
      }
      if (ev.type === EVENT_TYPES.PULL_REQUEST_CREATED) { pr.created = true; pr.createdSeq = ev.seq; }
      if (ev.type === EVENT_TYPES.PULL_REQUEST_CLOSED) { pr.closed = true; pr.closedSeq = ev.seq; }
      if (ev.type === EVENT_TYPES.PULL_REQUEST_MERGED) { pr.merged = true; pr.mergedSeq = ev.seq; }
      break;
    }

    case EVENT_TYPES.REVERT_DETECTED:
      s.reverts.push({ prRef: ev.payload.pr_ref, seq: ev.seq, time: ev.time });
      break;

    case EVENT_TYPES.HUMAN_REWORK_RECORDED:
      s.reworks.push({ reworkRef: ev.payload.rework_ref, seq: ev.seq });
      break;

    case EVENT_TYPES.TASK_FAILED:
      s.failedSignal = { seq: ev.seq };
      break;

    case EVENT_TYPES.TASK_ABORTED:
      s.abortedSignal = { seq: ev.seq };
      break;

    default:
      break;
  }
}

// Conservative outcome resolution. Priority: merged > task_failed >
// closed-without-merge > aborted > unresolved.
function resolveOutcome(s) {
  const mergedPrRefs = [...s.pullRequests.values()].filter((p) => p.merged).map((p) => p.prRef).sort();
  if (mergedPrRefs.length > 0) {
    return {
      kind: 'accepted',
      attribution: 'measured',
      detail: `merged pull request evidence: ${mergedPrRefs.join(', ')}`,
      mergedPrRefs,
      reverted: false,
    };
  }
  if (s.failedSignal) {
    return { kind: 'failed', attribution: 'measured', detail: 'task_failed signal observed', mergedPrRefs: [], reverted: false };
  }
  const closedUnmerged = [...s.pullRequests.values()].find((p) => p.closed && !p.merged);
  if (closedUnmerged) {
    return {
      kind: 'failed',
      attribution: 'measured',
      detail: `pull request ${closedUnmerged.prRef} closed without merge`,
      mergedPrRefs: [],
      reverted: false,
    };
  }
  if (s.abortedSignal) {
    return { kind: 'aborted', attribution: 'measured', detail: 'task_aborted signal observed', mergedPrRefs: [], reverted: false };
  }
  return {
    kind: 'unresolved',
    attribution: 'partial',
    detail: 'no terminal outcome signal in observed evidence',
    mergedPrRefs: [],
    reverted: false,
  };
}

function finalizeTask(t) {
  const s = t.state;

  // Execution lifecycle integrity:
  // - terminal executions must have been explicitly started;
  // - superseded_by must reference a known execution that started strictly later.
  for (const e of s.executions.values()) {
    if (e.status !== 'running' && !e.startedExplicitly) {
      throw schemaViolation(
        ErrorCodes.BAD_EXECUTION_LIFECYCLE,
        `execution "${e.executionRef}" in task "${t.taskRef}" finished without an explicit start event`,
        { taskRef: t.taskRef, ref: e.executionRef }
      );
    }
  }
  for (const e of s.executions.values()) {
    if (e.status !== 'superseded') continue;
    const target = s.executions.get(e.supersededBy);
    if (!target) {
      throw schemaViolation(
        ErrorCodes.UNKNOWN_EXECUTION_REF,
        `superseded_by references unknown execution "${e.supersededBy}" in task "${t.taskRef}"`,
        { taskRef: t.taskRef, ref: e.supersededBy }
      );
    }
    if (target.startedSeq <= e.startedSeq) {
      throw schemaViolation(
        ErrorCodes.BAD_SUPERSESSION,
        `supersession must point at a strictly later execution in task "${t.taskRef}"`,
        { taskRef: t.taskRef, by: target.executionRef }
      );
    }
  }

  const outcomeBase = resolveOutcome(s);

  // Revert flag: any revert_detected attached to one of the merged PR refs.
  const mergedSet = new Set(outcomeBase.mergedPrRefs);
  const reverted = outcomeBase.kind === 'accepted' && s.reverts.some((r) => mergedSet.has(r.prRef));
  const outcome = deepFreeze({ ...outcomeBase, reverted });

  const executions = s.executionOrder.map((ref) => {
    const e = s.executions.get(ref);
    return deepFreeze({
      executionRef: e.executionRef,
      revisionKey: e.revisionKey,
      status: e.status,
      failureClass: e.failureClass,
      supersededBy: e.supersededBy,
      startedSeq: e.startedSeq,
      finishedSeq: e.finishedSeq,
      components: s.componentsByExecution.get(ref) ?? emptyComponents(),
    });
  });

  // Components delivered under an execution ref that never announced itself
  // stay visible at task level — money is never dropped from the books.
  const unassigned = s.unassignedComponents;
  for (const [ref, components] of s.componentsByExecution) {
    if (s.executions.has(ref)) continue;
    for (const bucketKey of Object.keys(components)) {
      unassigned[bucketKey].push(...components[bucketKey]);
    }
  }

  const aggregate = {
    taskRef: t.taskRef,
    startedSeq: s.startedSeq,
    lastSeq: s.lastSeq,
    // Position of the LAST observed task_aborted signal in the ledger total
    // order, or null when the task was never aborted OR the abort position is
    // unobservable (e.g. reconstruction over unstamped events). Exposed so
    // certain-waste rules can prove "this work started after the objective
    // disappeared" without re-deriving reconstruction state.
    abortedSeq: Number.isInteger(s.abortedSignal?.seq) ? s.abortedSignal.seq : null,
    lastTime: s.lastTime,
    eventCount: s.eventCount,
    adapters: [...s.sources].sort(),
    executions,
    unassignedComponents: unassigned,
    pullRequests: [...s.pullRequests.values()].sort((a, b) => (a.createdSeq ?? a.closedSeq ?? 0) - (b.createdSeq ?? b.closedSeq ?? 0)),
    retries: s.retries.length,
    humanReworkEvents: s.reworks.length,
    revertSignals: s.reverts.length,
    outcome,
  };
  return deepFreeze(aggregate);
}
