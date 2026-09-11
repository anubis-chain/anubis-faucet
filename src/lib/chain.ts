import { defineChain } from 'viem';
import faucetConfig from './faucet-config.json';
import { brand } from './brand';

type FaucetConfig = {
  chain: {
    name?: string;
    id: number | null;
    rpcUrl: string;
    blockExplorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
  };
  tokens: { address: `0x${string}`; name: string; symbol: string; decimals: number }[];
  distribution: { nativeAmount: string; tokenAmount: string; rateLimitHours: string };
};

const config = faucetConfig as FaucetConfig;
const { chain } = config;
function isHttpUrl(value: string) {
  try { return ['https:', 'http:'].includes(new URL(value).protocol); }
  catch { return false; }
}

// No fallback network: wallet actions require actual Anubis parameters.
export const anubisTestnet = chain.id !== null && Number.isSafeInteger(chain.id) && chain.id > 0
  && isHttpUrl(chain.rpcUrl) && chain.nativeCurrency.name && chain.nativeCurrency.symbol
  ? defineChain({
    id: chain.id,
    name: chain.name || brand.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: { default: { http: [chain.rpcUrl] } },
    ...(isHttpUrl(chain.blockExplorer) ? {
      blockExplorers: { default: { name: 'Anubis Testnet Explorer', url: chain.blockExplorer } },
    } : {}),
    testnet: true,
  }) : null;

export const tokens = anubisTestnet ? config.tokens : [];
export const distribution = config.distribution;
export const docsUrl = brand.docs;
