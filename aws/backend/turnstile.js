import { HttpError } from './errors.js';

export function createTurnstileVerifier(config, fetcher = fetch) {
  return {
    async verify(token, ip, secret) {
      if (typeof token !== 'string' || !token.trim() || token.length > 2048) {
        throw new HttpError(400, 'VERIFICATION_REQUIRED', 'Please complete the verification.');
      }
      let result;
      try {
        const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret, response: token, remoteip: ip }),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error('Turnstile returned a non-success status.');
        result = await response.json();
      } catch {
        throw new HttpError(503, 'VERIFICATION_UNAVAILABLE', 'Verification is temporarily unavailable. Please try again.');
      }
      const hostname = typeof result.hostname === 'string' ? result.hostname.toLowerCase() : '';
      if (result.success !== true || !config.turnstileHostnames.includes(hostname) || result.action !== config.turnstileAction) {
        throw new HttpError(400, 'VERIFICATION_FAILED', 'Verification failed or expired. Please verify again.');
      }
    },
  };
}
