import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConfirmPlan,
  buildFailPlan,
  buildReservePlan,
  buildSaveSignedPlan,
  itemKey,
  secondsUntilNextUtcDay,
  utcDay,
} from '../store-plan.js';
import { planConfig } from './helpers.js';

const values = {
  tableName: 'table',
  claimId: '12345678-1234-4234-8234-123456789012',
  address: '0x1111111111111111111111111111111111111111',
  ipHash: 'a'.repeat(64),
  tokenHash: 'b'.repeat(64),
  now: 1789056000,
  config: planConfig,
};

test('reserve is one six-item transaction with distinct lock, cooldown, replay, cap and claim keys', () => {
  const { claim, input } = buildReservePlan(values);
  assert.equal(input.ClientRequestToken, values.claimId);
  assert.equal(input.TransactItems.length, 6);
  const keys = input.TransactItems.map(action => action.Put?.Item?.pk || action.Update?.Key?.pk);
  assert.equal(new Set(keys).size, 6);
  assert.deepEqual(keys, [
    'LOCK#ACTIVE',
    `COOLDOWN#ADDRESS#${values.address}`,
    `COOLDOWN#IP#${values.ipHash}`,
    `REPLAY#TURNSTILE#${values.tokenHash}`,
    `CAP#DAY#${utcDay(values.now)}`,
    `CLAIM#${values.claimId}`,
  ]);
  assert.equal(input.TransactItems[0].Put.ConditionExpression, 'attribute_not_exists(pk)');
  assert.match(input.TransactItems[4].Update.ConditionExpression, /claimCount < :cap/);
  assert.equal(input.TransactItems[4].Update.ExpressionAttributeValues[':cap'], 100);
  assert.equal(claim.ipHash, values.ipHash);
  assert.ok(!JSON.stringify(input).includes('192.0.2.1'));
});

test('saveSigned atomically persists raw bytes before changing all four active records', () => {
  const claim = buildReservePlan(values).claim;
  const input = buildSaveSignedPlan({
    tableName: values.tableName,
    claim,
    raw: '0xdeadbeef',
    hash: `0x${'c'.repeat(64)}`,
    signerAddress: '0x2222222222222222222222222222222222222222',
    now: values.now + 1,
    config: planConfig,
  });
  assert.equal(input.TransactItems.length, 4);
  assert.equal(input.ClientRequestToken.length, 36);
  assert.match(input.TransactItems[0].Update.UpdateExpression, /rawTx = :raw/);
  assert.match(input.TransactItems[0].Update.ConditionExpression, /leaseUntil > :now/);
  assert.equal(JSON.stringify(input).match(/0xdeadbeef/g)?.length, 1);
});

test('terminal transitions release exactly owned state and only failure refunds the UTC cap', () => {
  const claim = { ...buildReservePlan(values).claim, status: 'signed', txHash: `0x${'c'.repeat(64)}` };
  const failed = buildFailPlan({ tableName: 'table', claim, expectedStatus: 'signed', reason: 'TRANSACTION_REVERTED', now: values.now + 2, config: planConfig });
  const confirmed = buildConfirmPlan({ tableName: 'table', claim, now: values.now + 2, config: planConfig });
  assert.equal(failed.TransactItems.length, 5);
  assert.match(failed.TransactItems[4].Update.UpdateExpression, /claimCount :minusOne/);
  assert.equal(failed.TransactItems[4].Update.ExpressionAttributeValues[':minusOne'], -1);
  assert.equal(confirmed.TransactItems.length, 4);
  assert.ok(!JSON.stringify(confirmed).includes('claimCount'));
  assert.match(confirmed.TransactItems[0].Update.UpdateExpression, /REMOVE rawTx/);
});

test('UTC cap rolls at midnight and key helpers are deterministic', () => {
  const secondBefore = Date.UTC(2026, 8, 11, 23, 59, 59) / 1000;
  assert.equal(utcDay(secondBefore), '2026-09-11');
  assert.equal(secondsUntilNextUtcDay(secondBefore), 1);
  assert.deepEqual(itemKey.daily('2026-09-12'), { pk: 'CAP#DAY#2026-09-12' });
});
