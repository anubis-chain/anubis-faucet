import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTestnetWallet } from './WalletProvider';
import { isRecipient } from '../lib/api';
import { distribution, anubisTestnet, tokens } from '../lib/chain';
import { ClaimDialog } from './ClaimDialog';
import { Icon } from './Icon';
import s from '../App.module.css';

export function Faucet({ navigate, notify }: { navigate: (path: string) => void; notify: (message: string) => void }) {
  const { address: walletAddress, chainId, wallet, switchChainAsync, openConnectModal } = useTestnetWallet();
  const query = new URLSearchParams(window.location.search);
  const [address, setAddress] = useState(query.get('address') || '');
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(query.get('step') === 'auth' && isRecipient(address));
  const [importing, setImporting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const valid = isRecipient(address.trim());

  useEffect(() => { if (walletAddress) setAddress(current => current || walletAddress); }, [walletAddress]);
  useEffect(() => {
    const update = () => {
      const query = new URLSearchParams(window.location.search);
      const recipient = query.get('address') || '';
      setAddress(recipient);
      setOpen(query.get('step') === 'auth' && isRecipient(recipient));
    };
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) { setError(true); input.current?.focus(); return; }
    setError(false);
    setAddress(address.trim());
    const url = new URL(window.location.href);
    url.searchParams.set('address', address.trim());
    url.searchParams.set('step', 'auth');
    window.history.pushState({}, '', url);
    setOpen(true);
  }

  function close() {
    const url = new URL(window.location.href);
    url.searchParams.delete('step');
    window.history.replaceState({}, '', url);
    setOpen(false);
  }

  async function importTokens(selected: typeof tokens) {
    if (!anubisTestnet || !switchChainAsync || !selected.length) return;
    if (!wallet) { openConnectModal?.(); return; }
    if (importing) return;
    setImporting(true);
    try {
      if (chainId !== anubisTestnet.id) await switchChainAsync({ chainId: anubisTestnet.id });
      for (const token of selected) {
        const accepted = await wallet.watchAsset({ type: 'ERC20', options: token });
        if (!accepted) { notify('Token import was cancelled in your wallet.'); return; }
      }
      notify(selected.length > 1 ? 'Testnet tokens imported to your wallet.' : `${selected[0].symbol} imported to your wallet.`);
    } catch { notify('Token import was not completed. Check your wallet and try again.'); }
    finally { setImporting(false); }
  }

  return <section className={s.faucet} aria-labelledby="faucet-title">
    <a className={s.addLink} href="/add-chain" onClick={e => {
      if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) { e.preventDefault(); navigate('/add-chain'); }
    }}>Add testnet<Icon name="arrow" width="12" height="12" /></a>
    <div className={s.faucetIntro}>
      <h1 id="faucet-title">Testnet Faucet</h1>
      <p>{anubisTestnet ? 'Request test tokens to build and experiment on Anubis Testnet.' : 'Anubis Testnet is awaiting network configuration. Wallet connection and token claims will be available when the faucet is ready.'}</p>
    </div>
    <form onSubmit={submit} className={s.form} noValidate>
      <div className={s.addressPanel}>
        <label htmlFor="address">Send to</label>
        <div className={s.inputWrap}>
          <input ref={input} id="address" className={valid ? s.validInput : undefined} value={address} onChange={e => { setAddress(e.target.value); setError(false); }} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} placeholder="Enter an Ethereum address" aria-invalid={error} aria-describedby={error ? 'address-error' : 'address-help'} />
          {valid && <Icon name="check" className={s.validIcon} />}
        </div>
        <p id="address-help">Enter your wallet’s Ethereum address</p>
        {error && <p id="address-error" className={s.error} role="alert">Please enter a valid Ethereum address</p>}
      </div>
      <button type="submit" className={s.primaryButton}>Send tokens</button>
      <div className={s.receive}>
        <div><h3>You will receive</h3><p>{anubisTestnet && (distribution.nativeAmount || (tokens.length > 0 && distribution.tokenAmount)) ? `Anubis test tokens.${distribution.rateLimitHours ? ` Available every ${distribution.rateLimitHours} hours.` : ''}` : 'Token details will be available when the faucet is configured.'}</p></div>
        {(tokens.length > 0 || (anubisTestnet && distribution.nativeAmount)) && <div className={s.tokenRow}>
          <div className={s.tokens}>
            {anubisTestnet && distribution.nativeAmount && <div className={s.token}><strong>{distribution.nativeAmount}</strong><span>{anubisTestnet.nativeCurrency.symbol} (Native)</span></div>}
            {tokens.map(token => <button type="button" key={token.symbol} className={s.token} disabled={importing} onClick={() => void importTokens([token])} aria-label={`Import ${token.symbol} to your wallet`}><strong>{distribution.tokenAmount}</strong><span>{token.symbol} (ERC-20)</span></button>)}
          </div>
          {tokens.length > 0 && <button type="button" className={s.importAll} disabled={importing} onClick={() => void importTokens(tokens)}><Icon name="circle-plus" width="16" height="16" />{importing ? 'Importing' : tokens.length === 1 ? `Import ${tokens[0].symbol}` : 'Import all'}</button>}
        </div>}
      </div>
    </form>
    {open && <ClaimDialog address={address.trim()} onClose={close} />}
  </section>;
}
