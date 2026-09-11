import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, erc20Abi, keccak256 } from 'viem';
import { createErc20Sender } from '../sender.js';

const privateKey = `0x${'1'.repeat(64)}`;
const recipient = '0x2222222222222222222222222222222222222222';
const tokenAddress = '0x3333333333333333333333333333333333333333';
const code = '0x60006000';

function fixture() {
  const state = { tokenBalance: 2000000n, gas: 21000n, gasPrice: 2n, chainId: 202601, decimals: 18, simulation: true, receipt: null };
  const publicClient = {
    getChainId: async () => state.chainId,
    getBytecode: async () => code,
    readContract: async ({ functionName }) => functionName === 'decimals' ? state.decimals : state.tokenBalance,
    simulateContract: async () => ({ result: state.simulation }),
    estimateContractGas: async () => state.gas,
    getBalance: async () => { throw new Error('native balance must not be queried on pre-Aria Anubis'); },
    sendRawTransaction: async ({ serializedTransaction }) => keccak256(serializedTransaction),
    getTransactionReceipt: async () => {
      if (!state.receipt) throw Object.assign(new Error('not found'), { name: 'TransactionReceiptNotFoundError' });
      return state.receipt;
    },
    getBlockNumber: async () => 100n,
  };
  const walletFactory = account => ({
    prepareTransactionRequest: async request => ({
      to: request.to, value: request.value, data: request.data, chainId: 202601,
      nonce: 7, gas: state.gas, gasPrice: state.gasPrice, type: 'legacy',
    }),
    signTransaction: request => account.signTransaction(request),
  });
  const config = {
    chainId: 202601, chainName: 'Anubis Test', rpcUrl: 'https://rpc.example.test',
    nativeCurrencyName: 'DAI', nativeCurrencySymbol: 'DAI', nativeCurrencyDecimals: 18,
    tokenAddress, tokenCodeHash: keccak256(code), tokenDecimals: 18, tokenAmount: 1000n,
    maxGasLimit: 100000n, maxFeePerGas: 100n, maxPriorityFeePerGas: 10n,
    maxTotalFee: 1000000n, minConfirmations: 1,
  };
  return { sender: createErc20Sender(config, { publicClient, walletFactory }), state, config };
}

test('signs exact ERC-20 bytes only after code, simulation and DAI payout-plus-fee checks', async () => {
  const { sender, state } = fixture();
  const signed = await sender.prepare(recipient, privateKey);
  assert.match(signed.raw, /^0x[\da-f]+$/);
  assert.equal(signed.hash, keccak256(signed.raw));
  assert.match(signed.signerAddress, /^0x[\da-f]{40}$/);
  assert.equal(await sender.broadcast(signed.raw, { hash: signed.hash, recipient, signerAddress: signed.signerAddress }), signed.hash);
  state.tokenBalance = 1000n + 42000n - 1n;
  await assert.rejects(sender.prepare(recipient, privateKey), /DAI balance/);
});

test('health verifies the configured signer, DAI reserve, simulation and gas estimate', async () => {
  const { sender, state, config } = fixture();
  const result = await sender.health(privateKey);
  assert.equal(result.chainId, config.chainId);
  assert.equal(result.tokenAddress, config.tokenAddress);
  assert.match(result.senderAddress, /^0x[\da-f]{40}$/);
  state.tokenBalance = config.tokenAmount + config.maxTotalFee - 1n;
  await assert.rejects(sender.health(privateKey), /DAI balance/);
  state.tokenBalance = 2000000n;
  state.gas = config.maxGasLimit + 1n;
  await assert.rejects(sender.health(privateKey), /gas estimate/);
});

test('fails closed on chain, bytecode, decimals, simulation and fee-policy drift', async () => {
  for (const mutate of [
    state => { state.chainId = 1; },
    (_state, config) => { config.tokenCodeHash = `0x${'0'.repeat(64)}`; },
    state => { state.decimals = 6; },
    state => { state.simulation = false; },
    state => { state.gas = 100001n; },
    state => { state.gasPrice = 101n; },
  ]) {
    const { state, config } = fixture();
    mutate(state, config);
    const sender = createErc20Sender(config, {
      publicClient: {
        getChainId: async () => state.chainId,
        getBytecode: async () => code,
        readContract: async ({ functionName }) => functionName === 'decimals' ? state.decimals : state.tokenBalance,
        simulateContract: async () => ({ result: state.simulation }),
        estimateContractGas: async () => state.gas,
      },
      walletFactory: account => ({
        prepareTransactionRequest: async request => ({ ...request, account: undefined, chain: undefined, chainId: 202601, nonce: 7, gas: state.gas, gasPrice: state.gasPrice, type: 'legacy' }),
        signTransaction: request => account.signTransaction(request),
      }),
    });
    await assert.rejects(sender.prepare(recipient, privateKey));
  }
});

test('receipt requires the exact token, signer, recipient and amount event', async () => {
  const { sender, state, config } = fixture();
  const signed = await sender.prepare(recipient, privateKey);
  const transferLog = ({ from = signed.signerAddress, to = recipient, amount = config.tokenAmount, address = tokenAddress } = {}) => ({
    address,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from, to } }),
    data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
  });
  const claim = { rawTx: signed.raw, txHash: signed.hash, address: recipient, signerAddress: signed.signerAddress };
  state.receipt = { transactionHash: signed.hash, status: 'success', blockNumber: 10n, logs: [transferLog()] };
  assert.deepEqual(await sender.receipt(claim), { status: 'success' });
  for (const logs of [[], [transferLog({ to: tokenAddress })], [transferLog({ amount: 1n })], [transferLog({ address: recipient })]]) {
    state.receipt.logs = logs;
    await assert.rejects(sender.receipt(claim), /Transfer event/);
  }
  state.receipt.status = 'reverted';
  assert.deepEqual(await sender.receipt(claim), { status: 'reverted' });
});

test('replay rejects any persisted raw hash, recipient or signer mismatch before RPC broadcast', async () => {
  const { sender } = fixture();
  const signed = await sender.prepare(recipient, privateKey);
  for (const claim of [
    { hash: `0x${'0'.repeat(64)}`, recipient, signerAddress: signed.signerAddress },
    { hash: signed.hash, recipient: tokenAddress, signerAddress: signed.signerAddress },
    { hash: signed.hash, recipient, signerAddress: recipient },
  ]) await assert.rejects(sender.broadcast(signed.raw, claim));
});
