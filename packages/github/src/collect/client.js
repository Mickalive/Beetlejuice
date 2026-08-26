/**
 * Read-only GitHub REST client (WC-002).
 *
 * Hard guarantees:
 *  - GET is the only HTTP method this module can issue; anything else throws
 *    READ_ONLY_VIOLATION before any I/O happens (initial audit must never
 *    require — or attempt — a write).
 *  - The credential never appears in thrown errors: messages pass through
 *    redactSecret().
 *  - The transport is injectable, so fixture-backed tests run without any
 *    network or credential; production uses global fetch against api.github.com.
 */
import { GithubAdapterError, AdapterErrorCodes, invalidConfig, readOnlyViolation, upstreamError, redactSecret } from '../errors.js';

const DEFAULT_BASE_URL = 'https://api.github.com';
export const DEFAULT_PAGE_SIZE = 100;

/**
 * Create the client.
 * @param {object} opts
 * @param {string}   [opts.token]      credential (PAT or App installation token);
 *                                     optional only for public-data fixtures.
 * @param {string}   [opts.baseUrl]    API root override (tests / GHES).
 * @param {Function} [opts.fetchImpl]  async ({url, headers}) => {status, headers, json|text}.
 * @param {number}   [opts.pageSize]   per_page for pagination (<=100).
 */
export function createGithubRestClient({
  token,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl,
  pageSize = DEFAULT_PAGE_SIZE,
} = {}) {
  if (typeof baseUrl !== 'string' || !/^https?:\/\//.test(baseUrl)) {
    throw invalidConfig('baseUrl must be an http(s) URL', {});
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw invalidConfig('pageSize must be an integer between 1 and 100', {});
  }
  if (token !== undefined && (typeof token !== 'string' || token.length === 0)) {
    throw invalidConfig('token, when supplied, must be a non-empty string', {});
  }
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw invalidConfig('no fetch implementation available; supply fetchImpl in this runtime', {});
  }

  function authHeaders() {
    // Least privilege by construction: we only ever send the read-scoped
    // token; no scopes/permissions are requested here.
    return token ? { authorization: `Bearer ${token}` } : {};
  }

  /**
   * Issue exactly one GET request. Returns { status, headers, json }.
   * Never follows write semantics; never retries writes (there are none).
   */
  async function request(path, { query } = {}) {
    assertReadOnlyMethod('GET');
    const url = buildRequestUrl(baseUrl, path, query, pageSize);
    let response;
    try {
      response = await doFetch(url.href, {
        method: 'GET',
        headers: {
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'beetlejuice-github-collector',
          ...authHeaders(),
        },
      });
    } catch (err) {
      throw new GithubAdapterError(
        AdapterErrorCodes.NETWORK_ERROR_REDACTED,
        redactSecret(`network error calling ${url.pathname}: ${err?.message ?? 'unknown error'}`, token),
        { path }
      );
    }
    const status = Number(response.status);
    if (status < 200 || status > 299) {
      throw upstreamError(redactSecret(`upstream ${status} for GET ${url.pathname}`, token), { path, status });
    }
    let json = null;
    if (typeof response.json === 'function') {
      try {
        json = await response.json();
      } catch {
        json = null; // empty bodies; callers handle null pages
      }
    } else if (response.json !== undefined) {
      // Injected transports may deliver pre-parsed payloads directly.
      json = response.json;
    }
    return { status, headers: response.headers ?? {}, json };
  }

  return Object.freeze({
    /** Only exposed capability: read requests + pagination. */
    request,
    /** Bounded pagination over this client's GET transport. */
    paginate: (path, opts = {}) => paginate(request, path, opts),
    get baseUrl() {
      return baseUrl;
    },
  });
}

/** Enforce read-only at the single choke point every request passes through. */
function assertReadOnlyMethod(method) {
  if (String(method).toUpperCase() !== 'GET') {
    throw readOnlyViolation(`method "${method}" is not permitted: the GitHub adapter is strictly read-only`, {});
  }
}

/** Build the absolute URL (validated path, encoded query). Exported pure for tests. */
export function buildRequestUrl(baseUrl, path, query = {}, pageSize = DEFAULT_PAGE_SIZE) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.includes('..')) {
    throw invalidConfig(`path must be an absolute API path starting with "/"`, { path });
  }
  const url = new URL(baseUrl.replace(/\/$/, '') + path);
  const params = new URLSearchParams({ per_page: String(pageSize), ...(query ?? {}) });
  for (const [k, v] of params) url.searchParams.set(k, v);
  return url;
}

/** Read a header value from either a Headers instance or a plain object. */
function headerValue(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name);
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.replace(/-/g, '_')];
}

/** Minimal Link-header parser: rel -> href map. */
export function parseLinkHeader(header) {
  if (typeof header !== 'string' || header.length === 0) return null;
  const map = new Map();
  for (const part of header.split(',')) {
    const match = part.match(/<([^>]*)>\s*;\s*rel="([a-z]+)"/i);
    if (match) map.set(match[2].toLowerCase(), match[1]);
  }
  return map.size > 0 ? map : null;
}

/**
 * Follow RFC-5988 `Link` header rel="next" until exhausted or maxPages hit.
 * Yields each page's parsed JSON. Pure control flow over `request`.
 */
export async function* paginate(requestFn, path, { query = {}, maxPages = 10 } = {}) {
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw invalidConfig('maxPages must be a positive integer', {});
  }
  let nextQuery = query;
  for (let page = 1; page <= maxPages; page++) {
    const res = await requestFn(path, { query: nextQuery });
    yield res;
    const link = parseLinkHeader(headerValue(res.headers, 'link'));
    const next = link?.get('next');
    if (!next) break;
    nextQuery = nextQueryFromUrl(next, path);
    if (!nextQuery) break; // next points off-path: stop rather than follow
  }
}

/** Extract only the page-token query of a same-path next link. */
function nextQueryFromUrl(nextHref, path) {
  try {
    const url = new URL(nextHref, 'https://example.invalid');
    if (!url.pathname.startsWith(path.split('?')[0])) return null;
    const q = {};
    for (const [k, v] of url.searchParams) q[k] = v;
    return q;
  } catch {
    return null;
  }
}
