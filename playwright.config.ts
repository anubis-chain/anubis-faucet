import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testIgnore: '**/worker/**',
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [{
    command: 'npm run build && npm run preview -- --port 4173',
    env: {
      VITE_FAUCET_API_URL: '/',
      VITE_TURNSTILE_SITE_KEY: '0x4AAAAAAEv-TZyEqCPXlFdQ',
    },
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  }, {
    command: 'npx vite --config tests/wallet.vite.config.ts',
    url: 'http://127.0.0.1:4189',
    reuseExistingServer: false,
  }],
});
