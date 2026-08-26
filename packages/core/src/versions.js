/**
 * Versioning invariants (MASTER_PROMPT §16): every event carries
 * schema_version, event_version, collector_version, normalization_version.
 *
 * These stamps are attached by the core when an adapter appends an event, so
 * provenance is guaranteed even if the adapter forgets.
 */
export const VERSIONS = Object.freeze({
  /** Canonical AGENTIC_TASK domain schema (this package's domain contract). */
  coreSchemaVersion: '1',
  /** Canonical event envelope schema. */
  eventSchemaVersion: '1',
  /** Identity of the component that collected/normalized the evidence. */
  collectorVersion: 'beetlejuice-core-collector@1.0.0',
  /** Identity of the normalization pipeline that produced canonical events. */
  normalizationVersion: 'beetlejuice-core-normalization@1.0.0',
});

/**
 * Per-event-type version. New event types start at '1'; breaking payload
 * changes must bump the type version here and keep old readers working.
 */
const EVENT_VERSION_OVERRIDES = Object.freeze({});

export function eventVersionFor(eventType) {
  return EVENT_VERSION_OVERRIDES[eventType] ?? '1';
}
