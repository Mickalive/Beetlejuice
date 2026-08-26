/**
 * GitHub App authentication (WC-002 P1 build item: "GitHub App prototype
 * surface").
 *
 * The preferred Beetlejuice credential is a GitHub App installation token:
 * least privilege by construction (its permissions are fixed once in the App
 * manifest, never requested ad hoc), short-lived, scoped to one installation
 * and individually revocable. This module implements the standard exchange:
 *
 *   1. sign a small RS256 JWT asserting the App identity
 *      (header {alg:"RS256",typ:"JWT"}, claims {iat, exp, iss: appId});
 *   2. POST it to /app/installations/{installationId}/access_tokens;
 *   3. return the short-lived installation token for createGithubRestClient(),
 *      which remains STRICTLY GET-only (see collect/client.js).
 *
 * Boundary note (read-only audit invariant): the token-exchange call is an
 * HTTP POST by GitHub's API contract, but it performs no repository write and
 * grants nothing beyond the App manifest's installed permissions. All
 * repository access still flows exclusively through the GET-only client.
 *
 * Security properties:
 *  - the private key, the JWT and the installation token are secrets; none of
 *    them can appear in error messages or thrown details (redactSecret);
 *  - the JWT lifetime is validated against GitHub's 10-minute maximum;
 *  - tokens are never cached here: each caller gets a fresh, expiring value.
 */
import { createSign } from 'node:crypto';
import { GithubAdapterError, AdapterErrorCodes, invalidConfig, upstreamError, redactSecret } from './errors.js';

/** GitHub rejects App JWTs whose exp exceeds iat by more than 10 minutes. */
export const MAX_JWT_TTL_SECONDS = 600;
const MIN_JWT_TTL_SECONDS = 60;

const DEFAULT_BASE_URL = 'https://api.github.com';

function b64urlJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/**
 * Build the RS256 App identity JWT (RFC 7519 compact serialization).
 * Exported for conformance tests; production code should prefer
 * createGithubAppAuth() which signs fresh JWTs per exchange.
 *
 * @param {object} p
 * @param {string|number} p.appId        numeric GitHub App id (as issued)
 * @param {string|Buffer|KeyObject} p.privateKey  PEM string / buffer / KeyObject
 * @param {number}  [p.ttlSeconds]       60..600 (default 600)
 * @param {() => number} [p.nowMs]       injectable clock (ms epoch), tests only
 * @returns {string} compact JWT
 */
