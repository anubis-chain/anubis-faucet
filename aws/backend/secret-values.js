const PRIVATE_KEY = /^0x[\da-f]{64}$/i;
const SECP256K1_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const TURNSTILE_TEST_SECRETS = new Set([
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
]);

function validPrivateKey(value) {
  if (!PRIVATE_KEY.test(value || '')) return false;
  const scalar = BigInt(value);
  return scalar > 0n && scalar < SECP256K1_ORDER;
}

function validTurnstileSecret(value) {
  if (typeof value !== 'string' || value.length < 8) return false;
  if (TURNSTILE_TEST_SECRETS.has(value)) return false;
  return !/^(?:REPLACE_WITH_|PLACEHOLDER|YOUR[_-])/i.test(value);
}

export function parseSecretDocument(value) {
  let parsed;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    throw new Error('Faucet secret must be valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Faucet secret must be a JSON object.');
  const keys = Object.keys(parsed).sort();
  if (keys.join(',') !== 'ipPepper,privateKey,turnstileSecret') throw new Error('Faucet secret has an invalid schema.');
  if (!validPrivateKey(parsed.privateKey)) throw new Error('Faucet secret privateKey is invalid.');
  if (!validTurnstileSecret(parsed.turnstileSecret)) throw new Error('Faucet secret turnstileSecret is invalid.');
  if (typeof parsed.ipPepper !== 'string' || Buffer.byteLength(parsed.ipPepper, 'utf8') < 32) throw new Error('Faucet secret ipPepper must contain at least 32 bytes.');
  return Object.freeze({
    privateKey: parsed.privateKey,
    turnstileSecret: parsed.turnstileSecret,
    ipPepper: parsed.ipPepper,
  });
}
