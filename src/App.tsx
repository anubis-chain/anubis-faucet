import { useEffect, useState } from 'react';
import { Faucet } from './components/Faucet';
import { Faq } from './components/Faq';
import { WalletButton } from './components/WalletButton';
import { AddChain } from './components/AddChain';
import { Icon } from './components/Icon';
import { Modal } from './components/Modal';
import { Brand } from './components/Brand';
import { brand } from './lib/brand';
import { docsUrl } from './lib/chain';
import s from './App.module.css';

function Background() {
  const [reduceMotion, setReduceMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduceMotion(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return <div className={s.background} aria-hidden="true">
    <div className={s.backgroundMedia}>
      <img src="/assets/background.jpg" alt="" width="2560" height="1152" />
      {!reduceMotion && (
        <video autoPlay loop muted playsInline preload="auto" poster="/assets/background.jpg">
          <source src="/assets/background.mp4" type="video/mp4" />
          <source src="/assets/background.webm" type="video/webm" />
        </video>
      )}
    </div>
  </div>;
}

export function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [privacy, setPrivacy] = useState(false);
  const [toast, setToast] = useState('');
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 5000);
    return () => window.clearTimeout(timeout);
  }, [toast]);
  const navigate = (next: string) => { window.history.pushState({}, '', next); setPath(next); window.scrollTo(0, 0); };
  const isAddChain = path.replace(/\/$/, '') === '/add-chain';

  return <div className={s.page}>
    <main className={s.main}>
      <section className={s.hero}>
        <Background />
        <div className={s.heroInner}><div className={s.heroContent}>
          <a className={s.brand} href="/" aria-label="Anubis Testnet faucet home" onClick={e => {
            if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) { e.preventDefault(); navigate('/'); }
          }}><Brand /></a>
          {isAddChain ? <AddChain navigate={navigate} notify={setToast} /> : <>
            <div className={s.heroHeading}><h2>Testnet Faucet</h2><p>Get testnet tokens on Anubis Testnet sent to your wallet</p></div>
            <WalletButton />
            <Faucet navigate={navigate} notify={setToast} />
          </>}
        </div></div>
      </section>
      <Faq />
      <a className={s.docsCta} href={docsUrl} target="_blank" rel="noreferrer"><p>Join the next generation of builders onchain</p><span>See docs</span></a>
    </main>
    <footer className={s.footer}>
      <a className={s.footerBrand} href={brand.website} aria-label="Anubis Testnet website" target="_blank" rel="noreferrer"><Brand /></a>
      <div className={s.legalWrap}><div className={s.legal}>
        <a href={docsUrl} target="_blank" rel="noreferrer">Documentation</a>
        <a href={brand.website} target="_blank" rel="noreferrer">Anubis Testnet</a>
        <button type="button" onClick={() => setPrivacy(true)}>Your Privacy Choices<img src="/assets/privacy-toggle.svg" width="30" height="14" alt="" /></button>
      </div></div>
    </footer>
    {toast && <div role="status" className={s.toast}><span>{toast}</span><button type="button" aria-label="Dismiss notification" onClick={() => setToast('')}><Icon name="close" /></button></div>}
    {privacy && <Modal title="Your Privacy Choices" onClose={() => setPrivacy(false)}><div className={s.steps}>
      <p className={s.modalDescription}>This faucet does not use advertising or analytics cookies. Your wallet manages its own connection permissions; this site does not store wallet connection preferences. The faucet service stores claim addresses, a keyed representation of network addresses, and timestamps to enforce request limits. Cloudflare Turnstile and wallet providers have their own privacy policies.</p>
      <a className={s.transactionLink} href={docsUrl} target="_blank" rel="noreferrer">Anubis Testnet documentation<Icon name="external" /></a>
      <button type="button" className={s.primaryButton} onClick={() => setPrivacy(false)}>Close</button>
    </div></Modal>}
  </div>;
}
