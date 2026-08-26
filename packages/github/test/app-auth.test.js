/**
 * GitHub App authentication surface (WC-002 P1) — hermetic conformance tests.
 *
 * SECURITY: no credential-shaped literal exists in this file. The RSA
 * keypair, App id, installation token and webhook-style secrets used below
 * are generated/composed at runtime from harmless fragments.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import {
  MAX_JWT_TTL_SECONDS,
  createAppJwt,
  createGithubAppAuth,
  privateKeyFromEnvString,
} from '../src/app-auth.js';
import { GithubAdapterError, AdapterErrorCodes } from '../src/errors.js';
import { createGithubRestClient } from '../src/collect/client.js';

const FIXED_NOW_MS = Date.parse('2026-08-01T12:00:00Z');

function freshKeys() {
  return generateKeyPairSync('rsa', { modulusLength: 2048 });
}

const APP_ID = '12345'; // numeric string as GitHub issues them (synthetic)

test('createAppJwt emits an RS256 compact JWT whose claims verify against the public key', () => {
  const { publicKey, privateKey } = freshKeys();
  const jwt = createAppJwt({ appId: APP_ID, privateKey, nowMs: () => FIXED_NOW_MS });
  const [h, p, s] = jwt.split('.');
  assert.equal(jwt.split('.').length, 3);

  const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  assert.deepEqual(header, { alg: 'RS256', typ: 'JWT' });
  assert.equal(claims.iss, APP_ID);
  assert.equal(claims.exp - claims.iat, MAX_JWT_TTL_SECONDS);
  assert.equal(claims.iat, Math.floor(FIXED_NOW_MS / 1000));

  const verifies = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url'));
  assert.equal(verifies, true, 'signature must verify under the matching public key');
});

test('a foreign key cannot have signed the JWT (negative control)', () => {
  const a = freshKeys();
  const b = freshKeys();
  const jwt = createAppJwt({ appId: APP_ID, privateKey: a.privateKey, nowMs: () => FIXED_NOW_MS });
  const [h, p, s] = jwt.split('.');
  assert.equal(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(b.publicKey, Buffer.from(s, 'base64url')), false);
});

test('JWT TTL is bounded by GitHub rules; nonsense inputs are rejected before signing', () => {
  const { privateKey } = freshKeys();
  assert.throws(() => createAppJwt({ appId: APP_ID, privateKey, ttlSeconds: 601 }), /ttlSeconds/);
  assert.throws(() => createAppJwt({ appId: APP_ID, privateKey, ttlSeconds: 59 }), /ttlSeconds/);
  assert.doesNotThrow(() =>
    createAppJwt({ appId: APP_ID, privateKey, ttlSeconds: 60, nowMs: () => FIXED_NOW_MS })
  );
  assert.throws(() => createAppJwt({ appId: '', privateKey }), /appId/);
  assert.throws(() => createAppJwt({ appId: APP_ID, privateKey: 'not a pem' }), /PEM/);
  assert.throws(() => createAppJwt({ appId: APP_ID, privateKey: undefined }), /privateKey/);
});

test('installation-token exchange hits the documented endpoint and returns the minted token', async () => {
  const { privateKey } = freshKeys();
  const calls = [];
  const minted = ['ghs', 'composed', 'at-runtime'].join('_'); // harmless fragments, token-shaped only at runtime
  const fetchImpl = async (url, init) => {
    calls.push({ url: new URL(url), init });
    return {
      status: 201,
      json: { token: minted, expires_at: '2026-08-01T12:10:00Z', permissions: { contents: 'read', metadata: 'read' } },
    };
  };
  const auth = createGithubAppAuth({ appId: APP_ID, privateKey, fetchImpl, nowMs: () => FIXED_NOW_MS });
  const res = await auth.createInstallationToken({ installationId: 42 });

  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.init.method, 'POST');
  assert.equal(call.url.pathname, '/app/installations/42/access_tokens');
  assert.match(call.init.headers.authorization, /^Bearer ey/); // a JWT, not any secret literal
  assert.equal(call.init.headers.accept, 'application/vnd.github+json');
  assert.deepEqual({ token: res.token, expires_at: res.expires_at }, { token: minted, expires_at: '2026-08-01T12:10:00Z' });
});

test('the minted installation token plugs into the strictly-GET audit client', async () => {
  const { privateKey } = freshKeys();
  const minted = ['ghs', 'runtime', 'only'].join('_');
  const auth = createGithubAppAuth({
    appId: APP_ID,
    privateKey,
    fetchImpl: async () => ({ status: 201, json: { token: minted, expires_at: '2026-08-01T12:10:00Z' } }),
    nowMs: () => FIXED_NOW_MS,
  });
  const { token } = await auth.createInstallationToken({ installationId: 7 });

  const seen = [];
  const client = createGithubRestClient({
    token,
    fetchImpl: async (url, init) => {
      seen.push({ method: init.method, authorization: init.headers.authorization });
      return { status: 200, headers: {}, json: [] };
    },
  });
  for await (const _page of client.paginate('/repos/o/r/pulls')) void _page;
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'GET', 'repository access stays read-only even when authenticated via an App');
  assert.equal(seen[0].authorization, `Bearer ${token}`);
});

test('exchange failures never leak the JWT or the returned token in error text', async () => {
  const { privateKey } = freshKeys();
  const jwtLeakProbe = 'jwt-probe-fragment';
  // The network error message embeds a marker AND we pass the real jwt through redaction.
  const auth = createGithubAppAuth({
    appId: APP_ID,
    privateKey,
    fetchImpl: async () => {
      throw new Error(`boom ${jwtLeakProbe}`);
    },
    nowMs: () => FIXED_NOW_MS,
  });
  await assert.rejects(
    () => auth.createInstallationToken({ installationId: 9 }),
    (err) => err instanceof GithubAdapterError && err.code === AdapterErrorCodes.NETWORK_ERROR_REDACTED
  );
  try {
    await auth.createInstallationToken({ installationId: 9 });
    assert.fail('expected throw');
  } catch (err) {
    const text = String(err.message + JSON.stringify(err.details ?? {}));
    assert.ok(!text.includes(jwtLeakProbe), 'upstream error text must be scrubbed');
    assert.ok(!/eyJ/.test(text), 'no JWT fragment may appear');
  }

  const upstream = createGithubAppAuth({
    appId: APP_ID,
    privateKey,
    fetchImpl: async () => ({ status: 401, json: { message: 'bad credentials eyJtampered' } }),
    nowMs: () => FIXED_NOW_MS,
  });
  await assert.rejects(() => upstream.createInstallationToken({ installationId: 9 }), (err) => {
    assert.equal(err.code, AdapterErrorCodes.UPSTREAM_ERROR);
    assert.ok(!String(err.message).includes('eyJ'), 'JWT must never appear even via upstream echoes');
    assert.equal(err.details.status, 401);
    return true;
  });

  const malformed = createGithubAppAuth({
    appId: APP_ID,
    privateKey,
    fetchImpl: async () => ({ status: 200, json: {} }),
    nowMs: () => FIXED_NOW_MS,
  });
  await assert.rejects(() => malformed.createInstallationToken({ installationId: 9 }), /lacks a usable token/);
});

test('installation ids are validated before any I/O', async () => {
  const { privateKey } = freshKeys();
  let io = 0;
  const auth = createGithubAppAuth({
    appId: APP_ID,
    privateKey,
    fetchImpl: async () => {
      io += 1;
      return { status: 201, json: { token: 'x' } };
    },
    nowMs: () => FIXED_NOW_MS,
  });
  await assert.rejects(() => auth.createInstallationToken({ installationId: 0 }), /installationId/);
  await assert.rejects(() => auth.createInstallationToken({ installationId: NaN }), /installationId/);
  await assert.rejects(() => auth.createInstallationToken({}), /installationId/);
  assert.equal(io, 0, 'validation must happen before any request');
});

test('constructor validates configuration without touching the network', () => {
  const fakePemHeader = ['-----BEGIN', 'PRIVATE KEY-----'].join(' '); // shape only; no key material
  assert.throws(() => createGithubAppAuth({ appId: APP_ID, privateKey: undefined }), /privateKey/);
  assert.throws(() => createGithubAppAuth({ appId: 'abc', privateKey: fakePemHeader }), /appId/);
  assert.throws(() => createGithubAppAuth({ appId: APP_ID, privateKey: fakePemHeader, baseUrl: 'nope' }), /baseUrl/);
});

test('privateKeyFromEnvString unescapes single-line PEM env values and rejects junk', () => {
  const { privateKey } = freshKeys();
  const exportedPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString('utf8');
  const singleLine = exportedPem.split('\n').join('\\n');
  const restored = privateKeyFromEnvString(singleLine);
  assert.equal(restored, exportedPem);

  assert.throws(() => privateKeyFromEnvString(''), /non-empty/);
  assert.throws(() => privateKeyFromEnvString('definitely not a pem'), /PEM/);
});
