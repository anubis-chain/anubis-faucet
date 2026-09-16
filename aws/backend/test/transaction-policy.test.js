import test from 'node:test';
import assert from 'node:assert/strict';
import { assertFeePolicy, assertTransferEnvelope } from '../transaction-policy.js';

const policy = {
  maxGasLimit: 100000n,
  maxFeePerGas: 100n,
  maxPriorityFeePerGas: 10n,
  maxTotalFee: 5000000n,
};
const envelope = {
  chainId: 202601,
  to: '0x1111111111111111111111111111111111111111',
  value: 0n,
  data: '0xaabb',
};

test('accepts exact ERC-20 envelope and bounded legacy or EIP-1559 fees', () => {
  assert.doesNotThrow(() => assertTransferEnvelope(envelope, { chainId: 202601, tokenAddress: envelope.to, expectedData: envelope.data }));
  assert.equal(assertFeePolicy({ gas: 21000n, gasPrice: 20n }, policy), 420000n);
  assert.equal(assertFeePolicy({ gas: 21000n, maxFeePerGas: 20n, maxPriorityFeePerGas: 2n }, policy), 420000n);
});

test('rejects any chain, token, value or calldata drift', () => {
  const expected = { chainId: 202601, tokenAddress: envelope.to, expectedData: envelope.data };
  for (const changed of [
    { ...envelope, chainId: 1 },
    { ...envelope, to: '0x2222222222222222222222222222222222222222' },
    { ...envelope, value: 1n },
    { ...envelope, data: '0xccdd' },
  ]) assert.throws(() => assertTransferEnvelope(changed, expected));
});

test('rejects missing, ambiguous and over-cap fee fields', () => {
  for (const transaction of [
    { gas: 0n, gasPrice: 1n },
    { gas: 100001n, gasPrice: 1n },
    { gas: 21000n },
    { gas: 21000n, gasPrice: 1n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n },
    { gas: 21000n, gasPrice: 101n },
    { gas: 21000n, maxFeePerGas: 20n },
    { gas: 21000n, maxFeePerGas: 20n, maxPriorityFeePerGas: 11n },
    { gas: 100000n, gasPrice: 100n },
  ]) assert.throws(() => assertFeePolicy(transaction, policy));
});
