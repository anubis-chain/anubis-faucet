import { isAddress } from 'viem';
import { anubisTestnet } from './chain';

export const apiBase = import.meta.env.VITE_FAUCET_API_URL?.trim().replace(/\/$/, '') || '';
export const apiConfigured = Boolean(import.meta.env.VITE_FAUCET_API_URL?.trim());
export const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

export function isRecipient(value: string): boolean {
  return isAddress(value, { strict: false }) && !/^0x0{40}$/i.test(value);
}

export type DistributionResult = { status: 'submitted'; txHashes: string[] };

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (!apiConfigured) throw new Error('This local replica is not connected to a token distribution service.');
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    signal: AbortSignal.timeout(60000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request failed. Please try again.');
  return data as T;
}

export async function distribute(recipientAddress: string, turnstileToken: string) {
  if (!anubisTestnet) throw new Error('Anubis Testnet network details are not configured yet.');
  const result = await apiRequest<DistributionResult>('/api/distribute', {
    method: 'POST',
    body: JSON.stringify({ recipientAddress, turnstileToken }),
  });
  if (result.status !== 'submitted' || !Array.isArray(result.txHashes) || !result.txHashes.length || !result.txHashes.every(hash => /^0x[\da-f]{64}$/i.test(hash))) {
    throw new Error('The service did not return a valid transaction. Please check your wallet before retrying.');
  }
  return result;
}
