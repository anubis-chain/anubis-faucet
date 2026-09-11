import test from 'node:test';
import assert from 'node:assert/strict';
import { createFaucetService, createReconcileService } from '../service.js';
import { memoryLogger } from './helpers.js';

function claimFixture(overrides = {}) {
  const calls = [];
  const logger = memoryLogger();
  const claim = {
    claimId: '12345678-1234-4234-8234-123456789012',
    address: '0x1111111111111111111111111111111111111111',
    ipHash: 'a'.repeat(64), tokenHash: 'b'.repeat(64), day: '2026-09-11', status: 'preparing',
  };
  const store = {
    health: async () => calls.push('health'),
    expirePreparing: async () => { calls.push('expire'); return false; },
    reserve: async input => { calls.push(['reserve', input]); return claim; },
    fail: async (...args) => { calls.push(['fail', ...args]); return true; },
    saveSigned: async (_claim, signed) => {
      calls.push(['saveSigned', signed]);
      return { ...claim, status: 'signed', rawTx: signed.raw, txHash: signed.hash, signerAddress: signed.signerAddress };
    },
    ...overrides.store,
  };
  const secrets = {
    get: async () => {
      calls.push('secrets');
      return { privateKey: `0x${'1'.repeat(64)}`, turnstileSecret: 'turnstile-secret', ipPepper: 'p'.repeat(32) };
    },
  };
  const verifier = { verify: async (...args) => calls.push(['verify', ...args]) };
  const sender = {
    health: async privateKey => {
      calls.push(['senderHealth', privateKey]);
      return {
        chainId: 202601,
        tokenAddress: '0x3333333333333333333333333333333333333333',
        senderAddress: '0x2222222222222222222222222222222222222222',
      };
    },
    prepare: async () => {
      calls.push('prepare');
      return { raw: '0xraw', hash: `0x${'c'.repeat(64)}`, signerAddress: '0x2222222222222222222222222222222222222222' };
    },
    broadcast: async (...args) => calls.push(['broadcast', ...args]),
    ...overrides.sender,
  };
  const config = {
    faucetEnabled: overrides.enabled ?? true,
    allowedClaimAddress: overrides.allowedClaimAddress ?? null,
  };
  const service = createFaucetService({ config, store, secrets, verifier, sender, logger, now: () => 1000, uuid: () => claim.claimId });
  return { service, store, sender, logger, calls, claim };
}

test('health verifies storage, secret-derived signer and funding without exposing secrets', async () => {
  const fixture = claimFixture({ enabled: false });
  const result = await fixture.service.health();
  assert.deepEqual(result, {
    ok: true,
    enabled: false,
    chainId: 202601,
    tokenAddress: '0x3333333333333333333333333333333333333333',
    senderAddress: '0x2222222222222222222222222222222222222222',
  });
  assert.ok(!JSON.stringify(result).includes('1111111111111111111111111111111111111111111111111111111111111111'));
  assert.ok(fixture.calls.some(call => Array.isArray(call) && call[0] === 'senderHealth'));
});

test('claim verifies, atomically reserves, durably saves raw bytes, then broadcasts', async () => {
  const fixture = claimFixture();
  const result = await fixture.service.claim({ recipientAddress: fixture.claim.address.toUpperCase().replace('0X', '0x'), turnstileToken: 'token' }, '192.0.2.1');
  assert.deepEqual(result, { status: 'submitted', txHashes: [`0x${'c'.repeat(64)}`] });
  const names = fixture.calls.map(call => Array.isArray(call) ? call[0] : call);
  assert.ok(names.indexOf('saveSigned') < names.indexOf('broadcast'));
  const reserve = fixture.calls.find(call => Array.isArray(call) && call[0] === 'reserve')[1];
  assert.match(reserve.ipHash, /^[\da-f]{64}$/);
  assert.match(reserve.tokenHash, /^[\da-f]{64}$/);
  assert.ok(!JSON.stringify(reserve).includes('192.0.2.1'));
});

test('disabled mode rejects before secrets, verification, reservation or signing', async () => {
  const fixture = claimFixture({ enabled: false });
  await assert.rejects(fixture.service.claim({ recipientAddress: fixture.claim.address, turnstileToken: 'token' }, '192.0.2.1'), error => error.code === 'FAUCET_DISABLED');
  assert.deepEqual(fixture.calls, []);
});

test('single-recipient mode rejects another address before secrets, verification, reservation or signing', async () => {
  const fixture = claimFixture({ allowedClaimAddress: '0x2222222222222222222222222222222222222222' });
  await assert.rejects(
    fixture.service.claim({ recipientAddress: fixture.claim.address, turnstileToken: 'token' }, '192.0.2.1'),
    error => error.code === 'RECIPIENT_NOT_ALLOWED' && error.status === 403,
  );
  assert.deepEqual(fixture.calls, []);
});

