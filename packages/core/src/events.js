/**
 * Canonical, vendor-neutral event schema for AGENTIC_TASK economics.
 *
 * Design rules (WC-001 / MASTER_PROMPT §7-§8):
 * - The domain is the task, never `github_action_run`. GitHub-specific values
 *   may only appear inside `source` adapter metadata; no domain key requires
 *   them.
 * - Every stored event is stamped with the four version fields.
 * - Cost is integer micro-USD and either measured (`known: true`) or honestly
 *   unknown (`known: false`) — never guessed.
 *
 * Events are appended to a tenant-scoped ledger (see analytics/tenant.js)
 * which assigns a strictly monotonic `seq`. Reconstruction order is seq
 * order, so ingestion is deterministic and reproducible.
 *
 * PINNED CONTRACT (eventSchemaVersion '1'): packages/github mirrors this
 * exact vocabulary in its adapter-side conformance check. Any change here
 * must land in the core first and be mirrored by adapters afterwards.
 */
import { VERSIONS, eventVersionFor } from './versions.js';
import { ErrorCodes, schemaViolation } from './errors.js';
import { MICROS_PER_USD } from './money.js';

/** Outcome lifecycle events required by MASTER_PROMPT §8 (vendor naming). */
export const EVENT_TYPES = Object.freeze({
  // Task lifecycle
  TASK_STARTED: 'task_started',
  TASK_FAILED: 'task_failed',
  TASK_ABORTED: 'task_aborted',

  // Execution lifecycle (one task has >=0 executions)
  EXECUTION_STARTED: 'execution_started',
  EXECUTION_FINISHED: 'execution_finished',

  // Cost-bearing components
  MODEL_INVOCATION_RECORDED: 'model_invocation_recorded',
  TOOL_INVOCATION_RECORDED: 'tool_invocation_recorded',
  COMPUTE_USAGE_RECORDED: 'compute_usage_recorded',
  CI_RUN_RECORDED: 'ci_run_recorded',
  VALIDATION_RECORDED: 'validation_recorded',
  HUMAN_INTERVENTION_RECORDED: 'human_intervention_recorded',

  // Control flow
  RETRY_RECORDED: 'retry_recorded',

  // Delivery + outcome signals
  PULL_REQUEST_CREATED: 'pull_request_created',
  PULL_REQUEST_CLOSED: 'pull_request_closed',
  PULL_REQUEST_MERGED: 'pull_request_merged',
  REVERT_DETECTED: 'revert_detected',
  HUMAN_REWORK_RECORDED: 'human_rework_recorded',
});

export const CANONICAL_EVENT_TYPES = Object.freeze(Object.values(EVENT_TYPES));

/** Failure classes that provably reproduce on identical retry input. */
export const DETERMINISTIC_FAILURE_CLASSES = Object.freeze([
  'auth_error',
  'permission_denied',
  'invalid_request',
  'billing_error',
]);

export const EXECUTION_STATUSES = Object.freeze(['completed', 'failed', 'aborted', 'superseded']);
export const CI_RUN_STATUSES = Object.freeze(['passed', 'failed', 'cancelled', 'timed_out']);
export const VALIDATION_STATUSES = Object.freeze(['passed', 'failed', 'skipped']);
export const INVOCATION_STATUSES = Object.freeze(['ok', 'error']);

const ISO_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// ---------------------------------------------------------------------------
// Payload field specs
// ---------------------------------------------------------------------------
// Field kinds: 'string' (non-empty), 'int>=0', 'iso' (ISO-8601 string),
// 'boolean', ['enum', ...values], 'cost', 'object' (plain JSON object).
const costSpec = { kind: 'cost', required: true };
const refSpec = (name) => ({ kind: 'string', required: true, note: name });

