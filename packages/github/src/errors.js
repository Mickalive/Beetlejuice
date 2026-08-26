/**
 * GitHub adapter error taxonomy (WC-002).
 *
 * Adapters must degrade honestly: every rejection is explicit and
 * machine-readable so callers can distinguish "bad configuration" from
 * "ambiguous upstream evidence". Error messages are scrubbed of credential
 * material via redactSecret() so tokens can never leak through logs.
 */
export class GithubAdapterError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'GithubAdapterError';
    this.code = code;
    this.details = details;
  }
}

export const AdapterErrorCodes = Object.freeze({
  INVALID_CONFIG: 'INVALID_CONFIG',
  READ_ONLY_VIOLATION: 'READ_ONLY_VIOLATION',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  NETWORK_ERROR_REDACTED: 'NETWORK_ERROR_REDACTED',
  UNSUPPORTED_WEBHOOK_EVENT: 'UNSUPPORTED_WEBHOOK_EVENT',
  BAD_SIGNATURE_INPUT: 'BAD_SIGNATURE_INPUT',
  SIGNATURE_MISMATCH: 'SIGNATURE_MISMATCH',
  BAD_EVIDENCE: 'BAD_EVIDENCE',
});

export function invalidConfig(message, details) {
  return new GithubAdapterError(AdapterErrorCodes.INVALID_CONFIG, message, details);
}

export function readOnlyViolation(message, details) {
  return new GithubAdapterError(AdapterErrorCodes.READ_ONLY_VIOLATION, message, details);
}

export function upstreamError(message, details) {
  return new GithubAdapterError(AdapterErrorCodes.UPSTREAM_ERROR, message, details);
}

export function badSignatureInput(message, details) {
  return new GithubAdapterError(AdapterErrorCodes.BAD_SIGNATURE_INPUT, message, details);
}

export function signatureMismatch(message, details) {
  return new GithubAdapterError(AdapterErrorCodes.SIGNATURE_MISMATCH, message, details);
}

export function isGithubAdapterError(err) {
  return err instanceof GithubAdapterError;
}

/**
 * Remove any occurrence of `secret` from `text` so credentials can never
 * leak through error messages or logs.
 */
export function redactSecret(text, ...secrets) {
  let out = text;
  for (const secret of secrets) {
    if (!secret || String(secret).length === 0) continue;
    out = out.split(String(secret)).join('[redacted]');
  }
  return out;
}
