import test from 'node:test';
import assert from 'node:assert/strict';
import { createTurnstileVerifier } from '../turnstile.js';

const config = { turnstileHostnames: ['faucet.example.test'], turnstileAction: 'faucet_claim' };

test('validates secret, one-time token, raw verification IP, hostname and action', async () => {
  let request;
  const verifier = createTurnstileVerifier(config, async (url, init) => {
    request = { url, body: JSON.parse(init.body) };
    return Response.json({ success: true, hostname: 'faucet.example.test', action: 'faucet_claim' });
  });
  await verifier.verify('one-time-token', '2001:db8:0:0:0:0:0:1', 'server-secret');
  assert.equal(request.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.deepEqual(request.body, { secret: 'server-secret', response: 'one-time-token', remoteip: '2001:db8:0:0:0:0:0:1' });
});

test('fails closed on missing token, wrong hostname/action and upstream outage', async () => {
  await assert.rejects(createTurnstileVerifier(config).verify('', '192.0.2.1', 'secret'), error => error.code === 'VERIFICATION_REQUIRED');
  for (const result of [
    { success: false, hostname: 'faucet.example.test', action: 'faucet_claim' },
    { success: true, hostname: 'evil.example', action: 'faucet_claim' },
    { success: true, hostname: 'faucet.example.test', action: 'login' },
  ]) {
    const verifier = createTurnstileVerifier(config, async () => Response.json(result));
    await assert.rejects(verifier.verify('token', '192.0.2.1', 'secret'), error => error.code === 'VERIFICATION_FAILED');
  }
  const unavailable = createTurnstileVerifier(config, async () => { throw new Error('network'); });
  await assert.rejects(unavailable.verify('token', '192.0.2.1', 'secret'), error => error.code === 'VERIFICATION_UNAVAILABLE');
});
