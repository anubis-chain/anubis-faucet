import { isAddress } from 'viem';
import { anubisTestnet } from './chain';

export const apiBase = import.meta.env.VITE_FAUCET_API_URL?.trim().replace(/\/$/, '') || '';
export const apiConfigured = Boolean(import.meta.env.VITE_FAUCET_API_URL?.trim());
export const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

export function isRecipient(value: string): boolean {
  return isAddress(value, { strict: false }) && !/^0x0{40}$/i.test(value);
}

export type DistributionResult = { status: 'submitted'; txHashes: string[] };

async function sha256Hex(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (!apiConfigured) throw new Error('This local replica is not connected to a token distribution service.');
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  if (typeof init?.body === 'string') headers.set('x-amz-content-sha256', await sha256Hex(init.body));
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(60000),
  });
  const data = await response.json().catch(() => ({})) as { error?: unknown };
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'The request failed. Please try again.');
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
