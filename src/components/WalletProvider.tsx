import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { PropsWithChildren } from 'react';
import { anubisTestnet } from '../lib/chain';
import {
  getEmptyWalletProvidersSnapshot,
  getWalletProvidersSnapshot,
  subscribeWalletProviders,
} from '../lib/wallet-discovery';
import type { InjectedProvider, ProviderListener, WalletProviderOption } from '../lib/wallet-discovery';
import { WalletSelector } from './WalletSelector';

type WalletAsset = {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  image?: string;
};

export type WalletDescriptor = Readonly<{
  id: string;
  name: string;
  rdns?: string;
  icon?: string;
}>;

type TestnetWallet = {
  address?: `0x${string}`;
  chainId?: number;
  wallets: readonly WalletDescriptor[];
  selectedWallet?: WalletDescriptor;
  hasProvider: boolean;
  isConnected: boolean;
  isPending: boolean;
  connect: (options?: { select?: boolean }) => Promise<`0x${string}`>;
  switchChainAsync: (parameters: { chainId: number }) => Promise<void>;
  watchAsset: (asset: WalletAsset) => Promise<boolean>;
};

type PendingSelection = {
  promise: Promise<WalletProviderOption>;
  resolve: (wallet: WalletProviderOption) => void;
  reject: (error: Error) => void;
};

export class WalletSelectionCancelledError extends Error {
  constructor() {
    super('Wallet selection was cancelled.');
    this.name = 'WalletSelectionCancelledError';
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

function descriptor(wallet: WalletProviderOption): WalletDescriptor {
  return Object.freeze({ id: wallet.id, name: wallet.name, rdns: wallet.rdns, icon: wallet.icon });
}

export function WalletProvider({ children }: PropsWithChildren) {
  const walletOptions = useSyncExternalStore(
    subscribeWalletProviders,
    getWalletProvidersSnapshot,
    getEmptyWalletProvidersSnapshot,
  );
  const wallets = useMemo(() => walletOptions.map(descriptor), [walletOptions]);
  const [provider, setProvider] = useState<InjectedProvider | null>(null);
  const activeProviderRef = useRef<InjectedProvider | null>(null);
  const [address, setAddress] = useState<`0x${string}`>();
  const [chainId, setChainId] = useState<number>();
  const [isPending, setIsPending] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const selectionRef = useRef<PendingSelection | null>(null);
  const connectionRef = useRef<Promise<`0x${string}`> | null>(null);
  const selectedOption = walletOptions.find(wallet => wallet.provider === provider);
  const selectedWallet = selectedOption ? descriptor(selectedOption) : undefined;

  const activateProvider = useCallback((next: InjectedProvider) => {
    if (activeProviderRef.current === next) return;
    activeProviderRef.current = next;
    setAddress(undefined);
    setChainId(undefined);
    setProvider(next);
  }, []);

  useEffect(() => {
    if (!provider) return;
    let active = true;
    const isCurrent = () => active && activeProviderRef.current === provider;
    const accountsChanged: ProviderListener = value => {
      if (isCurrent()) setAddress(accountFrom(value));
    };
    const chainChanged: ProviderListener = value => {
      if (isCurrent()) setChainId(numericChainId(value));
    };
    const disconnected: ProviderListener = () => {
      if (!isCurrent()) return;
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

  const requestSelection = useCallback(() => {
    if (selectionRef.current) return selectionRef.current.promise;
    let resolveSelection: (wallet: WalletProviderOption) => void = () => undefined;
    let rejectSelection: (error: Error) => void = () => undefined;
    const promise = new Promise<WalletProviderOption>((resolve, reject) => {
      resolveSelection = resolve;
      rejectSelection = reject;
    });
    selectionRef.current = { promise, resolve: resolveSelection, reject: rejectSelection };
    setSelectorOpen(true);
    return promise;
  }, []);

  const cancelSelection = useCallback(() => {
    const pending = selectionRef.current;
    selectionRef.current = null;
    setSelectorOpen(false);
    pending?.reject(new WalletSelectionCancelledError());
  }, []);

  const completeSelection = useCallback((walletId: string) => {
    const selected = walletOptions.find(wallet => wallet.id === walletId);
    const pending = selectionRef.current;
    if (!selected || !pending) return;
    selectionRef.current = null;
    setSelectorOpen(false);
    pending.resolve(selected);
  }, [walletOptions]);

  useEffect(() => () => {
    const pending = selectionRef.current;
    selectionRef.current = null;
    pending?.reject(new WalletSelectionCancelledError());
  }, []);

  const connect = useCallback((options: { select?: boolean } = {}) => {
    if (connectionRef.current) return connectionRef.current;
    const operation = (async () => {
      const current = activeProviderRef.current;
      let selected = !options.select && current
        ? walletOptions.find(wallet => wallet.provider === current)
        : undefined;
      if (!selected) {
        if (!options.select && walletOptions.length === 1) selected = walletOptions[0];
        else if (walletOptions.length > 0) selected = await requestSelection();
        else throw new Error('No browser wallet is available. Install or enable an injected EVM wallet and try again.');
      }

      activateProvider(selected.provider);
      setIsPending(true);
      try {
        const account = accountFrom(await selected.provider.request({ method: 'eth_requestAccounts' }));
        if (!account) throw new Error('The wallet did not provide an account.');
        const connectedChainId = numericChainId(await selected.provider.request({ method: 'eth_chainId' }));
        if (!connectedChainId) throw new Error('The wallet returned an invalid chain ID.');
        if (activeProviderRef.current !== selected.provider) throw new Error('The selected wallet changed during connection.');
        setAddress(account);
        setChainId(connectedChainId);
        return account;
      } finally {
        if (activeProviderRef.current === selected.provider) setIsPending(false);
      }
    })();
    connectionRef.current = operation;
    void operation.finally(() => {
      if (connectionRef.current === operation) connectionRef.current = null;
    }).catch(() => undefined);
    return operation;
  }, [activateProvider, requestSelection, walletOptions]);

  const switchChainAsync = useCallback(async ({ chainId: requestedChainId }: { chainId: number }) => {
    const wallet = requireProvider(activeProviderRef.current);
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
      if (activeProviderRef.current !== wallet) throw new Error('The selected wallet changed while switching networks.');
      if (currentChainId !== requestedChainId) throw new Error('The wallet did not switch to the requested chain.');
      setChainId(requestedChainId);
    } finally {
      if (activeProviderRef.current === wallet) setIsPending(false);
    }
  }, []);

  const watchAsset = useCallback(async (asset: WalletAsset) => {
    const wallet = requireProvider(activeProviderRef.current);
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
    if (activeProviderRef.current !== wallet) throw new Error('The selected wallet changed while importing the token.');
    return accepted === true;
  }, []);

  const value = useMemo<TestnetWallet>(() => ({
    address,
    chainId,
    wallets,
    selectedWallet,
    hasProvider: walletOptions.length > 0,
    isConnected: Boolean(address),
    isPending,
    connect,
    switchChainAsync,
    watchAsset,
  }), [address, chainId, connect, isPending, selectedWallet, switchChainAsync, walletOptions.length, wallets, watchAsset]);

  return <WalletContext.Provider value={value}>
    {children}
    {selectorOpen && <WalletSelector
      wallets={wallets}
      selectedWalletId={selectedWallet?.id}
      onSelect={completeSelection}
      onClose={cancelSelection}
    />}
  </WalletContext.Provider>;
}

export function useTestnetWallet() {
  const wallet = useContext(WalletContext);
  if (!wallet) throw new Error('useTestnetWallet must be used inside WalletProvider.');
  return wallet;
}
