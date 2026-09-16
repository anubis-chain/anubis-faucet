import { isAddress, parseUnits } from 'viem';
import faucetConfig from '../src/lib/faucet-config.json' with { type: 'json' };
import workerConfig from './config.json' with { type: 'json' };

export function loadConfig(env, faucet = faucetConfig, settings = workerConfig) {
  const fail = message => { throw new Error(`Invalid faucet configuration: ${message}`); };
  const url = value => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } };
  if (!Number.isSafeInteger(faucet.chain.id) || faucet.chain.id <= 0 || !url(faucet.chain.rpcUrl)) fail('chain ID and RPC URL are required');
  const currency = faucet.chain.nativeCurrency;
  if (!currency.name || !currency.symbol || !Number.isInteger(currency.decimals) || currency.decimals < 0 || currency.decimals > 18) fail('native currency is required');
  if (!Array.isArray(faucet.tokens) || faucet.tokens.length !== 1) fail('exactly one ERC-20 token is required');
  const token = faucet.tokens[0];
  if (!recipient(token.address) || !token.name || !token.symbol || !Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 18) fail('valid ERC-20 address, name, symbol and decimals are required');
  if (faucet.distribution.nativeAmount !== '') fail('nativeAmount must be empty; this faucet sends ERC-20 only');
  const configuredAmount = faucet.distribution.tokenAmount;
  if (typeof configuredAmount !== 'string' || !/^\d+(\.\d+)?$/.test(configuredAmount) || (configuredAmount.split('.')[1]?.length || 0) > token.decimals) fail('tokenAmount must be a positive decimal amount within token precision');
  const amount = parseUnits(configuredAmount, token.decimals);
  if (amount <= 0n || amount >= 2n ** 256n) fail('tokenAmount must be positive and fit uint256');
  const hours = Number(faucet.distribution.rateLimitHours);
  if (!Number.isFinite(hours) || hours <= 0) fail('rateLimitHours must be positive');
  if (!/^0x[\da-f]{64}$/i.test(env.FAUCET_PRIVATE_KEY || '')) fail('FAUCET_PRIVATE_KEY secret is required');
  if (!env.TURNSTILE_SECRET_KEY) fail('TURNSTILE_SECRET_KEY secret is required');
  if (!Array.isArray(settings.allowedOrigins) || !settings.allowedOrigins.every(origin => url(origin) && new URL(origin).origin === origin)) fail('allowedOrigins must contain exact origins');
  if (!Array.isArray(settings.turnstile.hostnames) || !settings.turnstile.hostnames.length || !settings.turnstile.hostnames.every(h => typeof h === 'string' && h && !h.includes('/'))) fail('Turnstile hostnames are required');
  if (settings.turnstile.action !== 'faucet_claim') fail('Turnstile action must be faucet_claim');
  return { ...settings, faucet, token, amount, cooldownMs: hours * 3600000, privateKey: env.FAUCET_PRIVATE_KEY, turnstileSecret: env.TURNSTILE_SECRET_KEY };
}

export function recipient(value) {
  if (typeof value !== 'string' || !isAddress(value, { strict: false }) || /^0x0{40}$/i.test(value)) return null;
  return value.toLowerCase();
}