test('unexpected dependency failures log only a safe stage and error class', async () => {
  const fixture = claimFixture({
    store: {
      reserve: async () => {
        throw Object.assign(new Error('sensitive upstream detail'), { name: 'ValidationException' });
      },
    },
  });
  await assert.rejects(
    fixture.service.claim({ recipientAddress: fixture.claim.address, turnstileToken: 'token' }, '192.0.2.1'),
    error => error.name === 'ValidationException',
  );
  assert.ok(fixture.logger.records.some(record => record.event === 'claim_dependency_failed'
    && record.operation === 'reserve_claim' && record.code === 'ValidationException'));
  assert.ok(!JSON.stringify(fixture.logger.records).includes('sensitive upstream detail'));
});

test('preparation failure atomically releases state and never broadcasts', async () => {
  const fixture = claimFixture({ sender: { prepare: async () => { throw new Error('secret upstream detail'); } } });
  await assert.rejects(fixture.service.claim({ recipientAddress: fixture.claim.address, turnstileToken: 'token' }, '192.0.2.1'), error => error.code === 'TRANSFER_PREPARATION_FAILED');
  assert.ok(fixture.calls.some(call => Array.isArray(call) && call[0] === 'fail'));
  assert.ok(!fixture.calls.some(call => Array.isArray(call) && call[0] === 'broadcast'));
  assert.ok(!JSON.stringify(fixture.logger.records).includes('secret upstream detail'));
});

test('uncertain signed persistence never broadcasts or tries to release the lock', async () => {
  const fixture = claimFixture({ store: { saveSigned: async () => { throw Object.assign(new Error('timeout'), { code: 'STATE_CONFLICT' }); } } });
  await assert.rejects(fixture.service.claim({ recipientAddress: fixture.claim.address, turnstileToken: 'token' }, '192.0.2.1'), error => error.code === 'SIGNING_STATE_UNCERTAIN');
  const names = fixture.calls.map(call => Array.isArray(call) ? call[0] : call);
  assert.ok(!names.includes('broadcast'));
  assert.ok(!names.includes('fail'));
});

test('broadcast ambiguity still returns the durable hash for scheduled replay', async () => {
  const fixture = claimFixture({ sender: { broadcast: async () => { throw new Error('timeout'); } } });
  const result = await fixture.service.claim({ recipientAddress: fixture.claim.address, turnstileToken: 'token' }, '192.0.2.1');
  assert.equal(result.txHashes[0], `0x${'c'.repeat(64)}`);
  assert.ok(fixture.logger.records.some(record => record.event === 'broadcast_deferred'));
});

function reconcileFixture(receipt) {
  const calls = [];
  const logger = memoryLogger();
  const claim = {
    claimId: 'claim', status: 'signed', rawTx: '0xraw', txHash: `0x${'c'.repeat(64)}`,
    address: '0x1111111111111111111111111111111111111111', signerAddress: '0x2222222222222222222222222222222222222222',
  };
  const store = {
    expirePreparing: async () => false,
    activeClaim: async () => claim,
    confirm: async () => { calls.push('confirm'); return true; },
    fail: async () => { calls.push('fail'); return true; },
  };
  const sender = {
    receipt: async passed => { calls.push(['receipt', passed]); return receipt; },
    broadcast: async (...args) => calls.push(['broadcast', ...args]),
  };
  return { reconciler: createReconcileService({ store, sender, logger, now: () => 1000 }), calls, claim };
}

test('reconciler only replays the exact persisted raw transaction when no receipt exists', async () => {
  const fixture = reconcileFixture(null);
  assert.equal((await fixture.reconciler.run()).status, 'rebroadcast');
  assert.deepEqual(fixture.calls[1], ['broadcast', fixture.claim.rawTx, {
    hash: fixture.claim.txHash, recipient: fixture.claim.address, signerAddress: fixture.claim.signerAddress,
  }]);
});

test('reconciler confirms exact success, releases explicit revert, and waits for confirmations', async () => {
  for (const [receipt, expectedCall, status] of [
    [{ status: 'success' }, 'confirm', 'confirmed'],
    [{ status: 'reverted' }, 'fail', 'failed'],
    [{ status: 'included' }, null, 'confirming'],
  ]) {
    const fixture = reconcileFixture(receipt);
    assert.equal((await fixture.reconciler.run()).status, status);
    assert.equal(fixture.calls.includes('confirm'), expectedCall === 'confirm');
    assert.equal(fixture.calls.includes('fail'), expectedCall === 'fail');
  }
});

test('reconcile does not need current Secrets Manager values and keeps ambiguous receipts locked', async () => {
  const fixture = reconcileFixture(null);
  fixture.reconciler = createReconcileService({
    store: { expirePreparing: async () => false, activeClaim: async () => fixture.claim },
    sender: { receipt: async () => { throw new Error('wrong event'); } },
    logger: memoryLogger(), now: () => 1000,
  });
  await assert.rejects(fixture.reconciler.run(), /wrong event/);
  assert.ok(!fixture.calls.includes('confirm'));
  assert.ok(!fixture.calls.includes('fail'));
});
