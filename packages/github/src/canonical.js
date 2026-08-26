/**
 * Canonical-event conformance boundary for the GitHub adapter.
 *
 * The adapter emits RAW canonical events that the core tenant ledger
 * (`TenantLedger.append` -> `normalizeEvent`, packages/core, event schema
 * version 1) validates, stamps with the four version fields and freezes.
 * This module mirrors that ingest contract for exactly the event types this
 * adapter emits, so every event is validated here too — adapter-side
 * failures are caught in fixture tests instead of at integration time.
 *
 * Pinned contract: packages/core/src/events.js @ eventSchemaVersion '1'
 * (allowed top-level keys; payload field specs; cost object shape; enums).
 * DO NOT extend the vocabulary here independently of the core: change the
 * core first, then mirror it (WC-002: never redesign the canonical model).
 */
import { EMITTED_EVENT_TYPES, ADAPTER_ID as ADAPTER, COLLECTOR_VERSION } from './versions.js';
import { GithubAdapterError, AdapterErrorCodes } from './errors.js';

const ALLOWED_TOP_LEVEL_KEYS = Object.freeze([
  'type',
  'payload',
  'time',
  'task_ref',
  'execution_ref',
  'event_id',
  'source',
]);

const EXECUTION_STATUSES = Object.freeze(['completed', 'failed', 'aborted', 'superseded']);
const CI_RUN_STATUSES = Object.freeze(['passed', 'failed', 'cancelled', 'timed_out']);
const VALIDATION_STATUSES = Object.freeze(['passed', 'failed', 'skipped']);

const ISO_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const PAYLOAD_SPECS = {
  task_started: {},
  execution_started: {
    execution_ref: { kind: 'string', required: true },
    revision_key: { kind: 'string', required: false },
  },
  execution_finished: {
    execution_ref: { kind: 'string', required: true },
    status: { kind: 'enum', values: EXECUTION_STATUSES, required: true },
    failure_class: { kind: 'string', required: false },
    superseded_by_execution_ref: { kind: 'string', required: false },
  },
  ci_run_recorded: {
    ci_ref: { kind: 'string', required: true },
    status: { kind: 'enum', values: CI_RUN_STATUSES, required: true },
    cost: { kind: 'cost', required: true },
    equivalence_key: { kind: 'string', required: false },
    revision_key: { kind: 'string', required: false },
    started_at: { kind: 'iso', required: false },
    finished_at: { kind: 'iso', required: false },
    duration_ms: { kind: 'int>=0', required: false },
  },
  validation_recorded: {
    validation_ref: { kind: 'string', required: true },
    status: { kind: 'enum', values: VALIDATION_STATUSES, required: true },
    cost: { kind: 'cost', required: false },
    validation_class: { kind: 'string', required: false },
  },
  pull_request_created: { pr_ref: { kind: 'string', required: true } },
  pull_request_closed: { pr_ref: { kind: 'string', required: true } },
  pull_request_merged: { pr_ref: { kind: 'string', required: true } },
};

function bad(message, details) {
  throw new GithubAdapterError(AdapterErrorCodes.BAD_EVIDENCE, message, details);
}

function checkString(value, field) {
  if (typeof value !== 'string' || value.length === 0) bad(`field "${field}" must be a non-empty string`, { field });
}

function checkIso(value, field) {
  if (typeof value !== 'string' || !ISO_REGEX.test(value)) {
    bad(`field "${field}" must be an ISO-8601 timestamp string`, { field });
  }
}

function checkCost(value, field) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    bad(`field "${field}" must be a cost object`, { field });
  }
  const keys = Object.keys(value).sort();
  if (value.known === true) {
    if (keys.join(',') !== 'known,micro_usd') bad(`known cost must be exactly { known: true, micro_usd }`, { field });
    const v = value.micro_usd;
    if (!Number.isInteger(v) || v < 0 || v > Number.MAX_SAFE_INTEGER) {
      bad(`${field}.micro_usd must be a non-negative safe integer`, { field });
    }
  } else if (value.known === false) {
    const allowed = ['known', 'reason'].sort().join(',');
    if (keys.join(',') !== allowed && keys.join(',') !== 'known') {
      bad('unknown cost must be { known: false, reason? }', { field });
    }
    if ('reason' in value) checkString(value.reason, `${field}.reason`);
  } else {
    bad(`${field}.known must be boolean true or false`, { field });
  }
}

