import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { parseTransaction, recoverTransactionAddress, keccak256, erc20Abi, decodeFunctionData, encodeFunctionResult, encodeEventTopics, encodeAbiParameters } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createSender } from '../../worker/sender.js';

// Public, unfunded test key; every RPC request stays on the local mock server.
const privateKey = `0x${'1'.repeat(64)}`;
const account = privateKeyToAccount(privateKey);
const recipient = '0x2222222222222222222222222222222222222222';
const tokenAddress = '0x3333333333333333333333333333333333333333';
const hash = `0x${'a'.repeat(64)}`;

async function fixture(t) {
  const requests = [];
  const state = { decimals: 18, transfer: true, revert: false, empty: false, receipt: null };
  const rpc = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    requests.push(request);
    const results = {
      eth_chainId: '0x7a69', eth_getTransactionCount: '0x7', eth_estimateGas: '0x10000', eth_gasPrice: '0x3b9aca00',
      eth_getBlockByNumber: { number: '0x1', hash, timestamp: '0x1', gasLimit: '0x1c9c380', gasUsed: '0x0', transactions: [] },
      eth_getTransactionReceipt: state.receipt,
    };
    let error;
    if (request.method === 'eth_call') {
      const call = decodeFunctionData({ abi: erc20Abi, data: request.params[0].data });
      if (state.revert && call.functionName === 'transfer') error = { code: 3, message: 'execution reverted: insufficient balance' };
      results.eth_call = state.empty ? '0x' : encodeFunctionResult({ abi: erc20Abi, functionName: call.functionName, result: call.functionName === 'decimals' ? state.decimals : state.transfer });
    }
    if (request.method === 'eth_sendRawTransaction') results.eth_sendRawTransaction = keccak256(request.params[0]);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...(error ? { error } : request.method in results ? { result: results[request.method] } : { error: { code: -32601, message: `Unknown method ${request.method}` } }) }));
  });
  await new Promise(resolve => rpc.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => rpc.close(resolve)));
  const config = { privateKey, amount: 10n ** 18n, token: { address: tokenAddress, name: 'DAI', symbol: 'DAI', decimals: 18 }, faucet: { chain: { id: 31337, rpcUrl: `http://127.0.0.1:${rpc.address().port}`, nativeCurrency: { name: 'Test', symbol: 'TEST', decimals: 18 } } } };
  return { config, sender: createSender(config), requests, state };
}

test('signs exactly 1 ERC-20 DAI to the recipient with zero native value and broadcasts exact bytes', async t => {
  const { config, sender, requests } = await fixture(t);
  const signed = await sender.prepare(recipient);
  const transaction = parseTransaction(signed.raw);
  assert.equal(transaction.to.toLowerCase(), tokenAddress);
  assert.equal(transaction.value ?? 0n, 0n);
  assert.deepEqual(decodeFunctionData({ abi: erc20Abi, data: transaction.data }), { functionName: 'transfer', args: [recipient, 10n ** 18n] });
  assert.equal(transaction.chainId, 31337);
  assert.equal(transaction.nonce, 7);
  assert.equal(await recoverTransactionAddress({ serializedTransaction: signed.raw }), account.address);
  assert.equal(await sender.broadcast(signed.raw), signed.hash);
  assert.equal(requests.find(request => request.method === 'eth_sendRawTransaction').params[0], signed.raw);
  assert.equal(await sender.receipt(signed.hash, recipient), null);
  assert.ok(!JSON.stringify(requests).includes(privateKey.slice(2)));
  const wrong = createSender({ ...config, faucet: { chain: { ...config.faucet.chain, id: 999 } } });
  await assert.rejects(wrong.prepare(recipient), /chain ID does not match/);
});

test('rejects mismatched token decimals, false transfers, reverts and empty contracts before signing', async t => {
  const { sender, state, requests } = await fixture(t);
  state.decimals = 6;
  await assert.rejects(sender.prepare(recipient), /decimals do not match/);
  state.decimals = 18;
  state.transfer = false;
  await assert.rejects(sender.prepare(recipient), /did not return true/);
  state.transfer = true;
  state.revert = true;
  await assert.rejects(sender.prepare(recipient), /insufficient balance/);
  state.revert = false;
  state.empty = true;
  await assert.rejects(sender.prepare(recipient));
  assert.equal(requests.filter(r => ['eth_estimateGas', 'eth_sendRawTransaction'].includes(r.method)).length, 0);
});

function transferLog({ address = tokenAddress, from = account.address, to = recipient, amount = 10n ** 18n } = {}) {
  return { address, topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from, to } }), data: encodeAbiParameters([{ type: 'uint256' }], [amount]), blockHash: hash, blockNumber: '0x1', transactionHash: hash, transactionIndex: '0x0', logIndex: '0x0', removed: false };
}

test('confirms only matching ERC-20 Transfer events and leaves ambiguous successful receipts unresolved', async t => {
  const { sender, state } = await fixture(t);
  state.receipt = { transactionHash: hash, transactionIndex: '0x0', blockHash: hash, blockNumber: '0x1', from: account.address, to: tokenAddress, cumulativeGasUsed: '0x10000', gasUsed: '0x10000', effectiveGasPrice: '0x1', contractAddress: null, logsBloom: `0x${'0'.repeat(512)}`, status: '0x1', type: '0x0', logs: [transferLog()] };
  assert.equal((await sender.receipt(hash, recipient)).status, 'success');
  for (const logs of [[], [transferLog({ address: recipient })], [transferLog({ from: recipient })], [transferLog({ to: account.address })], [transferLog({ amount: 1n })]]) {
    state.receipt.logs = logs;
    await assert.rejects(sender.receipt(hash, recipient), /missing the expected ERC-20 Transfer/);
  }
  state.receipt.status = '0x0';
  assert.equal((await sender.receipt(hash, recipient)).status, 'reverted');
});
