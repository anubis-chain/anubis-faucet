import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../config.js';
import { baseEnv } from './helpers.js';

test('loads the complete fail-closed production contract', () => {
  const config = loadConfig(baseEnv);
  assert.equal(config.faucetEnabled, true);
  assert.equal(config.allowedClaimAddress, null);
  assert.equal(config.chainId, 202601);
  assert.equal(config.tokenAmount, 10n ** 18n);
  assert.equal(config.tokenCodeHash, baseEnv.TOKEN_CODE_HASH);
  assert.equal('dailyClaimCap' in config, false);
  assert.deepEqual(config.allowedOrigins, ['https://faucet.example.test']);
});

test('ignores the removed legacy daily-cap environment setting', () => {
  const config = loadConfig({ ...baseEnv, DAILY_CLAIM_CAP: '1' });
  assert.equal('dailyClaimCap' in config, false);
});

test('normalizes an optional single-recipient staging restriction', () => {
  const config = loadConfig({ ...baseEnv, ALLOWED_CLAIM_ADDRESS: '0x111111111111111111111111111111111111111A' });
  assert.equal(config.allowedClaimAddress, '0x111111111111111111111111111111111111111a');
  assert.throws(() => loadConfig({ ...baseEnv, ALLOWED_CLAIM_ADDRESS: '0x1234' }), /ALLOWED_CLAIM_ADDRESS/);
});

test('enabled staging fails closed without one approved recipient', () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, APP_STAGE: 'staging', ALLOWED_CLAIM_ADDRESS: '' }),
    /Enabled staging requires ALLOWED_CLAIM_ADDRESS/,
  );
  const config = loadConfig({
    ...baseEnv,
    APP_STAGE: 'staging',
    ALLOWED_CLAIM_ADDRESS: '0x1111111111111111111111111111111111111111',
  });
  assert.equal(config.allowedClaimAddress, '0x1111111111111111111111111111111111111111');
});

test('only the exact lowercase true string enables claims', () => {
  for (const value of [undefined, '', 'false', 'TRUE', '1', ' true ']) {
    const config = loadConfig({ ...baseEnv, FAUCET_ENABLED: value });
    assert.equal(config.faucetEnabled, false);
  }
});

test('rejects missing safety caps, non-HTTPS RPC and invalid token identity', () => {
  for (const [key, value] of [
    ['MAX_GAS_LIMIT', ''],
    ['MAX_TOTAL_FEE_WEI', '0'],
    ['RPC_URL', 'http://rpc.example.test'],
    ['TOKEN_CODE_HASH', '0x1234'],
    ['TOKEN_DECIMALS', '6'],
    ['TRUST_CLOUDFRONT_VIEWER_ADDRESS', 'false'],
  ]) assert.throws(() => loadConfig({ ...baseEnv, [key]: value }), /configuration|RPC_URL|pre-Aria|CloudFront/i);
});

test('permits a stricter total fee cap than the product of independent maxima', () => {
  const config = loadConfig({ ...baseEnv, MAX_TOTAL_FEE_WEI: '1000' });
  assert.equal(config.maxTotalFee, 1000n);
});
