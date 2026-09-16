import { createPublicClient, createWalletClient, defineChain, http, keccak256, erc20Abi, encodeFunctionData, decodeEventLog } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export function createSender(config) {
  const network = config.faucet.chain;
  const chain = defineChain({ id: network.id, name: network.name || 'Anubis Testnet', nativeCurrency: network.nativeCurrency, rpcUrls: { default: { http: [network.rpcUrl] } }, testnet: true });
  const account = privateKeyToAccount(config.privateKey);
  const transport = http(network.rpcUrl, { timeout: 10000, retryCount: 0 });
  const client = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ account, chain, transport });
  return {
    address: account.address,
    async checkChain() { if (await client.getChainId() !== chain.id) throw new Error('RPC chain ID does not match the configured network.'); },
    async prepare(to) {
      await this.checkChain();
      const token = config.token;
      const decimals = await client.readContract({ address: token.address, abi: erc20Abi, functionName: 'decimals' });
      if (decimals !== token.decimals) throw new Error('ERC-20 decimals do not match the configured token.');
      const transfer = { abi: erc20Abi, functionName: 'transfer', args: [to, config.amount] };
      const simulation = await client.simulateContract({ ...transfer, address: token.address, account });
      if (simulation.result !== true) throw new Error('ERC-20 transfer simulation did not return true.');
      const request = await wallet.prepareTransactionRequest({ to: token.address, value: 0n, data: encodeFunctionData(transfer) });
      const raw = await wallet.signTransaction(request);
      return { raw, hash: keccak256(raw) };
    },
    async broadcast(raw) { return client.sendRawTransaction({ serializedTransaction: raw }); },
    async receipt(hash, to) {
      try {
        const receipt = await client.getTransactionReceipt({ hash });
        if (receipt.status === 'success') {
          const paid = receipt.logs.some(log => {
            if (log.address.toLowerCase() !== config.token.address.toLowerCase()) return false;
            try {
              const event = decodeEventLog({ abi: erc20Abi, eventName: 'Transfer', data: log.data, topics: log.topics });
              return event.args.from.toLowerCase() === account.address.toLowerCase()
                && event.args.to.toLowerCase() === to?.toLowerCase() && event.args.value === config.amount;
            } catch { return false; }
          });
          // A successful receipt alone does not prove an ERC-20 payment.
          // Keep the durable signing slot for manual inspection if the event is missing.
          if (!paid) throw new Error('Confirmed transaction is missing the expected ERC-20 Transfer event.');
        }
        return receipt;
      }
      catch (error) { if (error.name === 'TransactionReceiptNotFoundError') return null; throw error; }
    },
  };
}