export function createAppJwt({ appId, privateKey, ttlSeconds = MAX_JWT_TTL_SECONDS, nowMs = () => Date.now() }) {
  assertAppId(appId);
  assertPrivateKey(privateKey);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < MIN_JWT_TTL_SECONDS || ttlSeconds > MAX_JWT_TTL_SECONDS) {
    throw invalidConfig(`ttlSeconds must be an integer in [${MIN_JWT_TTL_SECONDS}, ${MAX_JWT_TTL_SECONDS}]`, {});
  }
  const now = Math.floor(Number(nowMs()) / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = { iat: now, exp: now + ttlSeconds, iss: String(appId) };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(claims)}`;
  let signatureB64;
  try {
    signatureB64 = createSign('RSA-SHA256').update(signingInput).sign(privateKey).toString('base64url');
  } catch (err) {
    // Never echo key material or crypto internals that could embed it.
    throw invalidConfig('unable to sign the App JWT with the supplied private key', {});
  }
  return `${signingInput}.${signatureB64}`;
}

/**
 * Create the App-auth surface. Nothing touches the network until
 * createInstallationToken() is awaited.
 *
 * @param {object} opts
 * @param {string|number} opts.appId          GitHub App id
 * @param {string|KeyObject} opts.privateKey  App private key (PEM or KeyObject)
 * @param {string}   [opts.baseUrl]           API root override (tests/GHES)
 * @param {Function} [opts.fetchImpl]         injected async transport
 * @param {number}   [opts.ttlSeconds]        JWT lifetime clamp (60..600)
 * @param {() => number} [opts.nowMs]         injectable clock (tests only)
 */
export function createGithubAppAuth({
  appId,
  privateKey,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl,
  ttlSeconds = MAX_JWT_TTL_SECONDS,
  nowMs,
} = {}) {
  assertAppId(appId);
  assertPrivateKey(privateKey);
  if (typeof baseUrl !== 'string' || !/^https?:\/\//.test(baseUrl)) {
    throw invalidConfig('baseUrl must be an http(s) URL', {});
  }
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw invalidConfig('no fetch implementation available; supply fetchImpl in this runtime', {});
  }
  const jwtOptions = nowMs === undefined ? { appId, privateKey, ttlSeconds } : { appId, privateKey, ttlSeconds, nowMs };

  /**
   * Mint one installation access token.
   * @param {object} p
   * @param {number|string} p.installationId  the installation to act for
   * @returns {{ token:string, expires_at:string }} feed `token` to
   *                  createGithubRestClient({ token }) — GET-only reads.
   */
  async function createInstallationToken({ installationId }) {
    const idNum = Number(installationId);
    if (!Number.isInteger(idNum) || idNum <= 0) {
      throw invalidConfig('installationId must be a positive integer', {});
    }
    const jwt = createAppJwt(jwtOptions);
    const url = `${baseUrl.replace(/\/$/, '')}/app/installations/${idNum}/access_tokens`;
    let response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: {
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'beetlejuice-github-collector',
          authorization: `Bearer ${jwt}`,
          'content-type': 'application/json',
        },
        body: '{}',
      });
    } catch (err) {
      throw new GithubAdapterError(
        AdapterErrorCodes.NETWORK_ERROR_REDACTED,
        redactSecret(
          `network error during installation-token exchange: ${err?.message ?? 'unknown error'}`,
          jwt,
          typeof err?.message === 'string' ? err.message : ''
        ),
        { installationId: idNum }
      );
    }
    const status = Number(response.status);
    if (status < 200 || status > 299) {
      throw upstreamError(redactSecret(`upstream ${status} during installation-token exchange`, jwt), {
        installationId: idNum,
        status,
      });
    }
    let json;
    try {
      json = typeof response.json === 'function' ? await response.json() : response.json;
    } catch {
      throw upstreamError('installation-token exchange returned a malformed body', { installationId: idNum, status });
    }
    const token = json?.token;
    const expiresAt = json?.expires_at;
    if (typeof token !== 'string' || token.length === 0) {
      throw upstreamError('installation-token exchange response lacks a usable token', {
        installationId: idNum,
        status,
      });
    }
    return Object.freeze({
      token,
      ...(typeof expiresAt === 'string' ? { expires_at: expiresAt } : {}),
    });
  }

  return Object.freeze({
    /** Only capability exposed: mint an installation token for the audit client. */
    createInstallationToken,
    get baseUrl() {
      return baseUrl;
    },
  });
}

/**
 * Operator convenience: turn an env-var-shaped single-line PEM (with literal
 * "\n" escapes) into a real PEM block. Rejects anything that does not look
 * like a private-key PEM instead of passing garbage into the signer.
 */
export function privateKeyFromEnvString(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidConfig('expected a non-empty PEM string', {});
  }
  const pem = value.includes('\\n') ? value.split('\\n').join('\n') : value;
  if (!pem.includes('-----BEGIN') || !pem.includes('KEY---')) {
    throw invalidConfig('value does not look like a PEM private-key block', {});
  }
  return pem;
}

function assertAppId(appId) {
  const ok =
    (typeof appId === 'number' && Number.isInteger(appId) && appId > 0) ||
    (typeof appId === 'string' && /^\d+$/.test(appId));
  if (!ok) throw invalidConfig('appId must be the numeric GitHub App id (number or digit string)', {});
}

function assertPrivateKey(privateKey) {
  if (typeof privateKey !== 'string' || privateKey.length === 0) {
    // KeyObject support: duck-typed so this module stays dependency-free.
    if (
      privateKey &&
      typeof privateKey === 'object' &&
      typeof privateKey.export === 'function' &&
      privateKey.type === 'private'
    ) {
      return;
    }
    throw invalidConfig('privateKey must be a PEM string or a private KeyObject', {});
  }
  if (!privateKey.includes('-----BEGIN')) {
    throw invalidConfig('privateKey does not look like a PEM block', {});
  }
}
