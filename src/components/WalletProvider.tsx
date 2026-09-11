import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { anubisTestnet } from '../lib/chain';

type ProviderRequest = {
  method: string;
  params?: readonly unknown[] | Record<string, unknown>;
};

type ProviderListener = (value: unknown) => void;

export type InjectedProvider = {
  request(request: ProviderRequest): Promise<unknown>;
  on?(event: string, listener: ProviderListener): void;
  removeListener?(event: string, listener: ProviderListener): void;
};

type WalletAsset = {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  image?: string;
};

type TestnetWallet = {
  address?: `0x${string}`;
  chainId?: number;
  hasProvider: boolean;
  isConnected: boolean;
  isPending: boolean;
  connect: () => Promise<`0x${string}`>;
  switchChainAsync: (parameters: { chainId: number }) => Promise<void>;
  watchAsset: (asset: WalletAsset) => Promise<boolean>;
};

declare global {
  interface Window {
    ethereum?: InjectedProvider;
  }
}

const WalletContext = createContext<TestnetWallet | undefined>(undefined);

function accountFrom(value: unknown): `0x${string}` | undefined {
  if (!Array.isArray(value)) return undefined;
  const account = value[0];
  return typeof account === 'string' && /^0x[\da-f]{40}$/i.test(account) && !/^0x0{40}$/i.test(account)
    ? account as `0x${string}`
    : undefined;
}

function injectedProvider(): InjectedProvider | null {
  const candidate = window.ethereum;
  return candidate && typeof candidate.request === 'function' ? candidate : null;
}

function numericChainId(value: unknown): number | undefined {
  const parsed = typeof value === 'string' && /^0x[\da-f]+$/i.test(value)
    ? Number.parseInt(value.slice(2), 16)
    : typeof value === 'number' ? value : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function providerErrorCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as {
    code?: unknown;
    cause?: { code?: unknown };
    data?: { originalError?: { code?: unknown } };
  };
  for (const value of [candidate.code, candidate.cause?.code, candidate.data?.originalError?.code]) {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (Number.isInteger(parsed)) return parsed;
  }
  return undefined;
}

function requireProvider(provider: InjectedProvider | null): InjectedProvider {
  if (!provider) throw new Error('No browser wallet is available. Install or enable an injected EVM wallet and try again.');
  return provider;
}

function chainParameters(chainId: number) {
  if (!anubisTestnet || chainId !== anubisTestnet.id) throw new Error('The requested network is not configured.');
  const blockExplorer = anubisTestnet.blockExplorers?.default.url;
  return {
    chainId: `0x${chainId.toString(16)}`,
    chainName: anubisTestnet.name,
    nativeCurrency: anubisTestnet.nativeCurrency,
    rpcUrls: [...anubisTestnet.rpcUrls.default.http],
    ...(blockExplorer ? { blockExplorerUrls: [blockExplorer] } : {}),
  };
}

export function WalletProvider({ children }: PropsWithChildren) {
  const [provider, setProvider] = useState<InjectedProvider | null>(injectedProvider);
  const [address, setAddress] = useState<`0x${string}`>();
  const [chainId, setChainId] = useState<number>();
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (provider) return;
    const detectProvider = () => setProvider(injectedProvider());
    window.addEventListener('ethereum#initialized', detectProvider, { once: true });
    const fallback = window.setTimeout(detectProvider, 3000);
    return () => {
      window.removeEventListener('ethereum#initialized', detectProvider);
      window.clearTimeout(fallback);
    };
  }, [provider]);

  useEffect(() => {
    if (!provider) return;
    let active = true;
    const accountsChanged: ProviderListener = value => {
      if (active) setAddress(accountFrom(value));
    };
    const chainChanged: ProviderListener = value => {
      if (active) setChainId(numericChainId(value));
    };
    const disconnected: ProviderListener = () => {
      if (!active) return;
      setAddress(undefined);
      setChainId(undefined);
    };

    void provider.request({ method: 'eth_accounts' }).then(accountsChanged).catch(() => undefined);
    void provider.request({ method: 'eth_chainId' }).then(chainChanged).catch(() => undefined);
    if (typeof provider.on === 'function') {
      provider.on('accountsChanged', accountsChanged);
      provider.on('chainChanged', chainChanged);
      provider.on('disconnect', disconnected);
    }
    return () => {
      active = false;
      if (typeof provider.removeListener === 'function') {
        provider.removeListener('accountsChanged', accountsChanged);
        provider.removeListener('chainChanged', chainChanged);
        provider.removeListener('disconnect', disconnected);
      }
    };
  }, [provider]);

  const connect = useCallback(async () => {
    const wallet = requireProvider(provider);
    setIsPending(true);
    try {
      const account = accountFrom(await wallet.request({ method: 'eth_requestAccounts' }));
      if (!account) throw new Error('The wallet did not provide an account.');
      const connectedChainId = numericChainId(await wallet.request({ method: 'eth_chainId' }));
      if (!connectedChainId) throw new Error('The wallet returned an invalid chain ID.');
      setAddress(account);
      setChainId(connectedChainId);
      return account;
    } finally {
      setIsPending(false);
    }
  }, [provider]);

  const switchChainAsync = useCallback(async ({ chainId: requestedChainId }: { chainId: number }) => {
    const wallet = requireProvider(provider);
    const parameters = chainParameters(requestedChainId);
    setIsPending(true);
    try {
      let added = false;
      try {
        await wallet.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: parameters.chainId }],
        });
      } catch (error) {
        if (providerErrorCode(error) !== 4902) throw error;
        await wallet.request({ method: 'wallet_addEthereumChain', params: [parameters] });
        added = true;
      }
      let currentChainId = numericChainId(await wallet.request({ method: 'eth_chainId' }));
      if (added && currentChainId !== requestedChainId) {
        await wallet.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: parameters.chainId }],
        });
        currentChainId = numericChainId(await wallet.request({ method: 'eth_chainId' }));
      }
      if (currentChainId !== requestedChainId) throw new Error('The wallet did not switch to the requested chain.');
      setChainId(requestedChainId);
    } finally {
      setIsPending(false);
    }
  }, [provider]);

  const watchAsset = useCallback(async (asset: WalletAsset) => {
    const wallet = requireProvider(provider);
    const accepted = await wallet.request({
      method: 'wallet_watchAsset',
      params: {
        type: 'ERC20',
        options: {
          address: asset.address,
          symbol: asset.symbol,
          decimals: asset.decimals,
          ...(asset.image ? { image: asset.image } : {}),
        },
      },
    });
    return accepted === true;
  }, [provider]);

  const value = useMemo<TestnetWallet>(() => ({
    address,
    chainId,
    hasProvider: Boolean(provider),
    isConnected: Boolean(address),
    isPending,
    connect,
    switchChainAsync,
    watchAsset,
  }), [address, chainId, connect, isPending, provider, switchChainAsync, watchAsset]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useTestnetWallet() {
  const wallet = useContext(WalletContext);
  if (!wallet) throw new Error('useTestnetWallet must be used inside WalletProvider.');
  return wallet;
}
