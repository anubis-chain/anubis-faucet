import test from 'node:test';
import assert from 'node:assert/strict';
import { DynamoClaimStore } from '../store.js';
import { planConfig } from './helpers.js';

const config = { ...planConfig, tableName: 'table' };
const claim = {
  claimId: '12345678-1234-4234-8234-123456789012',
  address: '0x1111111111111111111111111111111111111111',
  ipHash: 'a'.repeat(64), tokenHash: 'b'.repeat(64), day: '2026-09-11',
  status: 'preparing', leaseUntil: 2000,
};
const signed = {
  raw: '0xraw', hash: `0x${'c'.repeat(64)}`,
  signerAddress: '0x2222222222222222222222222222222222222222',
};

test('an uncertain signed write authorizes broadcast only after exact strong-read evidence', async () => {
  let transacted = false;
  const client = { send: async command => {
    if (command.constructor.name === 'TransactWriteCommand') {
      transacted = true;
      throw new Error('network timeout after commit');
    }
    assert.equal(command.input.ConsistentRead, true);
    if (command.input.Key.pk.startsWith('CLAIM#')) return { Item: { ...claim, status: 'signed', rawTx: signed.raw, txHash: signed.hash, signerAddress: signed.signerAddress } };
    return { Item: { pk: 'LOCK#ACTIVE', status: 'signed', ownerClaimId: claim.claimId, txHash: signed.hash } };
  } };
  const stored = await new DynamoClaimStore({ client, config }).saveSigned(claim, signed, 1000);
  assert.equal(transacted, true);
  assert.equal(stored.rawTx, signed.raw);
  assert.equal(stored.txHash, signed.hash);
});

test('an uncertain signed write without exact evidence remains fail-closed', async () => {
  const client = { send: async command => {
    if (command.constructor.name === 'TransactWriteCommand') throw new Error('timeout');
    return { Item: command.input.Key.pk === 'LOCK#ACTIVE'
      ? { status: 'preparing', ownerClaimId: claim.claimId }
      : { ...claim, status: 'preparing' } };
  } };
  await assert.rejects(new DynamoClaimStore({ client, config }).saveSigned(claim, signed, 1000), error => error.code === 'STATE_CONFLICT');
});

test('expired preparing cleanup treats a concurrent terminal transition as no-op', async () => {
  let gets = 0;
  const client = { send: async command => {
    if (command.constructor.name === 'GetCommand') {
      gets++;
      return gets === 1
        ? { Item: { pk: 'LOCK#ACTIVE', status: 'preparing', ownerClaimId: claim.claimId, leaseUntil: 999 } }
        : { Item: { ...claim, leaseUntil: 999 } };
    }
    throw Object.assign(new Error('conditional race'), { name: 'TransactionCanceledException' });
  } };
  assert.equal(await new DynamoClaimStore({ client, config }).expirePreparing(1000), false);
});

test('reservation conflict checks only cooldown, replay and active-lock records', async () => {
  const keys = [];
  const client = { send: async command => {
    keys.push(command.input.Key.pk);
    return {};
  } };
  const store = new DynamoClaimStore({ client, config });
  await store.throwReservationConflict({
    address: claim.address,
    ipHash: claim.ipHash,
    tokenHash: claim.tokenHash,
    now: 1000,
  });
  assert.deepEqual(keys, [
    `COOLDOWN#ADDRESS#${claim.address}`,
    `COOLDOWN#IP#${claim.ipHash}`,
    `REPLAY#TURNSTILE#${claim.tokenHash}`,
    'LOCK#ACTIVE',
  ]);
  assert.ok(keys.every(key => !key.startsWith('CAP#DAY#')));
});

test('health rejects a corrupt or mismatched active lock', async () => {
  const corrupt = new DynamoClaimStore({
    config,
    client: { send: async () => ({ Item: { pk: 'LOCK#ACTIVE', status: 'signed' } }) },
  });
  await assert.rejects(corrupt.health(), /corrupt/);

  let reads = 0;
  const mismatched = new DynamoClaimStore({
    config,
    client: { send: async () => {
      reads++;
      return reads === 1
        ? { Item: { pk: 'LOCK#ACTIVE', ownerClaimId: claim.claimId, status: 'signed', txHash: signed.hash } }
        : { Item: { ...claim, status: 'preparing' } };
    } },
  });
  await assert.rejects(mismatched.health(), /does not match/);
});
