import { ConnectButton } from '@rainbow-me/rainbowkit';
import { anubisTestnet } from '../lib/chain';
import s from '../App.module.css';

export function WalletButton() {
  if (!anubisTestnet) return <button type="button" className={s.walletButton} disabled title="Anubis Testnet network details are not configured yet">Connect wallet</button>;
  const testnetId = anubisTestnet.id;
  return <ConnectButton.Custom>{({ account, chain, openConnectModal, openAccountModal, openChainModal, mounted }) => {
    const connected = mounted && account && chain;
    return <button type="button" className={s.walletButton} onClick={!connected ? openConnectModal : chain.id !== testnetId || chain.unsupported ? openChainModal : openAccountModal}>
      {!connected ? 'Connect wallet' : chain.id !== testnetId || chain.unsupported ? 'Add testnet to your wallet' : account.displayName}
    </button>;
  }}</ConnectButton.Custom>;
}
