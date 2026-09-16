const UINT256_LIMIT = 2n ** 256n;

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required configuration: ${name}`);
  return value;
}

function safeInteger(env, name, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback } = {}) {
  const raw = env[name]?.trim() || fallback;
  if (raw === undefined || !/^\d+$/.test(String(raw))) throw new Error(`Invalid integer configuration: ${name}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid integer configuration: ${name}`);
  return value;
}

function uint(env, name) {
  const raw = required(env, name);
  if (!/^\d+$/.test(raw)) throw new Error(`Invalid unsigned integer configuration: ${name}`);
  const value = BigInt(raw);
  if (value <= 0n || value >= UINT256_LIMIT) throw new Error(`Invalid unsigned integer configuration: ${name}`);
  return value;
}

function address(env, name) {
  const value = required(env, name);
  if (!/^0x[\da-f]{40}$/i.test(value) || /^0x0{40}$/i.test(value)) throw new Error(`Invalid EVM address configuration: ${name}`);
  return value.toLowerCase();
}

function optionalAddress(env, name) {
  const value = env[name]?.trim();
  if (!value) return null;
  if (!/^0x[\da-f]{40}$/i.test(value) || /^0x0{40}$/i.test(value)) throw new Error(`Invalid EVM address configuration: ${name}`);
  return value.toLowerCase();
}

function hash(env, name) {
  const value = required(env, name);
  if (!/^0x[\da-f]{64}$/i.test(value)) throw new Error(`Invalid hash configuration: ${name}`);
  return value.toLowerCase();
}

function urls(env, name) {
  const values = required(env, name).split(',').map(value => value.trim()).filter(Boolean);
  if (!values.length || !values.every(value => {
    try {
      const url = new URL(value);
      const localHttp = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname);
      return (url.protocol === 'https:' || localHttp) && url.origin === value;
    } catch {
      return false;
    }
  })) throw new Error(`Invalid origin list: ${name}`);
  return [...new Set(values)];
}

function hostnames(env, name) {
  const values = required(env, name).split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  if (!values.length || !values.every(value => /^[a-z0-9.-]+$/.test(value) && !value.startsWith('.') && !value.endsWith('.'))) {
    throw new Error(`Invalid hostname list: ${name}`);
  }
  return [...new Set(values)];
}

function boolean(env, name, fallback = false) {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`Invalid boolean configuration: ${name}`);
}

export function loadConfig(env = process.env) {
  const appStage = required(env, 'APP_STAGE');
  if (appStage !== 'staging' && appStage !== 'production') {
    throw new Error('APP_STAGE must be staging or production.');
  }
  const rpcUrl = required(env, 'RPC_URL');
  try {
    const parsed = new URL(rpcUrl);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname))) throw new Error();
  } catch {
    throw new Error('RPC_URL must be HTTPS (or loopback HTTP for tests).');
  }

  const maxGasLimit = uint(env, 'MAX_GAS_LIMIT');
  const maxFeePerGas = uint(env, 'MAX_FEE_PER_GAS_WEI');
  const maxPriorityFeePerGas = uint(env, 'MAX_PRIORITY_FEE_PER_GAS_WEI');
  const maxTotalFee = uint(env, 'MAX_TOTAL_FEE_WEI');
  if (maxPriorityFeePerGas > maxFeePerGas) throw new Error('MAX_PRIORITY_FEE_PER_GAS_WEI cannot exceed MAX_FEE_PER_GAS_WEI.');

  const tokenDecimals = safeInteger(env, 'TOKEN_DECIMALS', { min: 0, max: 18 });
  const tokenAmount = uint(env, 'TOKEN_AMOUNT_WEI');
  const nativeCurrencyDecimals = safeInteger(env, 'NATIVE_CURRENCY_DECIMALS', { min: 0, max: 18, fallback: '18' });
  if (tokenDecimals !== 18 || nativeCurrencyDecimals !== 18) {
    throw new Error('This pre-Aria DAI faucet requires 18-decimal token and fee units.');
  }
  const trustCloudFrontViewerAddress = boolean(env, 'TRUST_CLOUDFRONT_VIEWER_ADDRESS');
  if (!trustCloudFrontViewerAddress) {
    throw new Error('TRUST_CLOUDFRONT_VIEWER_ADDRESS must be true for the CloudFront-only production backend.');
  }
  const faucetEnabled = env.FAUCET_ENABLED === 'true';
  const allowedClaimAddress = optionalAddress(env, 'ALLOWED_CLAIM_ADDRESS');
  if (appStage === 'staging' && faucetEnabled && !allowedClaimAddress) {
    throw new Error('Enabled staging requires ALLOWED_CLAIM_ADDRESS.');
  }

  return Object.freeze({
    // Deliberately fail closed: only the exact lowercase string enables claims.
    faucetEnabled,
    allowedClaimAddress,
    tableName: required(env, 'DYNAMODB_TABLE_NAME'),
    secretId: required(env, 'FAUCET_SECRET_ID'),
    chainId: safeInteger(env, 'CHAIN_ID', { min: 1 }),
    chainName: required(env, 'CHAIN_NAME'),
    rpcUrl,
    nativeCurrencyName: required(env, 'NATIVE_CURRENCY_NAME'),
    nativeCurrencySymbol: required(env, 'NATIVE_CURRENCY_SYMBOL'),
    nativeCurrencyDecimals,
    tokenAddress: address(env, 'TOKEN_ADDRESS'),
    tokenCodeHash: hash(env, 'TOKEN_CODE_HASH'),
    tokenDecimals,
    tokenAmount,
    cooldownSeconds: safeInteger(env, 'COOLDOWN_SECONDS', { min: 60 }),
    preparingLeaseSeconds: safeInteger(env, 'PREPARING_LEASE_SECONDS', { min: 30, fallback: '300' }),
    tokenReplaySeconds: safeInteger(env, 'TOKEN_REPLAY_SECONDS', { min: 300, fallback: '86400' }),
    claimRetentionSeconds: safeInteger(env, 'CLAIM_RETENTION_SECONDS', { min: 86400, fallback: '7776000' }),
    maxGasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    maxTotalFee,
    minConfirmations: safeInteger(env, 'MIN_CONFIRMATIONS', { min: 1, max: 100, fallback: '1' }),
    allowedOrigins: urls(env, 'ALLOWED_ORIGINS'),
    turnstileHostnames: hostnames(env, 'TURNSTILE_HOSTNAMES'),
    turnstileAction: 'faucet_claim',
    trustCloudFrontViewerAddress,
    secretsCacheMs: safeInteger(env, 'SECRETS_CACHE_MS', { min: 0, fallback: '300000' }),
  });
}
