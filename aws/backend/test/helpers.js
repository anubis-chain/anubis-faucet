export const baseEnv = Object.freeze({
  APP_STAGE: 'production',
  FAUCET_ENABLED: 'true',
  DYNAMODB_TABLE_NAME: 'anubis-faucet-test',
  FAUCET_SECRET_ID: 'anubis/faucet/test',
  CHAIN_ID: '202601',
  CHAIN_NAME: 'Anubis Test',
  RPC_URL: 'https://rpc.example.test',
  NATIVE_CURRENCY_NAME: 'DAI',
  NATIVE_CURRENCY_SYMBOL: 'DAI',
  NATIVE_CURRENCY_DECIMALS: '18',
  TOKEN_ADDRESS: '0x83fd06F0846d9D90B3016bF670Efe2E0B11cDe14',
  TOKEN_CODE_HASH: '0x938e093ab3e0191198ae5403f54f3725467fb6ac0ed1c0d0f9bacfdad2a242c7',
  TOKEN_DECIMALS: '18',
  TOKEN_AMOUNT_WEI: '1000000000000000000',
  COOLDOWN_SECONDS: '86400',
  PREPARING_LEASE_SECONDS: '300',
  TOKEN_REPLAY_SECONDS: '86400',
  CLAIM_RETENTION_SECONDS: '7776000',
  DAILY_CLAIM_CAP: '100',
  MAX_GAS_LIMIT: '150000',
  MAX_FEE_PER_GAS_WEI: '100000000000',
  MAX_PRIORITY_FEE_PER_GAS_WEI: '10000000000',
  MAX_TOTAL_FEE_WEI: '15000000000000000',
  MIN_CONFIRMATIONS: '1',
  ALLOWED_ORIGINS: 'https://faucet.example.test',
  TURNSTILE_HOSTNAMES: 'faucet.example.test',
  TRUST_CLOUDFRONT_VIEWER_ADDRESS: 'true',
  SECRETS_CACHE_MS: '300000',
});

export const planConfig = Object.freeze({
  cooldownSeconds: 86400,
  preparingLeaseSeconds: 300,
  tokenReplaySeconds: 86400,
  claimRetentionSeconds: 7776000,
  dailyClaimCap: 100,
});

export function memoryLogger() {
  const records = [];
  const append = level => (event, fields = {}) => records.push({ level, event, ...fields });
  return { records, info: append('info'), warn: append('warn'), error: append('error') };
}
