import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signWebhookPayload, verifyWebhookSignature, SIGNATURE_PREFIX } from '../src/webhook/verify.js';
import { GithubAdapterError, AdapterErrorCodes } from '../src/errors.js';
import { oracleSignature, testWebhookSecret, SECRET_FRAGMENTS } from './helpers.js';

const secret = testWebhookSecret(); // composed at runtime from harmless fragments
const body = JSON.stringify({ zen: 'synthetic delivery', hook_id: 1, sender: { login: 'someone' } });

test('signing matches an independently computed HMAC-SHA256 oracle', () => {
  const sig = signWebhookPayload(body, secret);
  assert.ok(sig.startsWith(SIGNATURE_PREFIX));
  assert.equal(sig, oracleSignature(body, secret));
});

test('a valid signature verifies', () => {
  assert.equal(verifyWebhookSignature({ payloadBody: body, signatureHeader: oracleSignature(body, secret), secret }), true);
});

test('verification works across string and Buffer bodies (exact bytes)', () => {
  const buffer = Buffer.from(body, 'utf8');
  assert.equal(
    verifyWebhookSignature({ payloadBody: buffer, signatureHeader: oracleSignature(body, secret), secret }),
    true
  );
});

test('tampered payloads are rejected with SIGNATURE_MISMATCH', () => {
  const tampered = body.replace('synthetic', 'tampered');
  assert.throws(
    () => verifyWebhookSignature({ payloadBody: tampered, signatureHeader: oracleSignature(body, secret), secret }),
    (err) => err instanceof GithubAdapterError && err.code === AdapterErrorCodes.SIGNATURE_MISMATCH
  );
});

test('the wrong secret is rejected (no silent pass)', () => {
  const otherSecret = SECRET_FRAGMENTS.join('+');
  assert.notEqual(otherSecret, secret);
  assert.throws(
    () => verifyWebhookSignature({ payloadBody: body, signatureHeader: oracleSignature(body, otherSecret), secret }),
    /does not match/
  );
});

const badInputCases = [
  ['missing header', { payloadBody: body, signatureHeader: undefined, secret }],
  ['empty header', { payloadBody: body, signatureHeader: '', secret }],
  ['wrong scheme', { payloadBody: body, signatureHeader: 'sha1=deadbeef', secret }],
  ['non-hex digest', { payloadBody: body, signatureHeader: `${SIGNATURE_PREFIX}zzzz`, secret }],
  ['odd-length hex', { payloadBody: body, signatureHeader: `${SIGNATURE_PREFIX}abc`, secret }],
  ['empty body', { payloadBody: '', signatureHeader: oracleSignature('', secret), secret }],
  ['object body', { payloadBody: { a: 1 }, signatureHeader: oracleSignature(body, secret), secret }],
  ['empty secret', { payloadBody: body, signatureHeader: oracleSignature(body, ''), secret: '' }],
];

for (const [name, args] of badInputCases) {
  test(`malformed input rejected as BAD_SIGNATURE_INPUT: ${name}`, () => {
    assert.throws(
      () => verifyWebhookSignature(args),
      (err) => err instanceof GithubAdapterError && err.code === AdapterErrorCodes.BAD_SIGNATURE_INPUT
    );
  });
}

test('error messages never contain the secret', () => {
  try {
    verifyWebhookSignature({ payloadBody: Buffer.alloc(0), signatureHeader: 'sha256=00', secret: 's3cret-frag' });
    assert.fail('expected throw');
  } catch (err) {
    assert.ok(!String(err.message + JSON.stringify(err.details ?? {})).includes('s3cret-frag'));
  }
});
