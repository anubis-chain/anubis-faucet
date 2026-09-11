import { useState } from 'react';
import { anubisTestnet } from '../lib/chain';
import { useTestnetWallet } from './WalletProvider';
import s from '../App.module.css';

function shortAddress(address: `0x${string}`) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletButton() {
  const { address, chainId, connect, hasProvider, isConnected, isPending, switchChainAsync } = useTestnetWallet();
  const [failure, setFailure] = useState('');
  if (!anubisTestnet) return <button type="button" className={s.walletButton} disabled title="Anubis Testnet network details are not configured yet">Connect wallet</button>;
  const wrongChain = isConnected && chainId !== anubisTestnet.id;
  const label = isPending
    ? 'Check your wallet...'
    : !isConnected ? 'Connect wallet'
      : wrongChain ? 'Add testnet to your wallet'
        : address ? shortAddress(address) : 'Connect wallet';

  async function act() {
    setFailure('');
    try {
      if (!isConnected) await connect();
      else if (wrongChain) await switchChainAsync({ chainId: anubisTestnet!.id });
    } catch {
      setFailure('The wallet request was not completed.');
    }
  }

  const title = failure || (!hasProvider
    ? 'No injected browser wallet was detected.'
    : address ? `Connected account ${address}` : undefined);
  return <button type="button" className={s.walletButton} onClick={() => void act()} disabled={isPending} title={title}>
    {label}
  </button>;
}
