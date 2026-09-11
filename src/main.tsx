import React from 'react';
import ReactDOM from 'react-dom/client';
import '@rainbow-me/rainbowkit/styles.css';
import { WalletProvider } from './components/WalletProvider';
import { App } from './App';
import './global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WalletProvider><App /></WalletProvider>
  </React.StrictMode>,
);