const PAYLOAD_SPECS = {
  [EVENT_TYPES.TASK_STARTED]: {},
  [EVENT_TYPES.TASK_FAILED]: {},
  [EVENT_TYPES.TASK_ABORTED]: {},

  [EVENT_TYPES.EXECUTION_STARTED]: {
    execution_ref: refSpec('execution_ref'),
    revision_key: { kind: 'string', required: false },
  },
  [EVENT_TYPES.EXECUTION_FINISHED]: {
    execution_ref: refSpec('execution_ref'),
    status: { kind: 'enum', values: EXECUTION_STATUSES, required: true },
    failure_class: { kind: 'string', required: false },
    superseded_by_execution_ref: { kind: 'string', required: false },
  },

  [EVENT_TYPES.MODEL_INVOCATION_RECORDED]: {
    invocation_ref: refSpec('invocation_ref'),
    status: { kind: 'enum', values: INVOCATION_STATUSES, required: true },
    cost: costSpec,
    model_class: { kind: 'string', required: false },
    failure_class: { kind: 'string', required: false },
    attempt_equivalence_key: { kind: 'string', required: false },
    tokens_in: { kind: 'int>=0', required: false },
    tokens_out: { kind: 'int>=0', required: false },
    latency_ms: { kind: 'int>=0', required: false },
  },
  [EVENT_TYPES.TOOL_INVOCATION_RECORDED]: {
    tool_ref: refSpec('tool_ref'),
    status: { kind: 'enum', values: INVOCATION_STATUSES, required: true },
    cost: costSpec,
    tool_class: { kind: 'string', required: false },
    latency_ms: { kind: 'int>=0', required: false },
  },
  [EVENT_TYPES.COMPUTE_USAGE_RECORDED]: {
    resource_ref: refSpec('resource_ref'),
    cost: costSpec,
    resource_class: { kind: 'string', required: false },
  },
  [EVENT_TYPES.CI_RUN_RECORDED]: {
    ci_ref: refSpec('ci_ref'),
    status: { kind: 'enum', values: CI_RUN_STATUSES, required: true },
    cost: costSpec,
    equivalence_key: { kind: 'string', required: false },
    revision_key: { kind: 'string', required: false },
    started_at: { kind: 'iso', required: false },
    finished_at: { kind: 'iso', required: false },
    duration_ms: { kind: 'int>=0', required: false },
  },
  [EVENT_TYPES.VALIDATION_RECORDED]: {
    validation_ref: refSpec('validation_ref'),
    status: { kind: 'enum', values: VALIDATION_STATUSES, required: true },
    cost: { kind: 'cost', required: false },
    validation_class: { kind: 'string', required: false },
  },
  [EVENT_TYPES.HUMAN_INTERVENTION_RECORDED]: {
    intervention_ref: refSpec('intervention_ref'),
    cost: { kind: 'cost', required: false },
    intervention_class: { kind: 'string', required: false },
  },

  [EVENT_TYPES.RETRY_RECORDED]: {
    retry_of_ref: { kind: 'string', required: false },
  },

  [EVENT_TYPES.PULL_REQUEST_CREATED]: { pr_ref: refSpec('pr_ref') },
  [EVENT_TYPES.PULL_REQUEST_CLOSED]: { pr_ref: refSpec('pr_ref') },
  [EVENT_TYPES.PULL_REQUEST_MERGED]: { pr_ref: refSpec('pr_ref') },
  [EVENT_TYPES.REVERT_DETECTED]: { pr_ref: refSpec('pr_ref') },
  [EVENT_TYPES.HUMAN_REWORK_RECORDED]: { rework_ref: refSpec('rework_ref') },
};

const ALLOWED_TOP_LEVEL_KEYS = Object.freeze([
  'type',
  'payload',
  'time',
  'task_ref',
  'execution_ref',
  'event_id',
  'source',
]);

function fail(code, message, details) {
  throw schemaViolation(code, message, details);
}

function checkString(value, field, ctx) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(ErrorCodes.BAD_FIELD_TYPE, `${ctx}: field "${field}" must be a non-empty string`, { field, value });
  }
}

function checkIntNonNeg(value, field, ctx) {
  if (!Number.isInteger(value) || value < 0) {
    fail(ErrorCodes.BAD_FIELD_TYPE, `${ctx}: field "${field}" must be a non-negative integer`, { field, value });
  }
}

