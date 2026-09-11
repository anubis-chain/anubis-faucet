import { connectorsForWallets, darkTheme } from '@rainbow-me/rainbowkit';
import type { Wallet } from '@rainbow-me/rainbowkit';
import { binanceWallet, coinbaseWallet, injectedWallet, metaMaskWallet, okxWallet, rabbyWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets';
import { createConfig, createConnector, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import type { EIP1193Provider } from 'viem';
import { anubisTestnet } from './chain';

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim();
type FlaggedProvider = EIP1193Provider & Record<string, unknown> & { providers?: FlaggedProvider[] };
type WalletFactory = (options: { projectId: string; appName: string }) => Wallet;

// Reuse RainbowKit's branding and install guides, but route directly to browser
// extensions when no WalletConnect account has been configured for this replica.
function extensionOnly(factory: WalletFactory, flag: string) {
  return (options: { projectId: string; appName: string }): Wallet => {
    const wallet = factory(options);
    const provider = () => {
      const browser = window as unknown as { ethereum?: FlaggedProvider; okxwallet?: FlaggedProvider };
      if (flag === 'isOkxWallet' && browser.okxwallet) return browser.okxwallet;
      const ethereum = browser.ethereum;
      return ethereum?.providers?.find(p => p[flag]) || (ethereum?.[flag] ? ethereum : undefined);
    };
    return {
      ...wallet,
      installed: Boolean(provider()),
      qrCode: undefined,
      mobile: undefined,
      desktop: undefined,
      createConnector: details => createConnector(config => ({
        ...injected({ target: { id: wallet.id, name: wallet.name, provider }, shimDisconnect: true })(config),
        ...details,
      })),
    };
  };
}

const popular = projectId
  ? [metaMaskWallet, rabbyWallet, walletConnectWallet, okxWallet, binanceWallet]
  : [extensionOnly(metaMaskWallet, 'isMetaMask'), rabbyWallet, extensionOnly(okxWallet, 'isOkxWallet'), extensionOnly(binanceWallet, 'isBinance')];
const more = projectId ? [coinbaseWallet, injectedWallet] : [extensionOnly(coinbaseWallet, 'isCoinbaseWallet'), injectedWallet];

export const walletConfig = anubisTestnet ? createConfig({
  chains: [anubisTestnet],
  connectors: connectorsForWallets([{ groupName: 'Popular', wallets: popular }, { groupName: 'More', wallets: more }], {
    appName: 'Anubis Testnet',
    projectId: projectId || 'local-injected-wallets',
  }),
  transports: { [anubisTestnet.id]: http() },
}) : null;

export const walletTheme = darkTheme({
  accentColor: '#ccff00',
  accentColorForeground: '#000000',
  borderRadius: 'small',
  overlayBlur: 'small',
});
