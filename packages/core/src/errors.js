/**
 * Core error taxonomy. Every rejection is explicit and machine-readable so
 * adapters can distinguish "bad evidence" from "ambiguous evidence".
 */
export class BeetlejuiceCoreError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'BeetlejuiceCoreError';
    this.code = code;
    this.details = details;
  }
}

export const ErrorCodes = Object.freeze({
  UNKNOWN_EVENT_TYPE: 'UNKNOWN_EVENT_TYPE',
  MISSING_FIELD: 'MISSING_FIELD',
  BAD_FIELD_TYPE: 'BAD_FIELD_TYPE',
  FORBIDDEN_FIELD: 'FORBIDDEN_FIELD',
  DUPLICATE_EVENT_ID: 'DUPLICATE_EVENT_ID',
  DUPLICATE_COMPONENT_REF: 'DUPLICATE_COMPONENT_REF',
  BAD_SUPERSESSION: 'BAD_SUPERSESSION',
  BAD_EXECUTION_LIFECYCLE: 'BAD_EXECUTION_LIFECYCLE',
  UNKNOWN_EXECUTION_REF: 'UNKNOWN_EXECUTION_REF',
  EMPTY_LEDGER: 'EMPTY_LEDGER',
  UNBALANCED_LEDGER: 'UNBALANCED_LEDGER',
});

export function schemaViolation(code, message, details) {
  return new BeetlejuiceCoreError(code, message, details);
}

export function isBeetlejuiceCoreError(err) {
  return err instanceof BeetlejuiceCoreError;
}
