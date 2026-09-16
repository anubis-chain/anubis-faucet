import { test, expect } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4189' });

test('uses configured Anubis metadata and handles wallet rejection', async ({ page }) => {
  await page.addInitScript(() => {
    let connected = false;
    let rejectImport = false;
    let networkAdded = false;
    let chainId = '0x1';
    const calls: { method: string; params?: unknown }[] = [];
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const account = '0x1111111111111111111111111111111111111111';
    const provider = {
      isMetaMask: true,
      on(event: string, listener: (...args: unknown[]) => void) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(listener);
      },
      removeListener(event: string, listener: (...args: unknown[]) => void) { listeners.get(event)?.delete(listener); },
      async request(request: { method: string; params?: unknown }) {
        calls.push(request);
        if (request.method === 'eth_requestAccounts') { connected = true; return [account]; }
        if (request.method === 'eth_accounts') return connected ? [account] : [];
        if (request.method === 'eth_chainId') return chainId;
        if (request.method === 'wallet_requestPermissions' || request.method === 'wallet_getPermissions') return [{ parentCapability: 'eth_accounts' }];
        if (request.method === 'eth_getBalance') return '0x0';
        if (request.method === 'wallet_watchAsset') {
          if (rejectImport) throw Object.assign(new Error('User rejected the request'), { code: 4001 });
          return true;
        }
        if (request.method === 'wallet_addEthereumChain') {
          networkAdded = true;
          chainId = '0x7a69';
          listeners.get('chainChanged')?.forEach(listener => listener(chainId));
          return null;
        }
        if (request.method === 'wallet_switchEthereumChain') {
          if (!networkAdded) throw Object.assign(new Error('Unknown chain'), { code: 4902 });
          chainId = '0x7a69';
          listeners.get('chainChanged')?.forEach(listener => listener(chainId));
          return null;
        }
        throw Object.assign(new Error(`Unsupported test method: ${request.method}`), { code: 4200 });
      },
    };
    Object.assign(window, { ethereum: provider, walletTest: { calls, rejectImport: () => { rejectImport = true; } } });
  });
  await page.route('http://127.0.0.1:8545/**', async route => {
    const data = route.request().postDataJSON();
    const result = (request: { id: number; method: string }) => ({ jsonrpc: '2.0', id: request.id, result: request.method === 'eth_chainId' ? '0x7a69' : '0x0' });
    await route.fulfill({ json: Array.isArray(data) ? data.map(result) : result(data) });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await expect(page.getByLabel('Send to', { exact: true })).toHaveValue('0x1111111111111111111111111111111111111111');
  await expect(page.getByRole('button', { name: 'Add testnet to your wallet', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Import TEST to your wallet', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('TEST imported');
  const requests = await page.evaluate(() => (window as unknown as { walletTest: { calls: { method: string; params: unknown }[] } }).walletTest.calls);
  expect(requests.some(request => request.method === 'eth_requestAccounts')).toBe(true);
  expect(requests.some(request => request.method === 'wallet_switchEthereumChain')).toBe(true);
  expect(requests.find(request => request.method === 'wallet_addEthereumChain')?.params).toMatchObject([{
    chainId: '0x7a69', chainName: 'Anubis Testnet',
    rpcUrls: ['http://127.0.0.1:8545'],
    blockExplorerUrls: ['https://explorer.example.test'],
    nativeCurrency: { name: 'Test currency', symbol: 'TEST', decimals: 18 },
  }]);
  expect(requests.find(request => request.method === 'wallet_watchAsset')?.params).toMatchObject({
    type: 'ERC20',
    options: { address: '0x2222222222222222222222222222222222222222', symbol: 'TEST', decimals: 18 },
  });
  await page.getByRole('link', { name: 'Add testnet', exact: true }).click();
  await expect(page.locator('dd').first()).toHaveText('Anubis Testnet');
  await expect(page.getByText('31337', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add Anubis Testnet to your wallet', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Anubis Testnet is ready');
  await page.getByRole('link', { name: 'Back to faucet', exact: true }).click();
  await page.evaluate(() => (window as unknown as { walletTest: { rejectImport: () => void } }).walletTest.rejectImport());
  await page.getByRole('button', { name: 'Import TEST to your wallet', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('not completed');
  expect(requests.some(request => ['eth_sendTransaction', 'personal_sign', 'eth_sign'].includes(request.method))).toBe(false);
});

test('selects an announced EIP-6963 wallet and keeps every wallet action on that provider', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.addInitScript(() => {
    type WalletRequest = { method: string; params?: unknown };
    const calls: Record<string, WalletRequest[]> = { legacy: [], metamask: [], rabby: [], imposter: [] };
    const listeners: Record<string, Map<string, Set<(value: unknown) => void>>> = {};
    const makeProvider = (key: string, account: string) => {
      let chainId = '0x1';
      let networkAdded = false;
      listeners[key] = new Map();
      return {
        on(event: string, listener: (value: unknown) => void) {
          if (!listeners[key].has(event)) listeners[key].set(event, new Set());
          listeners[key].get(event)!.add(listener);
        },
        removeListener(event: string, listener: (value: unknown) => void) { listeners[key].get(event)?.delete(listener); },
        async request(request: WalletRequest) {
          calls[key].push(request);
          if (request.method === 'eth_accounts') return [];
          if (request.method === 'eth_requestAccounts') return [account];
          if (request.method === 'eth_chainId') return chainId;
          if (request.method === 'wallet_switchEthereumChain') {
            if (!networkAdded) throw Object.assign(new Error('Unknown chain'), { code: 4902 });
            chainId = '0x7a69';
            listeners[key].get('chainChanged')?.forEach(listener => listener(chainId));
            return null;
          }
          if (request.method === 'wallet_addEthereumChain') {
            networkAdded = true;
            chainId = '0x7a69';
            listeners[key].get('chainChanged')?.forEach(listener => listener(chainId));
            return null;
          }
          if (request.method === 'wallet_watchAsset') return true;
          throw Object.assign(new Error(`Unsupported test method: ${request.method}`), { code: 4200 });
        },
      };
    };

    const providers = {
      legacy: makeProvider('legacy', '0x9999999999999999999999999999999999999999'),
      metamask: makeProvider('metamask', '0x1111111111111111111111111111111111111111'),
      rabby: makeProvider('rabby', '0x2222222222222222222222222222222222222222'),
      imposter: makeProvider('imposter', '0x3333333333333333333333333333333333333333'),
    };
    const announce = (info: Record<string, string>, provider: unknown) => {
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info, provider } }));
    };
    const metamask = {
      uuid: '11111111-1111-4111-8111-111111111111',
      name: 'MetaMask',
      rdns: 'io.metamask',
      icon: 'javascript:alert(1)',
    };
    const rabby = {
      uuid: '22222222-2222-4222-8222-222222222222',
      name: 'Rabby',
      rdns: 'io.rabby',
      icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E',
    };
    window.addEventListener('eip6963:requestProvider', () => {
      announce(metamask, providers.metamask);
      announce(metamask, providers.metamask);
      announce({ ...metamask, name: 'Imposter' }, providers.imposter);
      announce(rabby, providers.rabby);
      announce({ ...rabby, uuid: 'not-a-uuid', name: 'Invalid wallet' }, providers.imposter);
    });
    Object.assign(window, {
      ethereum: providers.legacy,
      walletTest: {
        calls,
        emit: (key: string, event: string, value: unknown) => listeners[key].get(event)?.forEach(listener => listener(value)),
      },
    });
  });

  await page.route('http://127.0.0.1:8545/**', async route => {
    const data = route.request().postDataJSON();
    const result = (request: { id: number; method: string }) => ({ jsonrpc: '2.0', id: request.id, result: request.method === 'eth_chainId' ? '0x7a69' : '0x0' });
    await route.fulfill({ json: Array.isArray(data) ? data.map(result) : result(data) });
  });
  await page.goto('/');
  const selectWallet = page.getByRole('button', { name: 'Select wallet', exact: true });
  await expect(selectWallet).toBeVisible();

  await selectWallet.click();
  let dialog = page.getByRole('dialog', { name: 'Select wallet' });
  await expect(dialog.getByRole('button', { name: /Connect MetaMask/ })).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: /Connect Rabby/ })).toHaveCount(1);
  await expect(dialog.getByText('Imposter')).toHaveCount(0);
  await expect(dialog.getByText('Invalid wallet')).toHaveCount(0);
  await expect(dialog.locator('img')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(320);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(selectWallet).toBeFocused();

  await page.getByRole('button', { name: 'Import TEST to your wallet', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Select wallet' });
  await dialog.getByRole('button', { name: /Connect Rabby/ }).click();
  await expect(page.getByRole('status')).toContainText('TEST imported');
  await expect(page.getByLabel('Send to', { exact: true })).toHaveValue('0x2222222222222222222222222222222222222222');
  await expect(page.getByRole('button', { name: '0x2222…2222', exact: true })).toBeVisible();

  let recorded = await page.evaluate(() => (window as unknown as { walletTest: { calls: Record<string, { method: string }[]> } }).walletTest.calls);
  expect(recorded.legacy).toEqual([]);
  expect(recorded.metamask).toEqual([]);
  expect(recorded.imposter).toEqual([]);
  expect(recorded.rabby.some(request => request.method === 'eth_requestAccounts')).toBe(true);
  expect(recorded.rabby.some(request => request.method === 'wallet_addEthereumChain')).toBe(true);
  expect(recorded.rabby.some(request => request.method === 'wallet_watchAsset')).toBe(true);

  await page.getByRole('button', { name: '0x2222…2222', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Select wallet' });
  await expect(dialog.getByText('Selected', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: /Connect MetaMask/ }).click();
  await expect(page.getByRole('button', { name: 'Add testnet to your wallet', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add testnet to your wallet', exact: true }).click();
  await expect(page.getByRole('button', { name: '0x1111…1111', exact: true })).toBeVisible();
  await expect(page.getByLabel('Send to', { exact: true })).toHaveValue('0x1111111111111111111111111111111111111111');

  await page.evaluate(() => (window as unknown as { walletTest: { emit: (key: string, event: string, value: unknown) => void } }).walletTest.emit(
    'rabby',
    'accountsChanged',
    ['0x4444444444444444444444444444444444444444'],
  ));
  await expect(page.getByRole('button', { name: '0x1111…1111', exact: true })).toBeVisible();

  recorded = await page.evaluate(() => (window as unknown as { walletTest: { calls: Record<string, { method: string }[]> } }).walletTest.calls);
  const methods = Object.values(recorded).flat().map(request => request.method);
  expect(methods).not.toContain('eth_sendTransaction');
  expect(methods).not.toContain('personal_sign');
  expect(methods).not.toContain('eth_sign');
  expect(methods).not.toContain('wallet_requestPermissions');
  expect(methods).not.toContain('wallet_getPermissions');
});

test('accepts a valid late EIP-6963 announcement without reloading', async ({ page }) => {
  await page.addInitScript(() => {
    const calls: string[] = [];
    const provider = (account: string) => ({
      request: async ({ method }: { method: string }) => {
        calls.push(method);
        if (method === 'eth_accounts') return [];
        if (method === 'eth_requestAccounts') return [account];
        if (method === 'eth_chainId') return '0x7a69';
        throw Object.assign(new Error(`Unsupported test method: ${method}`), { code: 4200 });
      },
    });
    const first = provider('0x1111111111111111111111111111111111111111');
    const late = provider('0x2222222222222222222222222222222222222222');
    const announce = (uuid: string, name: string, rdns: string, selected: unknown) => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
      detail: { info: { uuid, name, rdns, icon: '' }, provider: selected },
    }));
    window.addEventListener('eip6963:requestProvider', () => announce('11111111-1111-4111-8111-111111111111', 'First wallet', 'example.first', first));
    Object.assign(window, {
      walletTest: {
        calls,
        announceLate: () => announce('22222222-2222-4222-8222-222222222222', 'Late wallet', 'example.late', late),
      },
    });
  });

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
  await page.evaluate(() => (window as unknown as { walletTest: { announceLate: () => void } }).walletTest.announceLate());
  await expect(page.getByRole('button', { name: 'Select wallet', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Select wallet', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Select wallet' });
  await expect(dialog.getByRole('button', { name: /Connect First wallet/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Connect Late wallet/ })).toBeVisible();
});

test('detects a late legacy wallet that emits no initialization event', async ({ page }) => {
  await page.addInitScript(() => {
    delete window.ethereum;
    const account = '0x5555555555555555555555555555555555555555';
    const provider = {
      request: async ({ method }: { method: string }) => {
        if (method === 'eth_accounts') return [];
        if (method === 'eth_requestAccounts') return [account];
        if (method === 'eth_chainId') return '0x7a69';
        throw Object.assign(new Error(`Unsupported test method: ${method}`), { code: 4200 });
      },
    };
    Object.assign(window, {
      walletTest: {
        installLegacy: () => Object.assign(window, { ethereum: provider }),
      },
    });
  });

  await page.goto('/');
  const connect = page.getByRole('button', { name: 'Connect wallet', exact: true });
  expect(await connect.getAttribute('title')).toBe('No injected browser wallet was detected.');
  await page.evaluate(() => (window as unknown as { walletTest: { installLegacy: () => void } }).walletTest.installLegacy());
  await expect(connect).not.toHaveAttribute('title', 'No injected browser wallet was detected.', { timeout: 4_500 });
  await connect.click();
  await expect(page.getByLabel('Send to', { exact: true })).toHaveValue('0x5555555555555555555555555555555555555555');
});

test('fails visibly and safely when no injected provider exists', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { delete window.ethereum; });
  await page.goto('/');
  const connect = page.getByRole('button', { name: 'Connect wallet', exact: true });
  await expect(connect).toHaveAttribute('title', 'No injected browser wallet was detected.');
  await connect.click();
  await expect(connect).toHaveAttribute('title', 'The wallet request was not completed.');
  await page.getByRole('button', { name: 'Import TEST to your wallet', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('not completed');
  expect(errors).toEqual([]);
});

test('handles a rejected connection without exposing an unhandled error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.assign(window, {
      ethereum: {
        request: async ({ method }: { method: string }) => {
          if (method === 'eth_accounts') return [];
          if (method === 'eth_chainId') return '0x1';
          if (method === 'eth_requestAccounts') {
            throw Object.assign(new Error('User rejected the request'), { code: 4001 });
          }
          throw Object.assign(new Error(`Unsupported test method: ${method}`), { code: 4200 });
        },
      },
    });
  });
  await page.goto('/');
  const connect = page.getByRole('button', { name: 'Connect wallet', exact: true });
  await connect.click();
  await expect(connect).toHaveAttribute('title', 'The wallet request was not completed.');
  await expect(page.getByLabel('Send to', { exact: true })).toHaveValue('');
  expect(errors).toEqual([]);
});
