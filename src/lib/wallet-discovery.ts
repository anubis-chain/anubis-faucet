export type ProviderRequest = {
  method: string;
  params?: readonly unknown[] | Record<string, unknown>;
};

export type ProviderListener = (value: unknown) => void;

export type InjectedProvider = {
  request(request: ProviderRequest): Promise<unknown>;
  on?(event: string, listener: ProviderListener): void;
  removeListener?(event: string, listener: ProviderListener): void;
};

export type WalletProviderOption = Readonly<{
  id: string;
  name: string;
  rdns?: string;
  icon?: string;
  provider: InjectedProvider;
  source: 'eip6963' | 'legacy';
}>;

declare global {
  interface Window {
    ethereum?: InjectedProvider;
  }
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ICON = /^data:image\/(?:png|webp|svg\+xml)(?:;[a-z0-9=+.-]+)*,/i;
const MAX_PROVIDERS = 20;
const EMPTY: readonly WalletProviderOption[] = Object.freeze([]);

let snapshot: readonly WalletProviderOption[] = EMPTY;
let started = false;
const subscribers = new Set<() => void>();

function safeText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== 'string' || value.length > maximum) return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return text || undefined;
}

function safeIcon(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 32_768) return undefined;
  const icon = value.trim();
  return SAFE_ICON.test(icon) ? icon : undefined;
}

function providerFrom(value: unknown): InjectedProvider | undefined {
  try {
    if (!value || typeof value !== 'object') return undefined;
    const provider = value as InjectedProvider;
    return typeof provider.request === 'function' ? provider : undefined;
  } catch {
    return undefined;
  }
}

function announcementFrom(value: unknown): WalletProviderOption | undefined {
  try {
    if (!value || typeof value !== 'object') return undefined;
    const detail = value as { info?: unknown; provider?: unknown };
    if (!detail.info || typeof detail.info !== 'object') return undefined;
    const info = detail.info as { uuid?: unknown; name?: unknown; rdns?: unknown; icon?: unknown };
    const id = safeText(info.uuid, 36);
    const name = safeText(info.name, 64);
    const rdns = safeText(info.rdns, 255);
    const provider = providerFrom(detail.provider);
    if (!id || !UUID_V4.test(id) || !name || !rdns || !provider) return undefined;
    return Object.freeze({ id: id.toLowerCase(), name, rdns, icon: safeIcon(info.icon), provider, source: 'eip6963' });
  } catch {
    return undefined;
  }
}

function publish(next: readonly WalletProviderOption[]) {
  snapshot = Object.freeze([...next]);
  subscribers.forEach(listener => listener());
}

function registerAnnouncement(event: Event) {
  if (!(event instanceof CustomEvent)) return;
  const announced = announcementFrom(event.detail);
  if (!announced) return;

  const eipProviders = snapshot.filter(option => option.source === 'eip6963');
  const sameProvider = eipProviders.find(option => option.provider === announced.provider);
  if (sameProvider) {
    if (snapshot.length !== eipProviders.length) publish(eipProviders);
    return;
  }
  if (eipProviders.some(option => option.id === announced.id) || eipProviders.length >= MAX_PROVIDERS) {
    if (snapshot.length !== eipProviders.length) publish(eipProviders);
    return;
  }
  publish([...eipProviders, announced]);
}

function legacyProvider(): InjectedProvider | undefined {
  try {
    return providerFrom(window.ethereum);
  } catch {
    return undefined;
  }
}

function registerLegacyProvider() {
  if (snapshot.some(option => option.source === 'eip6963')) return;
  const provider = legacyProvider();
  if (!provider || snapshot.some(option => option.provider === provider)) return;
  publish([Object.freeze({
    id: 'legacy-browser-wallet',
    name: 'Browser wallet',
    provider,
    source: 'legacy',
  })]);
}

function startWalletDiscovery() {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('eip6963:announceProvider', registerAnnouncement);
  window.addEventListener('ethereum#initialized', registerLegacyProvider, { once: true });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  registerLegacyProvider();
  window.setTimeout(registerLegacyProvider, 3_000);
}

export function subscribeWalletProviders(listener: () => void) {
  startWalletDiscovery();
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

export function getWalletProvidersSnapshot() {
  startWalletDiscovery();
  return snapshot;
}

export function getEmptyWalletProvidersSnapshot() {
  return EMPTY;
}

startWalletDiscovery();
