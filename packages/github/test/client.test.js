import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGithubRestClient,
  buildRequestUrl,
  parseLinkHeader,
} from '../src/collect/client.js';
import { GithubAdapterError, AdapterErrorCodes, redactSecret } from '../src/errors.js';
import { stubTransport, testToken } from './helpers.js';

test('client issues strictly GET requests — the read-only choke point', async () => {
  const { fetchImpl, calls } = stubTransport([{ match: /\/repos\/o\/r\/pulls$/, respond: [] }]);
  const client = createGithubRestClient({ token: testToken(), fetchImpl });
  await client.request('/repos/o/r/pulls', {});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
});

test('authorization carries the credential; user agent identifies the collector', async () => {
  const { fetchImpl, calls } = stubTransport([{ match: /pulls$/, respond: [] }]);
  const token = testToken();
  const client = createGithubRestClient({ token, fetchImpl });
  for await (const _page of client.paginate('/repos/o/r/pulls')) {
    // consume the (lazy) generator
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.authorization, `Bearer ${token}`);
  assert.match(calls[0].headers['user-agent'], /beetlejuice/);
});

test('no token means no authorization header (public fixture mode)', async () => {
  const { fetchImpl, calls } = stubTransport([{ match: /pulls$/, respond: [] }]);
  const client = createGithubRestClient({ fetchImpl });
  for await (const _page of client.paginate('/repos/o/r/pulls')) {
    // consume
  }
  assert.equal(calls[0].headers.authorization, undefined);
});

test('pagination follows Link rel="next" and merges page tokens', async () => {
  const { fetchImpl, calls } = stubTransport([
    {
      match: /\/repos\/o\/r\/actions\/runs$/,
      respond: (u) => (u.searchParams.get('page') === '2' ? { workflow_runs: [{ id: 2 }] } : { workflow_runs: [{ id: 1 }] }),
      headers: {},
    },
  ]);
  // Simulate Link headers by wrapping request-level responses per page.
  let pageCount = 0;
  const linkHeaders = [
    { link: '<https://api.github.com/repos/o/r/actions/runs?per_page=100&page=2>; rel="next"' },
    {},
  ];
  const client = createGithubRestClient({
    fetchImpl: async (url, init) => {
      const res = await fetchImpl(url, init);
      return { ...res, headers: linkHeaders[Math.min(pageCount++, linkHeaders.length - 1)] };
    },
  });

  const pages = [];
  for await (const res of client.paginate('/repos/o/r/actions/runs')) pages.push(res.json);
  assert.equal(pages.length, 2);
  assert.deepEqual(pages.flatMap((p) => p.workflow_runs).map((r) => r.id), [1, 2]);
  assert.equal(calls[1].query.page, '2');
});

test('pagination respects maxPages even when Link next persists forever', async () => {
  const client = createGithubRestClient({
    fetchImpl: async () => ({
      status: 200,
      headers: { link: '<https://api.github.com/repos/o/r/pulls?page=2>; rel="next"' },
      json: [],
    }),
  });
  let count = 0;
  for await (const _res of client.paginate('/repos/o/r/pulls', { maxPages: 3 })) count += 1;
  assert.equal(count, 3);
});

test('upstream failures never leak the credential in error text', async () => {
  const token = testToken();
  const { fetchImpl } = stubTransport([]);
  const client = createGithubRestClient({
    token,
    fetchImpl: async () => ({ status: 500, headers: {}, json: null }),
  });
  await assert.rejects(
    () => client.request('/repos/o/r/pulls'),
    (err) => err instanceof GithubAdapterError && err.code === AdapterErrorCodes.UPSTREAM_ERROR
  );
  try {
    await client.request('/repos/o/r/pulls');
  } catch (err) {
    assert.ok(!String(err.message).includes(token), 'token must be redacted');
    assert.match(String(err.message), /upstream 500/);
  }
});

test('network errors are wrapped as redacted network failures', async () => {
  const token = testToken();
  const client = createGithubRestClient({
    token,
    fetchImpl: async () => {
      throw new Error(`socket hangup while sending ${token}`);
    },
  });
  await assert.rejects(() => client.request('/repos/o/r/pulls'), (err) => {
    assert.equal(err.code, AdapterErrorCodes.NETWORK_ERROR_REDACTED);
    assert.ok(!String(err.message).includes(token));
    return true;
  });
});

test('buildRequestUrl validates paths and applies pageSize + query deterministically', () => {
  const url = buildRequestUrl('https://api.github.com', '/repos/o/r/pulls', { state: 'all' }, 50);
  assert.equal(url.origin, 'https://api.github.com');
  assert.equal(url.pathname, '/repos/o/r/pulls');
  assert.equal(url.searchParams.get('per_page'), '50');
  assert.equal(url.searchParams.get('state'), 'all');

  assert.throws(() => buildRequestUrl('https://api.github.com', 'relative'));
  assert.throws(() => buildRequestUrl('https://api.github.com', '/a/../b'));

  assert.throws(() => createGithubRestClient({ pageSize: 0 }));
  assert.throws(() => createGithubRestClient({ pageSize: 101 }));
  assert.throws(() => createGithubRestClient({ baseUrl: 'not-a-url' }));
  assert.throws(() => createGithubRestClient({ token: '' }));
});

test('parseLinkHeader handles GitHub-style composite headers', () => {
  const map = parseLinkHeader(
    '<https://api.github.com/repos/o/r/pulls?page=2>; rel="next", <https://api.github.com/repos/o/r/pulls?page=9>; rel="last"'
  );
  assert.equal(map.get('next'), 'https://api.github.com/repos/o/r/pulls?page=2');
  assert.equal(map.get('last'), 'https://api.github.com/repos/o/r/pulls?page=9');
  assert.equal(parseLinkHeader(null), null);
  assert.equal(parseLinkHeader('garbage'), null);
});

test('redactSecret scrubs every occurrence', () => {
  assert.equal(redactSecret('Bearer abc abc', 'abc'), 'Bearer [redacted] [redacted]');
  assert.equal(redactSecret('nothing here', ''), 'nothing here');
});
