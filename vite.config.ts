import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const productionTurnstileSiteKey = '0x4AAAAAAEv-TZyEqCPXlFdQ';

export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    const loaded = loadEnv(mode, process.cwd(), '');
    const apiUrl = process.env.VITE_FAUCET_API_URL ?? loaded.VITE_FAUCET_API_URL;
    const siteKey = process.env.VITE_TURNSTILE_SITE_KEY ?? loaded.VITE_TURNSTILE_SITE_KEY;
    if (apiUrl !== '/') {
      throw new Error('Production builds require VITE_FAUCET_API_URL=/ for the CloudFront same-origin API.');
    }
    if (siteKey !== productionTurnstileSiteKey) {
      throw new Error('Production builds require the approved Anubis Faucet Turnstile site key.');
    }
  }

  return {
    plugins: [react()],
    server: { port: 5173, strictPort: true },
  };
});
