import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { ClaimStore } from '../../worker/store.js';
import { createService } from '../../worker/service.js';
import { createVerifier } from '../../worker/turnstile.js';
import { handleApi, normalizeIp } from '../../worker/http.js';
import { loadConfig, recipient } from '../../worker/config.js';

let mf, db;
before(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("ok"); } };', compatibilityDate: '2026-09-09', d1Databases: ['DB'] }));
  db = await mf.getD1Database('DB');
  const sql = readFileSync('worker/migrations/0001_claims.sql', 'utf8').replace(/--[^\n]*/g, '');
  await db.batch(sql.split(';').filter(statement => statement.trim()).map(statement => db.prepare(statement)));
});
after(async () => { await mf?.dispose(); });
const address = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
const hash = `0x${'a'.repeat(64)}`;
const ip = '203.0.113.1';
const day = 86400000;
const cfConfig = { allowedOrigins: [], turnstileSecret: 'test-secret', turnstile: { hostnames: ['faucet.example'], action: 'faucet_claim' } };
const good = { success: true, hostname: 'faucet.example', action: 'faucet_claim' };
async function setup() {
  await db.prepare('DELETE FROM claims').run();
  let now = 1000000000;
  let calls = 0;
  const newStore = () => new ClaimStore(db, day, () => now);
  let store = newStore();
  const sender = { async prepare() { calls++; return { raw: '0x1234', hash }; }, async broadcast() { return hash; }, async receipt() { return null; } };
  const service = () => createService({ store, sender, verify: async () => {} });
  return { sender, service, newStore, get store() { return store; }, get calls() { return calls; }, advance(ms) { now += ms; }, reopen() { store = newStore(); } };
}

test('D1 enforces address OR IP cooldown for 24 hours across independent sessions', async () => {
  const f = await setup();
  const response = await f.service().claim({ recipientAddress: address, turnstileToken: 'a' }, ip);
  assert.equal(response.status, 'submitted');
  await f.store.finish((await f.store.pending()).id, true);
  f.reopen();
  await assert.rejects(f.service().claim({ recipientAddress: address, turnstileToken: 'b' }, '203.0.113.2'), { status: 429, retryAfter: 86400 });
  await assert.rejects(f.service().claim({ recipientAddress: other, turnstileToken: 'c' }, ip), { status: 429 });
  f.advance(day - 1);
  await assert.rejects(f.service().claim({ recipientAddress: address, turnstileToken: 'd' }, ip), { status: 429 });
  f.advance(1);
  await f.service().claim({ recipientAddress: address, turnstileToken: 'e' }, ip);
  assert.equal(f.calls, 2);
});

test('concurrent Worker sessions cannot reserve twice for the same address or IP', async () => {
  const f = await setup();
  const outcomes = await Promise.allSettled(Array.from({ length: 12 }, (_, n) => createService({ store: f.newStore(), sender: f.sender, verify: async () => {} }).claim({ recipientAddress: address, turnstileToken: `t${n}` }, ip)));
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(f.calls, 1);
});