function checkField(spec, value, field) {
  switch (spec.kind) {
    case 'string': checkString(value, field); break;
    case 'int>=0':
      if (!Number.isInteger(value) || value < 0) bad(`field "${field}" must be a non-negative integer`, { field });
      break;
    case 'iso': checkIso(value, field); break;
    case 'enum':
      if (!spec.values.includes(value)) {
        bad(`field "${field}" must be one of [${spec.values.join(', ')}]`, { field });
      }
      break;
    case 'cost': checkCost(value, field); break;
    default: bad(`unsupported spec kind "${spec.kind}"`, { field });
  }
}

/**
 * Validate one raw canonical event against the pinned contract and return a
 * frozen, JSON-clean copy. `source` is normalized to { adapter, ref?, meta? }.
 */
export function conformCanonicalEvent(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) bad('event must be a JSON object');
  const ctx = raw.event_id ? `event ${raw.event_id}` : 'event';

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.includes(key)) bad(`${ctx}: unknown top-level field "${key}"`, { key });
  }
  if (!EMITTED_EVENT_TYPES.includes(raw.type)) bad(`${ctx}: unsupported event type "${raw.type}"`, {});
  if (typeof raw.payload !== 'object' || raw.payload === null || Array.isArray(raw.payload)) {
    bad(`${ctx}: missing payload object`);
  }
  checkString(raw.task_ref, 'task_ref');
  if (raw.time !== undefined && raw.time !== null) checkIso(raw.time, 'time');
  if (raw.execution_ref !== undefined) checkString(raw.execution_ref, 'execution_ref');

  let source = undefined;
  if (raw.source !== undefined) {
    if (typeof raw.source !== 'object' || raw.source === null || Array.isArray(raw.source)) {
      bad(`${ctx}: "source" must be an object`);
    }
    for (const key of Object.keys(raw.source)) {
      if (!['adapter', 'ref', 'meta'].includes(key)) bad(`${ctx}: source allows only adapter/ref/meta`, { key });
    }
    checkString(raw.source.adapter, 'source.adapter');
    if (raw.source.ref !== undefined) checkString(raw.source.ref, 'source.ref');
    try {
      if (raw.source.meta !== undefined) JSON.stringify(raw.source.meta);
    } catch {
      bad(`${ctx}: source.meta must be JSON-serializable`);
    }
    source = {
      adapter: raw.source.adapter,
      ...(raw.source.ref !== undefined ? { ref: raw.source.ref } : {}),
      ...(raw.source.meta !== undefined ? { meta: raw.source.meta } : {}),
    };
  }

  const spec = PAYLOAD_SPECS[raw.type];
  for (const [field, fieldSpec] of Object.entries(spec)) {
    if (fieldSpec.required && !(field in raw.payload)) {
      bad(`${ctx}: event type "${raw.type}" requires payload field "${field}"`, { type: raw.type, field });
    }
  }
  for (const [field, value] of Object.entries(raw.payload)) {
    const fieldSpec = spec[field];
    if (!fieldSpec) bad(`${ctx}: event type "${raw.type}" does not allow payload field "${field}"`, { field });
    if (value === undefined) continue;
    checkField(fieldSpec, value, field);
  }
  if (raw.type === 'execution_finished') {
    if (raw.payload.status === 'superseded' && !raw.payload.superseded_by_execution_ref) {
      bad(`${ctx}: superseded execution_finished requires "superseded_by_execution_ref"`);
    }
    if (raw.payload.status !== 'superseded' && 'superseded_by_execution_ref' in raw.payload) {
      bad(`${ctx}: "superseded_by_execution_ref" is only allowed when status is "superseded"`);
    }
  }

  return deepFreeze({
    type: raw.type,
    time: raw.time ?? null,
    task_ref: raw.task_ref,
    ...(raw.execution_ref !== undefined ? { execution_ref: raw.execution_ref } : {}),
    ...(raw.event_id !== undefined ? { event_id: raw.event_id } : {}),
    ...(source !== undefined ? { source } : {}),
    payload: deepFreeze(JSON.parse(JSON.stringify(raw.payload))),
  });
}

/**
 * Build the `source` provenance block used on every emitted event.
 * `collector_version` is defaulted into `meta` so adapter provenance always
 * travels with tenant/source evidence.
 */
export function githubSource({ ref, meta }) {
  const fullMeta =
    meta === undefined ? { collector_version: COLLECTOR_VERSION } : { collector_version: COLLECTOR_VERSION, ...meta };
  return Object.freeze({
    adapter: ADAPTER,
    ...(ref !== undefined ? { ref } : {}),
    ...(fullMeta !== undefined ? { meta: Object.freeze(fullMeta) } : {}),
  });
}

export function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}
