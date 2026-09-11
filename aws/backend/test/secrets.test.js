import test from 'node:test';
import assert from 'node:assert/strict';
import { SecretsProvider } from '../secrets.js';

const secret = suffix => JSON.stringify({
  privateKey: `0x${suffix.repeat(64)}`,
  turnstileSecret: `turnstile-${suffix}`,
  ipPepper: suffix.repeat(32),
});

test('Secrets Manager provider is single-flight, caches only successes and refreshes after TTL', async () => {
  let now = 1000;
  let calls = 0;
  const client = { send: async command => {
    assert.equal(command.input.SecretId, 'secret-id');
    calls++;
    await Promise.resolve();
    return { SecretString: secret(calls === 1 ? '1' : '2') };
  } };
  const provider = new SecretsProvider({ client, secretId: 'secret-id', cacheMs: 100, now: () => now });
  const [a, b] = await Promise.all([provider.get(), provider.get()]);
  assert.equal(calls, 1);
  assert.strictEqual(a, b);
  assert.equal((await provider.get()).privateKey, `0x${'1'.repeat(64)}`);
  now += 101;
  assert.equal((await provider.get()).privateKey, `0x${'2'.repeat(64)}`);
  assert.equal(calls, 2);
});

test('failed or invalid secret loads are not cached and never echo secret contents', async () => {
  let calls = 0;
  const client = { send: async () => {
    calls++;
    if (calls === 1) throw new Error('upstream contains PRIVATE-VALUE');
    return { SecretString: '{"privateKey":"PRIVATE-VALUE"}' };
  } };
  const provider = new SecretsProvider({ client, secretId: 'secret-id', cacheMs: 100 });
  await assert.rejects(provider.get(), /PRIVATE-VALUE/);
  await assert.rejects(provider.get(), error => !error.message.includes('PRIVATE-VALUE'));
  assert.equal(calls, 2);
});