function checkIso(value, field, ctx) {
  if (typeof value !== 'string' || !ISO_REGEX.test(value)) {
    fail(ErrorCodes.BAD_FIELD_TYPE, `${ctx}: field "${field}" must be an ISO-8601 timestamp string`, { field, value });
  }
}

function checkCost(value, field, ctx) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(ErrorCodes.BAD_FIELD_TYPE, `${ctx}: field "${field}" must be a cost object`, { field });
  }
  const keys = Object.keys(value).sort();
  if (value.known === true) {
    if (keys.join(',') !== 'known,micro_usd') {
      fail(ErrorCodes.BAD_FIELD_TYPE, `${ctx}: known cost must be exactly { known: true, micro_usd }`, { field, keys });
    }
    checkIntNonNeg(value.micro_usd, `${field}.micro_usd`, ctx);
    if (value.micro_usd > Number.MAX_SAFE_INTEGER) {
      fail(ErrorCodes.BAD_FIELD_TYPE, `${ctx}: ${field}.micro_usd exceeds safe integer range`, { field });
    }
  } else if (value.known === false) {
    const allowed = ['known', 'reason'].sort().join(',');
    if (keys.join(',') !== allowed && keys.join(',') !== 'known') {
      fail(ErrorCodes.BAD_FIELD_TYPE, `${ctx}: unknown cost must be { known: false, reason? }`, { field, keys });
    }
    if ('reason' in value) checkString(value.reason, `${field}.reason`, ctx);
  } else {
    fail(ErrorCodes.BAD_FIELD_TYPE, `${ctx}: ${field}.known must be boolean true or false`, { field });
  }
}

function checkPayloadField(spec, value, field, ctx) {
  switch (spec.kind) {
    case 'string': checkString(value, field, ctx); break;
    case 'int>=0': checkIntNonNeg(value, field, ctx); break;
    case 'iso': checkIso(value, field, ctx); break;
    case 'boolean':
      if (typeof value !== 'boolean') fail(ErrorCodes.BAD_FIELD_TYPE, `${ctx}: "${field}" must be boolean`, { field });
      break;
    case 'enum':
      if (!spec.values.includes(value)) {
        fail(ErrorCodes.BAD_FIELD_TYPE, `${ctx}: "${field}" must be one of [${spec.values.join(', ')}]`, { field, value });
      }
      break;
    case 'cost': checkCost(value, field, ctx); break;
    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        fail(ErrorCodes.BAD_FIELD_TYPE, `${ctx}: "${field}" must be a plain object`, { field });
      }
      break;
    default:
      fail(ErrorCodes.BAD_FIELD_TYPE, `${ctx}: unsupported spec kind "${spec.kind}"`, { field });
  }
}

function validatePayload(type, payload, ctx) {
  const spec = PAYLOAD_SPECS[type];
  for (const [field, fieldSpec] of Object.entries(spec)) {
    if (fieldSpec.required && !(field in payload)) {
      fail(ErrorCodes.MISSING_FIELD, `${ctx}: event type "${type}" requires payload field "${field}"`, { type, field });
    }
  }
  for (const [field, value] of Object.entries(payload)) {
    const fieldSpec = spec[field];
    if (!fieldSpec) {
      fail(ErrorCodes.FORBIDDEN_FIELD, `${ctx}: event type "${type}" does not allow payload field "${field}"`, { type, field });
    }
    if (value === undefined) continue;
    checkPayloadField(fieldSpec, value, field, ctx);
  }
  // Conditional cross-field rules.
  if (type === EVENT_TYPES.EXECUTION_FINISHED) {
    if (payload.status === 'superseded' && !payload.superseded_by_execution_ref) {
      fail(ErrorCodes.MISSING_FIELD, `${ctx}: superseded execution_finished requires "superseded_by_execution_ref"`, {});
    }
    if (payload.status !== 'superseded' && 'superseded_by_execution_ref' in payload) {
      fail(ErrorCodes.FORBIDDEN_FIELD, `${ctx}: "superseded_by_execution_ref" is only allowed when status is "superseded"`, {});
    }
  }
  if (type === EVENT_TYPES.MODEL_INVOCATION_RECORDED) {
    if (payload.status === 'error' && !payload.failure_class) {
      fail(ErrorCodes.MISSING_FIELD, `${ctx}: failed model invocation requires "failure_class" classification`, {});
    }
  }
}

