/**
 * Test helpers: runtime-composed "sensitive" values (never literal
 * credential-shaped fixtures), stub transports, and assertion utilities.
 */
import { createHmac } from 'node:crypto';

/**
 * Sensitive-looking test values are composed at runtime from harmless
 * fragments so no credential-shaped literal ever exists in source.
 */
export const SECRET_FRAGMENTS = Object.freeze(['webhook', 'junk', 'frag-42']);
export const TOKEN_FRAGMENTS = Object.freeze(['local', 'stub', '000']);

export const testWebhookSecret = () => SECRET_FRAGMENTS.join('-');
export const testToken = () => ['pat', ...TOKEN_FRAGMENTS].join('_');

/** Independently compute the GitHub-style signature (cross-check oracle). */
export function oracleSignature(payloadBody, secret) {
  return 'sha256=' + createHmac('sha256', secret).update(Buffer.from(payloadBody, 'utf8')).digest('hex');
}

/** Minimal fetch-like transport over an in-memory URL router. */
export function stubTransport(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    calls.push({
      path: u.pathname,
      query: Object.fromEntries(u.searchParams),
      method: init.method,
      headers: init.headers,
    });
    const handler = routes.find((r) => r.match.test(u.pathname));
    if (!handler) {
      return { status: 404, headers: {}, json: null };
    }
    const page = typeof handler.respond === 'function' ? handler.respond(u, calls.length) : handler.respond;
    return { status: 200, headers: handler.headers ?? {}, json: page };
  };
  return { fetchImpl, calls };
}
