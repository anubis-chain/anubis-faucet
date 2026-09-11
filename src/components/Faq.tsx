import { useState } from 'react';
import { docsUrl } from '../lib/chain';
import { Icon } from './Icon';
import s from '../App.module.css';

const faqs = [
  { question: 'What is a testnet?', answer: <p>A testnet is a version of a blockchain used specifically for testing. It allows developers or users to test their apps and interact with smart contracts without using assets with real-world value. In contrast to a mainnet blockchain (which represents a live production environment), a testnet is a sandbox.</p> },
  { question: 'What is the Anubis Testnet faucet?', answer: <>
    <p>The Anubis Testnet faucet interface lets users and developers request test tokens for the wallet of their choice. Token availability and distribution depend on the configured test network and faucet service.</p>
    <p>Available tokens and claim amounts are shown in the faucet once the network is configured.</p>
  </> },
  { question: 'What are the eligibility requirements?', answer: <>
    <p>When the faucet service is enabled, its verification flow requires users to:</p>
    <ul><li>Pass Cloudflare verification</li><li>Provide a valid wallet address</li></ul>
    <p>Each wallet address and each IP address can claim once per cooldown period. Claim amounts and the cooldown period are set by the faucet configuration.</p>
  </> },
  { question: 'Where can I find Anubis developer resources?', answer: <p>For information about building on Anubis, please visit the <a href={docsUrl} target="_blank" rel="noreferrer">Anubis developer documentation</a>.</p> },
  { question: 'What if I have other questions regarding Anubis Testnet?', answer: <p>Please review the Anubis Testnet <a href={docsUrl} target="_blank" rel="noreferrer">developer documentation</a> for more information.</p> },
];

export function Faq() {
  const [open, setOpen] = useState<Set<number>>(new Set());
  return <section className={s.faq} aria-labelledby="faq-title">
    <h2 id="faq-title">Frequently Asked Questions</h2>
    <hr />
    <div className={s.questions}>{faqs.map(({ question, answer }, index) => <div className={s.question} key={question}>
      <button type="button" id={`question-${index}`} aria-expanded={open.has(index)} aria-controls={`answer-${index}`} onClick={() => setOpen(previous => {
        const next = new Set(previous);
        if (next.has(index)) next.delete(index); else next.add(index);
        return next;
      })}>{question}<Icon name={open.has(index) ? 'minus' : 'plus'} width="24" height="24" /></button>
      <div id={`answer-${index}`} role="region" aria-labelledby={`question-${index}`} className={s.answer} hidden={!open.has(index)}>{answer}</div>
    </div>)}</div>
  </section>;
}
