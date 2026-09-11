import { createContext, useContext } from 'react';
import type { PropsWithChildren } from 'react';
import type { WalletClient } from 'viem';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, useConnectModal } from '@rainbow-me/rainbowkit';
import { WagmiProvider, useAccount, useSwitchChain, useWalletClient } from 'wagmi';
import { walletConfig, walletTheme } from '../lib/wallet';

type TestnetWallet = {
  address?: `0x${string}`;
  chainId?: number;
  wallet?: WalletClient;
  isConnected: boolean;
  isPending: boolean;
  openConnectModal?: () => void;
  switchChainAsync?: (parameters: { chainId: number }) => Promise<unknown>;
};
const WalletContext = createContext<TestnetWallet>({ isConnected: false, isPending: false });
const queryClient = new QueryClient();

function ConnectedWallet({ children }: PropsWithChildren) {
  const { address, chainId, isConnected } = useAccount();
  const { data: wallet } = useWalletClient();
  const { switchChainAsync, isPending } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  return <WalletContext.Provider value={{ address, chainId, isConnected, wallet, switchChainAsync, isPending, openConnectModal }}>{children}</WalletContext.Provider>;
}

export function WalletProvider({ children }: PropsWithChildren) {
  if (!walletConfig) return children;
  return <WagmiProvider config={walletConfig}>
    <QueryClientProvider client={queryClient}>
      <RainbowKitProvider theme={walletTheme} locale="en-US">
        <ConnectedWallet>{children}</ConnectedWallet>
      </RainbowKitProvider>
    </QueryClientProvider>
  </WagmiProvider>;
}

export function useTestnetWallet() { return useContext(WalletContext); }
