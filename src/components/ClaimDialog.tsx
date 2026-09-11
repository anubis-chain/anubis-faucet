import { useEffect, useRef, useState } from 'react';
import { apiConfigured, distribute, turnstileSiteKey } from '../lib/api';
import { docsUrl, anubisTestnet } from '../lib/chain';
import { Modal } from './Modal';
import { Icon } from './Icon';
import s from '../App.module.css';

type Turnstile = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
declare global { interface Window { turnstile?: Turnstile } }

function Verification({ onVerify }: { onVerify: (token: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!apiConfigured || !turnstileSiteKey) return;
    let disposed = false;
    let widget: string | undefined;
    const render = () => {
      if (disposed || widget || !window.turnstile || !ref.current) return;
      widget = window.turnstile.render(ref.current, {
        sitekey: turnstileSiteKey, action: 'faucet_claim', theme: 'dark', size: 'flexible',
        callback: (token: string) => { setError(''); onVerify(token); },
        'expired-callback': () => onVerify(''),
        'error-callback': () => { onVerify(''); setError('Verification could not load. Please reopen this dialog to retry.'); },
      });
    };
    let script = document.querySelector<HTMLScriptElement>('script[data-turnstile]');
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.dataset.turnstile = 'true';
      script.async = true;
      document.head.append(script);
    }
    const failed = () => setError('Verification could not load. Please reopen this dialog to retry.');
    script.addEventListener('load', render);
    script.addEventListener('error', failed);
    render();
    return () => {
      disposed = true;
      script.removeEventListener('load', render);
      script.removeEventListener('error', failed);
      if (widget) window.turnstile?.remove(widget);
    };
  }, [onVerify]);
  if (!apiConfigured || !turnstileSiteKey) return <div className={s.verificationPlaceholder}>Verification is unavailable in this local replica.</div>;
  return <><div ref={ref} className={s.verification} />{error && <p role="alert" className={s.error}>{error}</p>}</>;
}

export function ClaimDialog({ address, onClose }: { address: string; onClose: () => void }) {
  const [token, setToken] = useState('');
  const [verificationKey, setVerificationKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hashes, setHashes] = useState<string[]>([]);
  const submitting = useRef(false);

  async function claim() {
    if (submitting.current) return;
    if (!token) return setError('Please complete the CAPTCHA verification');
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await distribute(address, token);
      setHashes(result.txHashes);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Distribution failed. Please try again.');
    } finally { submitting.current = false; setBusy(false); setToken(''); setVerificationKey(key => key + 1); }
  }

  return <Modal title={hashes.length ? 'Transaction submitted' : "Confirm you're human"} onClose={onClose}>
    {hashes.length ? <div className={s.steps}>
      <p className={s.success}><Icon name="check" /> Your transfer has been submitted. Check the transaction for confirmation.</p>
      <p className={s.recipient}>{address}</p>
      {hashes.map((hash, i) => anubisTestnet?.blockExplorers?.default.url
        ? <a className={s.transactionLink} href={`${anubisTestnet.blockExplorers.default.url}/tx/${hash}`} key={hash} target="_blank" rel="noreferrer">View transaction {i + 1}<Icon name="external" /></a>
        : <p className={s.recipient} key={hash}>{hash}</p>)}
      <button type="button" className={s.primaryButton} onClick={onClose}>Done</button>
    </div> : <>
      <p className={s.modalDescription}>To prevent spam and faucet abuse, please complete Cloudflare verification. Each address and IP can claim once per configured cooldown period.</p>
      <div className={s.steps}>
        <div className={s.step}><p>Step 1: Verify</p><Verification key={verificationKey} onVerify={setToken} />{token && <p className={s.success}><Icon name="check" width="16" height="16" />Verification complete</p>}</div>

        {error && <p className={s.error} role="alert">{error}</p>}
        <button type="button" className={s.primaryButton} onClick={claim} disabled={busy || !token || !apiConfigured || !anubisTestnet}>{busy ? 'Distributing tokens...' : 'Claim tokens'}</button>
        {(!apiConfigured || !anubisTestnet) && <p className={s.localNotice}>Anubis Testnet token distribution is not connected yet. Visit the <a href={docsUrl} target="_blank" rel="noreferrer">Anubis documentation <Icon name="external" width="12" height="12" /></a> for network information.</p>}
      </div>
    </>}
  </Modal>;
}
