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
  await page.getByRole('button', { name: 'MetaMask', exact: true }).click();
  await expect(page.getByLabel('Send to', { exact: true })).toHaveValue('0x1111111111111111111111111111111111111111');
  await page.getByRole('button', { name: 'Import TEST to your wallet', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('TEST imported');
  const requests = await page.evaluate(() => (window as unknown as { walletTest: { calls: { method: string; params: unknown }[] } }).walletTest.calls);
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