/**
 * Validate one raw adapter event and return it normalized + frozen with the
 * full version envelope. `seq`/`eventId` assignment is done by the caller
 * (the tenant ledger) via the second argument.
 */
export function normalizeEvent(raw, { seq, eventId } = {}) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail(ErrorCodes.BAD_FIELD_TYPE, 'event must be a JSON object', {});
  }
  const ctx = raw.event_id ? `event ${raw.event_id}` : `event #${seq ?? '?'}`;

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.includes(key)) {
      fail(ErrorCodes.FORBIDDEN_FIELD, `${ctx}: unknown top-level field "${key}"`, { key });
    }
  }
  if (typeof raw.type !== 'string' || !CANONICAL_EVENT_TYPES.includes(raw.type)) {
    fail(ErrorCodes.UNKNOWN_EVENT_TYPE, `${ctx}: unknown event type ${JSON.stringify(raw.type)}`, { type: raw.type });
  }
  if (typeof raw.payload !== 'object' || raw.payload === null || Array.isArray(raw.payload)) {
    fail(ErrorCodes.MISSING_FIELD, `${ctx}: missing payload object`, {});
  }
  checkString(raw.task_ref, 'task_ref', ctx);
  if (raw.time !== undefined && raw.time !== null) checkIso(raw.time, 'time', ctx);
  if (raw.execution_ref !== undefined) checkString(raw.execution_ref, 'execution_ref', ctx);

  let source = undefined;
  if (raw.source !== undefined) {
    if (typeof raw.source !== 'object' || raw.source === null || Array.isArray(raw.source)) {
      fail(ErrorCodes.BAD_FIELD_TYPE, `${ctx}: "source" must be an object`, {});
    }
    for (const key of Object.keys(raw.source)) {
      if (!['adapter', 'ref', 'meta'].includes(key)) {
        fail(ErrorCodes.FORBIDDEN_FIELD, `${ctx}: source allows only adapter/ref/meta, got "${key}"`, { key });
      }
    }
    checkString(raw.source.adapter, 'source.adapter', ctx);
    if (raw.source.ref !== undefined) checkString(raw.source.ref, 'source.ref', ctx);
    if (raw.source.meta !== undefined) {
      try {
        JSON.stringify(raw.source.meta);
      } catch {
        fail(ErrorCodes.BAD_FIELD_TYPE, `${ctx}: source.meta must be JSON-serializable`, {});
      }
    }
    source = {
      adapter: raw.source.adapter,
      ...(raw.source.ref !== undefined ? { ref: raw.source.ref } : {}),
      ...(raw.source.meta !== undefined ? { meta: raw.source.meta } : {}),
    };
  }

  validatePayload(raw.type, raw.payload, ctx);

  const event = {
    event_id: typeof raw.event_id === 'string' && raw.event_id.length > 0 ? raw.event_id : eventId,
    seq,
    type: raw.type,
    time: raw.time ?? null,
    task_ref: raw.task_ref,
    execution_ref: raw.execution_ref ?? null,
    schema_version: VERSIONS.eventSchemaVersion,
    event_version: eventVersionFor(raw.type),
    collector_version: VERSIONS.collectorVersion,
    normalization_version: VERSIONS.normalizationVersion,
    source: source ?? null,
    payload: deepFreeze(cloneJson(raw.payload)),
  };
  return deepFreeze(event);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

/** True when the payload carries a measurable cost. */
export function isKnownCost(cost) {
  return typeof cost === 'object' && cost !== null && cost.known === true;
}

/** Extract micro-USD from a cost object; returns null when unknown. */
export function costMicroUsd(cost) {
  return isKnownCost(cost) ? cost.micro_usd : null;
}

export { MICROS_PER_USD };
