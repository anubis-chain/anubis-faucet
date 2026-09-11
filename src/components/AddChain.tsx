import { useTestnetWallet } from './WalletProvider';
import { anubisTestnet } from '../lib/chain';
import { brand } from '../lib/brand';
import { Icon } from './Icon';
import s from '../App.module.css';

const fields = [
  ['Network name', anubisTestnet?.name || brand.name],
  ['Default RPC URL', anubisTestnet?.rpcUrls.default.http[0]],
  ['Chain ID', anubisTestnet ? String(anubisTestnet.id) : undefined],
  ['Currency symbol', anubisTestnet?.nativeCurrency.symbol],
  ['Block explorer URL', anubisTestnet?.blockExplorers?.default.url],
] as const;

export function AddChain({ navigate, notify }: { navigate: (path: string) => void; notify: (message: string) => void }) {
  const { isConnected, openConnectModal, switchChainAsync, isPending } = useTestnetWallet();
  async function addChain() {
    if (!anubisTestnet || !switchChainAsync) return;
    if (!isConnected) { openConnectModal?.(); return; }
    try { await switchChainAsync({ chainId: anubisTestnet.id }); notify(`${brand.name} is ready in your wallet.`); }
    catch { notify('The network was not added. Please check your wallet and try again.'); }
  }
  return <>
    <div className={`${s.heroHeading} ${s.chainHeading}`}><h2>Add Testnet to wallet</h2></div>
    <button type="button" className={s.walletButton} onClick={() => void addChain()} disabled={isPending || !anubisTestnet}>{isPending ? 'Check your wallet...' : `Add ${brand.name} to your wallet`}</button>
    <section className={s.networkPanel}>
      <a className={s.backLink} href="/" onClick={e => { if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) { e.preventDefault(); navigate('/'); } }}><Icon name="arrow" width="12" height="12" />Back to faucet</a>
      <h1>Chain details</h1>
      <p>{anubisTestnet ? 'You can also add Anubis Testnet manually using the following chain details.' : 'Anubis Testnet network details are not configured yet. Adding the network will be available once these details are confirmed.'}</p>
      <dl className={s.networkTable}>{fields.map(([label, value]) => <div className={s.networkField} key={label}>
        <div><dt>{label}</dt><dd>{value || 'Not configured'}</dd></div><button className={s.copyButton} type="button" aria-label={`Copy ${label}`} disabled={!value} onClick={() => {
          if (!value) return;
          navigator.clipboard.writeText(value).then(() => notify(`${label} copied.`)).catch(() => notify('Unable to copy. Select and copy the value manually.'));
        }}><Icon name="copy" width="16" height="16" /></button>
      </div>)}</dl>
    </section>
  </>;
}
