import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Only the wallet test server uses this fixture. Production uses the app JSON.
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_FAUCET_API_URL': JSON.stringify('http://127.0.0.1:3001'),
    'import.meta.env.VITE_TURNSTILE_SITE_KEY': JSON.stringify('test-widget-sitekey'),
  },
  resolve: { alias: [{ find: './faucet-config.json', replacement: fileURLToPath(new URL('./fixtures/faucet-config.json', import.meta.url)) }] },
  server: { host: '127.0.0.1', port: 4189, strictPort: true },
});
