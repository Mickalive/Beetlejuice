/**
 * Webhook signature verification (WC-002 P1 acceptance: "webhook
 * verification is tested").
 *
 * GitHub signs deliveries with HMAC-SHA256 in the `X-Hub-Signature-256`
 * header as `sha256=<hex>`. Verification:
 *  - rejects malformed/missing headers and payloads explicitly (never with a
 *    vague 500);
 *  - compares digests with crypto.timingSafeEqual (length-guarded) so the
 *    comparison itself does not leak information;
 *  - never logs the secret; error strings are secret-scrubbed.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { badSignatureInput, signatureMismatch, redactSecret } from '../errors.js';

export const SIGNATURE_PREFIX = 'sha256=';

/** Compute the exact header value GitHub would send for this payload. */
export function signWebhookPayload(payloadBody, secret) {
  const body = toBuffer(payloadBody);
  assertSecret(secret);
  return SIGNATURE_PREFIX + createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Verify one delivery. Returns true on a valid signature.
 *
 * @param {object} p
 * @param {string|Buffer} p.payloadBody      raw request body (exact bytes)
 * @param {string}        p.signatureHeader  X-Hub-Signature-256 value
 * @param {string}        p.secret           configured webhook secret
 * @returns {boolean}
 * @throws BAD_SIGNATURE_INPUT on malformed inputs, SIGNATURE_MISMATCH on mismatch
 */
export function verifyWebhookSignature({ payloadBody, signatureHeader, secret }) {
  const body = toBuffer(payloadBody);
  if (body.length === 0) {
    throw badSignatureInput('payload body is empty', {});
  }
  assertSecret(secret);

  let expected;
  try {
    expected = Buffer.from(signWebhookPayload(body, secret).slice(SIGNATURE_PREFIX.length), 'hex');
  } catch (err) {
    throw badSignatureInput(redactSecret(`unable to compute expected signature: ${err?.message}`, secret), {});
  }

  const provided = parseSignatureHeader(signatureHeader);
  // Timing-safe comparison requires equal lengths; differing lengths are
  // rejected outright — that fact alone leaks nothing useful to an attacker.
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw signatureMismatch('webhook signature does not match payload', {
      providedLength: provided.length,
    });
  }
  return true;
}

function parseSignatureHeader(header) {
  if (typeof header !== 'string' || header.length === 0) {
    throw badSignatureInput('missing X-Hub-Signature-256 header', {});
  }
  const value = header.trim().toLowerCase();
  if (!value.startsWith(SIGNATURE_PREFIX)) {
    throw badSignatureInput('signature must use the sha256= scheme', { schemePrefix: value.slice(0, 7) });
  }
  const hex = value.slice(SIGNATURE_PREFIX.length);
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) {
    throw badSignatureInput('signature digest is not valid lowercase hex', {});
  }
  return Buffer.from(hex, 'hex');
}

function assertSecret(secret) {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw badSignatureInput('webhook secret must be a non-empty string', {});
  }
}

function toBuffer(payloadBody) {
  if (typeof payloadBody === 'string') return Buffer.from(payloadBody, 'utf8');
  if (Buffer.isBuffer(payloadBody)) return payloadBody;
  throw badSignatureInput('payload body must be a string or Buffer', {});
}
