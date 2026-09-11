import { loadConfig } from './config.js';
import { ClaimStore } from './store.js';
import { createVerifier } from './turnstile.js';
import { createSender } from './sender.js';
import { createService } from './service.js';
import { handleApi } from './http.js';

function runtime(env) {
  const config = loadConfig(env);
  const store = new ClaimStore(env.DB, config.cooldownMs);
  const service = createService({ store, sender: createSender(config), verify: createVerifier(config) });
  return { config, store, service };
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      const { config, store, service } = runtime(env);
      if (path === '/api/health' && request.method === 'GET') {
        await store.pending();
        return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
      }
      const response = await handleApi(request, config, service);
      if (response.status === 202) ctx.waitUntil(service.settle().catch(() => console.error('Transaction reconciliation deferred to cron.')));
      return response;
    } catch {
      return Response.json({ error: 'The faucet is not ready. Check network configuration, D1 migrations and Worker secrets.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      try { await runtime(env).service.settle(); }
      catch { console.error('Faucet reconciliation failed. Check configuration and RPC availability.'); }
    })());
  },
};
