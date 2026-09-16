import * as fs from 'node:fs';
import * as path from 'node:path';
import { App } from 'aws-cdk-lib';

export type DeploymentStage = 'staging' | 'production';

const APPROVED_TURNSTILE_SITE_KEY = '0x4AAAAAAEv-TZyEqCPXlFdQ';

export interface FaucetRuntimeConfig {
  readonly chainId: number;
  readonly chainName: string;
  readonly rpcUrl: string;
  readonly nativeCurrencyName: string;
  readonly nativeCurrencySymbol: string;
  readonly tokenAddress: string;
  readonly tokenDecimals: number;
  readonly tokenAmount: string;
  readonly cooldownHours: number;
}

export interface StageConfig {
  readonly stage: DeploymentStage;
  readonly domainName: string;
  readonly certificateArn: string;
  readonly primaryRegion: string;
  readonly siteAssetPath: string;
  readonly backendAssetPath: string;
  readonly apiHandler: string;
  readonly reconcileHandler: string;
  readonly faucetEnabled: boolean;
  readonly allowedClaimAddress?: string;
  readonly rateLimitPerFiveMinutes: number;
  readonly runtime: FaucetRuntimeConfig;
}

function contextString(app: App, key: string, fallback?: string): string {
  const value = app.node.tryGetContext(key) ?? fallback;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing non-empty CDK context value: ${key}`);
  }
  return value.trim();
}

function assetDirectory(app: App, key: string, fallback: string): string {
  const configured = contextString(app, key, fallback);
  const absolute = path.resolve(__dirname, '..', configured);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
    throw new Error(
      `${key} does not exist or is not a directory: ${absolute}. ` +
      'Build the artifact first, or override the path with -c ' + `${key}=<directory>.`,
    );
  }
  return absolute;
}

function siteAssetDirectory(app: App): string {
  const absolute = assetDirectory(app, 'siteAssetPath', '../dist');
  const textAssets: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const item = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(item);
      else if (/\.(?:css|html|js)$/i.test(entry.name)) textAssets.push(fs.readFileSync(item, 'utf8'));
    }
  };
  visit(absolute);
  const bundle = textAssets.join('\n');
  if (/[123]x0{16,}[A-Z]{2}/.test(bundle)) {
    throw new Error('siteAssetPath contains a Cloudflare Turnstile test key; rebuild with the approved production key.');
  }
  if (!bundle.includes(APPROVED_TURNSTILE_SITE_KEY)) {
    throw new Error('siteAssetPath does not contain the approved Anubis Faucet Turnstile site key.');
  }
  return absolute;
}

function loadRuntimeConfig(): FaucetRuntimeConfig {
  const configPath = path.resolve(__dirname, '..', '..', 'src', 'lib', 'faucet-config.json');
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
    chain: {
      id: number;
      name?: string;
      rpcUrl: string;
      nativeCurrency: { name: string; symbol: string };
    };
    tokens: Array<{ address: string; decimals: number }>;
    distribution: { tokenAmount: string; rateLimitHours: number };
  };
  const token = raw.tokens?.[0];
  if (!Number.isSafeInteger(raw.chain?.id) || !raw.chain?.rpcUrl || !token?.address) {
    throw new Error(`Invalid faucet runtime configuration in ${configPath}`);
  }
  return {
    chainId: raw.chain.id,
    chainName: raw.chain.name ?? 'Anubis Test',
    rpcUrl: raw.chain.rpcUrl,
    nativeCurrencyName: raw.chain.nativeCurrency.name,
    nativeCurrencySymbol: raw.chain.nativeCurrency.symbol,
    tokenAddress: token.address,
    tokenDecimals: token.decimals,
    tokenAmount: raw.distribution.tokenAmount,
    cooldownHours: Number(raw.distribution.rateLimitHours),
  };
}

export function loadStageConfig(app: App): StageConfig {
  const stage = contextString(app, 'stage', 'staging');
  if (stage !== 'staging' && stage !== 'production') {
    throw new Error('CDK context stage must be either staging or production.');
  }
  const certificateKey = stage === 'production' ? 'certificateArnProduction' : 'certificateArnStaging';
  const certificateArn = contextString(app, certificateKey);
  if (!/^arn:[^:]+:acm:us-east-1:\d{12}:certificate\/[0-9a-f-]+$/i.test(certificateArn)) {
    throw new Error(`${certificateKey} must be an ACM certificate ARN from us-east-1.`);
  }
  const rateLimit = Number(app.node.tryGetContext('rateLimitPerFiveMinutes') ?? 100);
  if (!Number.isInteger(rateLimit) || rateLimit < 10) {
    throw new Error('rateLimitPerFiveMinutes must be an integer of at least 10.');
  }
  const enabledContext = app.node.tryGetContext('faucetEnabled') ?? false;
  const faucetEnabled = enabledContext === true || enabledContext === 'true';
  if (![true, false, 'true', 'false'].includes(enabledContext)) {
    throw new Error('faucetEnabled must be true or false.');
  }
  const allowedClaimAddressContext = app.node.tryGetContext('allowedClaimAddress');
  let allowedClaimAddress: string | undefined;
  if (allowedClaimAddressContext !== undefined) {
    if (typeof allowedClaimAddressContext !== 'string' || !/^0x[\da-f]{40}$/i.test(allowedClaimAddressContext) || /^0x0{40}$/i.test(allowedClaimAddressContext)) {
      throw new Error('allowedClaimAddress must be a non-zero EVM address when provided.');
    }
    allowedClaimAddress = allowedClaimAddressContext.toLowerCase();
  }
  if (stage === 'staging' && faucetEnabled && !allowedClaimAddress) {
    throw new Error('Enabled staging requires -c allowedClaimAddress=<non-zero EVM address>.');
  }

  return {
    stage,
    domainName: stage === 'production' ? 'anubisfaucets.com' : 'staging.anubisfaucets.com',
    certificateArn,
    primaryRegion: contextString(app, 'primaryRegion', 'ap-southeast-1'),
    siteAssetPath: siteAssetDirectory(app),
    backendAssetPath: assetDirectory(app, 'backendAssetPath', '../aws/backend/dist'),
    apiHandler: contextString(app, 'apiHandler', 'api.handler'),
    reconcileHandler: contextString(app, 'reconcileHandler', 'reconcile.handler'),
    faucetEnabled,
    allowedClaimAddress,
    rateLimitPerFiveMinutes: rateLimit,
    runtime: loadRuntimeConfig(),
  };
}