test('different recipients and IPs still share one durable signing slot', async () => {
  const f = await setup();
  const outcomes = await Promise.allSettled([f.newStore().reserve(address, ip, 'a'), f.newStore().reserve(other, '203.0.113.2', 'b')]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM claims WHERE status='preparing'").first()).n, 1);
});

test('Turnstile failure cannot reserve or send funds', async () => {
  const f = await setup();
  const service = createService({ store: f.store, sender: f.sender, verify: async () => { throw new Error('rejected'); } });
  await assert.rejects(service.claim({ recipientAddress: address, turnstileToken: 'x' }, ip));
  assert.equal(f.calls, 0);
  assert.equal(await f.store.pending(), null);
});

test('failed preparation releases allowance but cannot reuse a token', async () => {
  const f = await setup();
  const original = f.sender.prepare;
  f.sender.prepare = async () => { throw new Error('insufficient funds SECRET SHOULD NOT LEAK'); };
  await assert.rejects(f.service().claim({ recipientAddress: address, turnstileToken: 'one' }, ip), { status: 503, message: 'The faucet cannot prepare a transfer. Please try again later.' });
  assert.equal(await f.store.pending(), null);
  f.sender.prepare = original;
  await assert.rejects(f.service().claim({ recipientAddress: address, turnstileToken: 'one' }, ip), { status: 400 });
  await f.service().claim({ recipientAddress: address, turnstileToken: 'two' }, ip);
});

test('RPC ambiguity and Worker restart only rebroadcast persisted signed bytes', async () => {
  const f = await setup();
  const sent = [];
  f.sender.broadcast = async raw => { sent.push(raw); throw new Error('timeout after acceptance'); };
  await f.service().claim({ recipientAddress: address, turnstileToken: 'one' }, ip);
  f.reopen();
  await assert.rejects(f.service().settle(), /timeout/);
  assert.deepEqual(sent, ['0x1234', '0x1234']);
  assert.equal(f.calls, 1);
  f.advance(day * 2);
  await assert.rejects(f.service().claim({ recipientAddress: other, turnstileToken: 'two' }, '203.0.113.2'), { status: 503 });
  f.sender.receipt = async () => ({ status: 'success' });
  await f.service().settle();
  await assert.rejects(f.service().claim({ recipientAddress: address, turnstileToken: 'three' }, ip), { status: 429, retryAfter: 86400 });
});

test('unsigned leases expire, but a stale Worker can no longer save or broadcast', async () => {
  const f = await setup();
  const id = await f.store.reserve(address, ip, 'one');
  f.advance(300000);
  f.reopen();
  await f.store.expireUnsigned();
  await assert.rejects(f.store.saveSigned(id, '0x1234', hash), { status: 503 });
  await f.service().claim({ recipientAddress: address, turnstileToken: 'two' }, ip);
  assert.equal(f.calls, 1);
});

test('signing that finishes after its lease cannot reach broadcast', async () => {
  const f = await setup();
  let broadcast = 0;
  f.sender.prepare = async () => { f.advance(300001); return { raw: '0x1234', hash }; };
  f.sender.broadcast = async () => { broadcast++; };
  await assert.rejects(f.service().claim({ recipientAddress: address, turnstileToken: 'one' }, ip), { status: 503 });
  assert.equal(broadcast, 0);
});

test('reverted transactions permit retry and concurrent reconciliation cannot reopen finished state', async () => {
  const f = await setup();
  await f.service().claim({ recipientAddress: address, turnstileToken: 'one' }, ip);
  const id = (await f.store.pending()).id;
  await f.store.finish(id, true);
  await f.newStore().finish(id, false);
  await assert.rejects(f.service().claim({ recipientAddress: address, turnstileToken: 'two' }, ip), { status: 429 });
  f.advance(day);
  await f.service().claim({ recipientAddress: address, turnstileToken: 'three' }, ip);
  f.sender.receipt = async () => ({ status: 'reverted' });
  await f.service().settle();
  await f.service().claim({ recipientAddress: address, turnstileToken: 'four' }, ip);
});

test('normalizes address case and rejects zero addresses, ENS and invalid input', () => {
  assert.equal(recipient('0xABCDabcdABCDabcdABCDabcdABCDabcdABCDabcd'), '0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd');
  for (const value of [null, 1, 'vitalik.eth', '0x123', `0x${'0'.repeat(40)}`]) assert.equal(recipient(value), null);
});

test('Turnstile validates secret, token, IP, hostname and action server-side', async () => {
  let request;
  const verify = createVerifier(cfConfig, async (url, init) => { request = { url, body: JSON.parse(init.body) }; return { ok: true, json: async () => good }; });
  await verify('one-time-token', ip);
  assert.equal(request.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.deepEqual(request.body, { secret: 'test-secret', response: 'one-time-token', remoteip: ip });
});

for (const [name, result] of [['replay', { ...good, success: false }], ['wrong hostname', { ...good, hostname: 'attacker.example' }], ['wrong action', { ...good, action: 'login' }]]) {
  test(`Turnstile rejects ${name}`, async () => {
    await assert.rejects(createVerifier(cfConfig, async () => ({ ok: true, json: async () => result }))('token', ip), { status: 400 });
  });
}

test('Turnstile rejects missing/oversized tokens and fails closed on outage', async () => {
  let count = 0;
  const verify = createVerifier(cfConfig, async () => { count++; throw new Error('network unavailable'); });
  for (const token of [undefined, '', 'a'.repeat(2049)]) await assert.rejects(verify(token, ip), { status: 400 });
  assert.equal(count, 0);
  await assert.rejects(verify('token', ip), { status: 503 });
});

test('canonical IP identities unify mapped IPv4 and alternate IPv6 spellings', () => {
  assert.equal(normalizeIp('::ffff:192.0.2.1'), '192.0.2.1');
  assert.equal(normalizeIp('::ffff:c000:201'), '192.0.2.1');
  assert.equal(normalizeIp('2001:0db8:0:0:0:0:0:1'), normalizeIp('2001:db8::1'));
});

test('Worker API uses only Cloudflare IP and integrates D1 limits, validation and CORS', async () => {
  const f = await setup();
  const service = createService({ store: f.store, sender: f.sender, verify: createVerifier(cfConfig, async () => ({ ok: true, json: async () => good })) });
  const send = (body, headers = {}, method = 'POST', path = '/api/distribute') => handleApi(new Request(`https://faucet.example${path}`, { method, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...headers }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) }), cfConfig, service);
  assert.equal((await send({}, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await send({ recipientAddress: 'vitalik.eth', turnstileToken: 't' })).status, 400);
  assert.equal((await send({}, { 'CF-Connecting-IP': '', 'X-Real-IP': '8.8.8.8' })).status, 400);
  const response = await send({ recipientAddress: address, turnstileToken: 'one', amount: '999', ip: '8.8.8.8' });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { status: 'submitted', txHashes: [hash] });
  const repeat = await send({ recipientAddress: other, turnstileToken: 'two' }, { 'X-Real-IP': '8.8.8.8', 'X-Forwarded-For': '8.8.8.8' });
  assert.equal(repeat.status, 429);
  assert.ok(Number(repeat.headers.get('retry-after')) > 0);
  assert.equal((await send({}, {}, 'GET')).status, 405);
  assert.equal((await send({}, {}, 'GET', '/api/private')).status, 404);
  assert.equal((await send({}, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await send({ text: 'a'.repeat(8193) })).status, 413);
});

test('configuration requires secrets, real network, exact action and positive payout', () => {
  const network = { chain: { id: 31337, rpcUrl: 'http://127.0.0.1:8545', nativeCurrency: { name: 'Test', symbol: 'TEST', decimals: 18 } }, tokens: [{ address: other, name: 'DAI', symbol: 'DAI', decimals: 18 }], distribution: { nativeAmount: '', tokenAmount: '1', rateLimitHours: '24' } };
  const env = { FAUCET_PRIVATE_KEY: `0x${'1'.repeat(64)}`, TURNSTILE_SECRET_KEY: 'test' };
  assert.equal(loadConfig(env, network, cfConfig).amount, 10n ** 18n);
  assert.throws(() => loadConfig({ ...env, FAUCET_PRIVATE_KEY: '' }, network, cfConfig), /FAUCET_PRIVATE_KEY/);
  assert.throws(() => loadConfig({ ...env, TURNSTILE_SECRET_KEY: '' }, network, cfConfig), /TURNSTILE_SECRET_KEY/);
  assert.throws(() => loadConfig(env, network, { ...cfConfig, turnstile: { ...cfConfig.turnstile, action: 'login' } }), /action/);
  network.distribution.tokenAmount = '0';
  assert.throws(() => loadConfig(env, network, cfConfig), /positive/);
  network.distribution.tokenAmount = '1';
  for (const bad of [
    { ...network, tokens: [] },
    { ...network, tokens: [...network.tokens, ...network.tokens] },
    { ...network, tokens: [{ ...network.tokens[0], address: `0x${'0'.repeat(40)}` }] },
    { ...network, tokens: [{ ...network.tokens[0], decimals: -1 }] },
    { ...network, distribution: { ...network.distribution, nativeAmount: '1' } },
    { ...network, distribution: { ...network.distribution, tokenAmount: '0.0000000000000000001' } },
    { ...network, distribution: { ...network.distribution, tokenAmount: String(2n ** 256n) } },
  ]) assert.throws(() => loadConfig(env, bad, cfConfig), /Invalid faucet configuration/);
  assert.equal(loadConfig(env, { ...network, tokens: [{ ...network.tokens[0], decimals: 6 }] }, cfConfig).amount, 1000000n);
  network.chain.id = null;
  assert.throws(() => loadConfig(env, network, cfConfig), /chain ID/);
});

test('an ambiguous ERC-20 receipt keeps the signing slot and cannot permit another payout', async () => {
  const f = await setup();
  await f.service().claim({ recipientAddress: address, turnstileToken: 'one' }, ip);
  f.sender.receipt = async (txHash, to) => {
    assert.equal(txHash, hash);
    assert.equal(to, address);
    throw new Error('missing expected Transfer event');
  };
  await assert.rejects(f.service().settle(), /Transfer event/);
  assert.equal((await f.store.pending()).status, 'signed');
  await assert.rejects(f.service().claim({ recipientAddress: other, turnstileToken: 'two' }, '203.0.113.2'), { status: 503 });
  assert.equal(f.calls, 1);
});
