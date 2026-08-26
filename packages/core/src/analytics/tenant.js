/**
 * Tenant-scoped analytics ledger.
 *
 * Boundaries enforced here:
 * - All state is instance-local. There is deliberately NO module-level
 *   registry, NO global task/customer/repo id and no cross-ledger lookup:
 *   one tenant's ledger cannot see another's data by construction.
 * - Every appended event is validated against the canonical schema, stamped
 *   with the four version fields and frozen. Stored evidence cannot be
 *   mutated through returned references.
 * - `seq` is strictly monotonic per ledger, so reconstruction is fully
 *   deterministic regardless of append batching.
 * - `events()` returns a frozen SNAPSHOT (repair R5): callers may inspect the
 *   stored stream but can never push into ledger internals — a mutated view
 *   used to be able to corrupt later audits with phantom events.
 */
import { normalizeEvent, deepFreeze } from '../events.js';
import { ErrorCodes, schemaViolation } from '../errors.js';
import { reconstructTasks } from '../task.js';
import { runWasteAnalysis } from '../waste/engine.js';
import { computeSummary } from '../economics/metrics.js';
import { buildCoreAuditExport } from '../export.js';

export class TenantLedger {
  /**
   * @param {string} tenantKey opaque, tenant-local scope handle supplied by
   *        the caller (product layer). The core never derives or persists a
   *        global identifier from it.
   */
  constructor(tenantKey) {
    if (typeof tenantKey !== 'string' || tenantKey.length === 0) {
      throw new TypeError('TenantLedger requires a non-empty tenant key');
    }
    this.#tenantKey = tenantKey;
  }

  #tenantKey;
  #events = [];
  #seq = 0;
  #eventIds = new Set();

  get tenantKey() {
    return this.#tenantKey;
  }

  /** Number of stored canonical events. */
  get size() {
    return this.#events.length;
  }

  /**
   * Validate + stamp + store one raw adapter event. Returns the frozen
   * canonical event actually stored.
   */
  append(rawEvent) {
    const seq = ++this.#seq;
    let eventId = undefined;
    if (typeof rawEvent?.event_id === 'string' && rawEvent.event_id.length > 0) {
      if (this.#eventIds.has(rawEvent.event_id)) {
        throw schemaViolation(
          ErrorCodes.DUPLICATE_EVENT_ID,
          `duplicate event_id "${rawEvent.event_id}" in tenant ledger`,
          { event_id: rawEvent.event_id }
        );
      }
      eventId = rawEvent.event_id;
      this.#eventIds.add(eventId);
    } else {
      eventId = `evt-${String(seq).padStart(6, '0')}`;
      // Auto-generated ids are unique by seq construction; no set tracking needed.
    }
    const event = normalizeEvent(rawEvent, { seq, eventId });
    this.#events.push(event);
    return event;
  }

  /** Append many events; returns count. */
  appendAll(rawEvents) {
    let n = 0;
    for (const raw of rawEvents) {
      this.append(raw);
      n += 1;
    }
    return n;
  }

  /**
   * Frozen snapshot of the canonical event list (ingestion order = seq order).
   * Mutation attempts on the returned array do not affect ledger internals.
   */
  events() {
    return Object.freeze([...this.#events]);
  }

  /** Project the event stream into AGENTIC_TASK aggregates keyed by task_ref. */
  reconstruct() {
    return reconstructTasks(this.#events);
  }

  /** Tasks as an array ordered by task_ref for stable reporting. */
  tasks() {
    return [...this.reconstruct().values()].sort((a, b) => (a.taskRef < b.taskRef ? -1 : 1));
  }

  /** Full audit pass: tasks + certain-waste findings + first-screen summary. */
  audit({ rules } = {}) {
    const tasks = this.tasks();
    const waste = runWasteAnalysis(tasks, { rules });
    const summary = computeSummary({ tasks, waste, eventCount: this.size });
    return deepFreeze({ tasks, waste, summary });
  }

  /**
   * Convenience producer for the canonical-core audit export envelope
   * (see export.js). Accepts the same options as buildCoreAuditExport plus
   * `rules` forwarded to audit().
   */
  exportCoreAudit(options = {}) {
    const { rules, ...exportOptions } = options;
    return buildCoreAuditExport(this.audit({ rules }), exportOptions);
  }
}
