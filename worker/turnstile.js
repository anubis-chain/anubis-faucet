import { HttpError } from './errors.js';

export function createVerifier(config, fetcher = fetch) {
  return async (token, ip) => {
    if (typeof token !== 'string' || !token.trim() || token.length > 2048) throw new HttpError(400, 'Please complete Cloudflare verification.');
    let result;
    try {
      const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: config.turnstileSecret, response: token, remoteip: ip }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('Siteverify unavailable');
      result = await response.json();
    } catch { throw new HttpError(503, 'Verification is temporarily unavailable. Please try again.'); }
    if (result.success !== true || !config.turnstile.hostnames.includes(result.hostname) || result.action !== config.turnstile.action) {
      throw new HttpError(400, 'Cloudflare verification failed or expired. Please verify again.');
    }
  };
}
