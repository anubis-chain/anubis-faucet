import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../logger.js';
import { parseSecretDocument } from '../secret-values.js';

test('accepts only the canonical Secrets Manager JSON schema', () => {
  const secret = parseSecretDocument(JSON.stringify({
    privateKey: `0x${'1'.repeat(64)}`,
    turnstileSecret: 'turnstile-secret',
    ipPepper: 'p'.repeat(32),
  }));
  assert.equal(secret.privateKey, `0x${'1'.repeat(64)}`);
  for (const value of [
    '{}',
    JSON.stringify({ privateKey: 'bad', turnstileSecret: 'turnstile-secret', ipPepper: 'p'.repeat(32) }),
    JSON.stringify({ privateKey: `0x${'0'.repeat(64)}`, turnstileSecret: 'turnstile-secret', ipPepper: 'p'.repeat(32) }),
    JSON.stringify({ privateKey: '0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141', turnstileSecret: 'turnstile-secret', ipPepper: 'p'.repeat(32) }),
    JSON.stringify({ privateKey: `0x${'1'.repeat(64)}`, turnstileSecret: '', ipPepper: 'p'.repeat(32) }),
    JSON.stringify({ privateKey: `0x${'1'.repeat(64)}`, turnstileSecret: 'REPLACE_WITH_TURNSTILE_SECRET_KEY', ipPepper: 'p'.repeat(32) }),
    JSON.stringify({ privateKey: `0x${'1'.repeat(64)}`, turnstileSecret: '1x0000000000000000000000000000000AA', ipPepper: 'p'.repeat(32) }),
    JSON.stringify({ privateKey: `0x${'1'.repeat(64)}`, turnstileSecret: '2x0000000000000000000000000000000AA', ipPepper: 'p'.repeat(32) }),
    JSON.stringify({ privateKey: `0x${'1'.repeat(64)}`, turnstileSecret: '3x0000000000000000000000000000000AA', ipPepper: 'p'.repeat(32) }),
    JSON.stringify({ privateKey: `0x${'1'.repeat(64)}`, turnstileSecret: 'turnstile-secret', ipPepper: 'short' }),
  ]) assert.throws(() => parseSecretDocument(value));
});

test('structured logger drops unapproved and secret-bearing fields', () => {
  const lines = [];
  const sink = { log: value => lines.push(value), warn: value => lines.push(value), error: value => lines.push(value) };
  const logger = createLogger(sink, () => '2026-09-11T00:00:00.000Z');
  logger.error('failed', {
    requestId: 'r1', code: 'SAFE', privateKey: `0x${'1'.repeat(64)}`,
    rawTx: '0xdead', ip: '192.0.2.1', token: 'captcha', error: new Error('sensitive'),
  });
  assert.equal(typeof lines[0], 'object');
  assert.deepEqual(lines[0], { timestamp: '2026-09-11T00:00:00.000Z', level: 'error', event: 'failed', requestId: 'r1', code: 'SAFE' });
});
