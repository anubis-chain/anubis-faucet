import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  encodeFunctionData,
  erc20Abi,
  http,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { assertFeePolicy, assertTransferEnvelope } from './transaction-policy.js';

export function createErc20Sender(config, overrides = {}) {
  const chain = defineChain({
    id: config.chainId,
    name: config.chainName,
    nativeCurrency: {
      name: config.nativeCurrencyName,
      symbol: config.nativeCurrencySymbol,
      decimals: config.nativeCurrencyDecimals,
    },
    rpcUrls: { default: { http: [config.rpcUrl] } },
    testnet: true,
  });
  const transport = http(config.rpcUrl, { timeout: 10000, retryCount: 0 });
  const publicClient = overrides.publicClient || createPublicClient({ chain, transport });
  const walletFactory = overrides.walletFactory || (account => createWalletClient({ account, chain, transport }));
  const accountFactory = overrides.accountFactory || privateKeyToAccount;

  async function checkChainAndToken() {
    if (await publicClient.getChainId() !== config.chainId) throw new Error('RPC chain ID does not match the configured chain.');
    const code = await publicClient.getBytecode({ address: config.tokenAddress });
    if (!code || code === '0x') throw new Error('Configured token address has no contract code.');
    if (keccak256(code).toLowerCase() !== config.tokenCodeHash) throw new Error('Configured token bytecode hash does not match the approved contract.');
    const decimals = await publicClient.readContract({ address: config.tokenAddress, abi: erc20Abi, functionName: 'decimals' });
    if (decimals !== config.tokenDecimals) throw new Error('ERC-20 decimals do not match the configured token.');
  }

  async function validateRaw(raw, { hash, recipient, signerAddress }) {
    if (keccak256(raw).toLowerCase() !== hash.toLowerCase()) throw new Error('Persisted raw transaction does not match its hash.');
    const expectedData = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [recipient, config.tokenAmount],
    });
    const transaction = parseTransaction(raw);
    assertTransferEnvelope(transaction, { chainId: config.chainId, tokenAddress: config.tokenAddress, expectedData });
    assertFeePolicy(transaction, config);
    if ((await recoverTransactionAddress({ serializedTransaction: raw })).toLowerCase() !== signerAddress.toLowerCase()) {
      throw new Error('Persisted raw transaction signer does not match the claim.');
    }
  }

  return {
    async prepare(to, privateKey) {
      await checkChainAndToken();
      const account = accountFactory(privateKey);
      const tokenBalance = await publicClient.readContract({
        address: config.tokenAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account.address],
      });
      const transfer = { abi: erc20Abi, functionName: 'transfer', args: [to, config.tokenAmount] };
      const simulation = await publicClient.simulateContract({ ...transfer, address: config.tokenAddress, account });
      if (simulation.result !== true) throw new Error('ERC-20 transfer simulation did not return true.');
      const expectedData = encodeFunctionData(transfer);
      const wallet = walletFactory(account);
      const request = await wallet.prepareTransactionRequest({
        account,
        chain,
        to: config.tokenAddress,
        value: 0n,
        data: expectedData,
      });
      assertTransferEnvelope(request, { chainId: config.chainId, tokenAddress: config.tokenAddress, expectedData });
      const maximumCost = assertFeePolicy(request, config);
      // Anubis pre-Aria charges gas from the 18-decimal DAI balance. Keep one
      // payout plus the worst allowed fee available before signing.
      if (tokenBalance < config.tokenAmount + maximumCost) {
        throw new Error('Faucet wallet DAI balance cannot cover the payout and maximum transaction fee.');
      }

      const raw = await wallet.signTransaction(request);
      const transaction = parseTransaction(raw);
      assertTransferEnvelope(transaction, { chainId: config.chainId, tokenAddress: config.tokenAddress, expectedData });
      assertFeePolicy(transaction, config);
      if ((await recoverTransactionAddress({ serializedTransaction: raw })).toLowerCase() !== account.address.toLowerCase()) {
        throw new Error('Signed transaction was not produced by the configured faucet wallet.');
      }
      return { raw, hash: keccak256(raw), signerAddress: account.address.toLowerCase() };
    },

    async broadcast(raw, claim) {
      await checkChainAndToken();
      await validateRaw(raw, claim);
      const expected = keccak256(raw);
      const returned = await publicClient.sendRawTransaction({ serializedTransaction: raw });
      if (returned.toLowerCase() !== expected.toLowerCase()) throw new Error('RPC returned an unexpected transaction hash.');
      return expected;
    },

    async receipt(claim) {
      await checkChainAndToken();
      const { txHash: hash, address: recipient, signerAddress, rawTx: raw } = claim;
      await validateRaw(raw, { hash, recipient, signerAddress });
      let receipt;
      try {
        receipt = await publicClient.getTransactionReceipt({ hash });
      } catch (error) {
        if (error?.name === 'TransactionReceiptNotFoundError') return null;
        throw error;
      }
      if (receipt.transactionHash?.toLowerCase() !== hash.toLowerCase()) throw new Error('RPC returned a receipt for an unexpected transaction.');
      if (config.minConfirmations > 1) {
        const head = await publicClient.getBlockNumber();
        const confirmations = head >= receipt.blockNumber ? head - receipt.blockNumber + 1n : 0n;
        if (confirmations < BigInt(config.minConfirmations)) return { status: 'included' };
      }
      if (receipt.status === 'reverted') return { status: 'reverted' };
      if (receipt.status !== 'success') throw new Error('RPC returned an unsupported receipt status.');

      const accountAddress = signerAddress.toLowerCase();
      const paid = receipt.logs.some(log => {
        if (log.address.toLowerCase() !== config.tokenAddress.toLowerCase()) return false;
        try {
          const event = decodeEventLog({ abi: erc20Abi, eventName: 'Transfer', data: log.data, topics: log.topics });
          return event.args.from.toLowerCase() === accountAddress
            && event.args.to.toLowerCase() === recipient.toLowerCase()
            && event.args.value === config.tokenAmount;
        } catch {
          return false;
        }
      });
      if (!paid) throw new Error('Confirmed transaction is missing the expected ERC-20 Transfer event.');
      return { status: 'success' };
    },

    async health(privateKey) {
      await checkChainAndToken();
      const account = accountFactory(privateKey);
      const tokenBalance = await publicClient.readContract({
        address: config.tokenAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account.address],
      });
      if (tokenBalance < config.tokenAmount + config.maxTotalFee) {
        throw new Error('Faucet wallet DAI balance is below the payout plus configured fee reserve.');
      }
      const transfer = {
        address: config.tokenAddress,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [account.address, config.tokenAmount],
        account,
      };
      const simulation = await publicClient.simulateContract(transfer);
      if (simulation.result !== true) throw new Error('ERC-20 transfer health simulation did not return true.');
      const estimatedGas = await publicClient.estimateContractGas(transfer);
      if (estimatedGas <= 0n || estimatedGas > config.maxGasLimit) {
        throw new Error('ERC-20 transfer health gas estimate is outside the configured policy.');
      }
      return {
        chainId: config.chainId,
        tokenAddress: config.tokenAddress,
        senderAddress: account.address.toLowerCase(),
      };
    },
  };
}
