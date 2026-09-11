import { test, expect } from '@playwright/test';

const address = '0x1111111111111111111111111111111111111111';

test.beforeEach(async ({ page }) => {
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', route => route.fulfill({
    contentType: 'text/javascript',
    body: 'window.turnstile = { render() { return "test"; }, remove() {} };',
  }));
});

test('loads local assets and matches the measured desktop structure', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole('heading', { name: 'Testnet Faucet', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send tokens', exact: true })).toBeVisible();
  const form = await page.locator('form').boundingBox();
  expect(form).toMatchObject({ x: 485, width: 470 });
  expect(await page.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
  expect(errors).toEqual([]);
});

test('rejects an invalid recipient, accepts an address, and never fabricates a claim', async ({ page }) => {
  await page.goto('/');
  const input = page.getByLabel('Send to', { exact: true });
  await page.getByRole('button', { name: 'Send tokens', exact: true }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await input.fill('not-a-wallet');
  await page.getByRole('button', { name: 'Send tokens', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Please enter a valid Ethereum address');
  await input.fill('vitalik.eth');
  await page.getByRole('button', { name: 'Send tokens', exact: true }).click();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await input.fill(address);
  await page.getByRole('button', { name: 'Send tokens', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: "Confirm you're human" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Claim tokens', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Sign in with Google' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Send tokens', exact: true })).toBeFocused();
});

test('restores the claim dialog from a deep link and supports browser history', async ({ page }) => {
  await page.goto(`/?address=${address}&step=auth`);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Send to', { exact: true })).toHaveValue(address);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page).not.toHaveURL(/step=auth/);
  await page.getByRole('link', { name: 'Add testnet', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Chain details' })).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel('Send to', { exact: true })).toHaveValue(address);
});

test('FAQ sections expand independently and work with a keyboard', async ({ page }) => {
  await page.goto('/');
  const first = page.getByRole('button', { name: 'What is a testnet?', exact: true });
  const third = page.getByRole('button', { name: 'What are the eligibility requirements?', exact: true });
  await first.focus();
  await page.keyboard.press('Enter');
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  await third.click();
  await expect(page.getByText('Pass Cloudflare verification', { exact: true })).toBeVisible();
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  await first.click();
  await expect(first).toHaveAttribute('aria-expanded', 'false');
  await expect(third).toHaveAttribute('aria-expanded', 'true');
});

test('shows and copies the configured Anubis Test network', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/add-chain');
  await expect(page.getByRole('heading', { name: 'Chain details' })).toBeVisible();
  await expect(page.locator('dd').first()).toHaveText('Anubis Test');
  await expect(page.getByText('https://cheras-rpc.anubispace.org/rpc', { exact: true })).toBeVisible();
  await expect(page.getByText('DAI', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Copy Chain ID', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('202601');
  await expect(page.getByRole('button', { name: 'Add Anubis Testnet to your wallet', exact: true })).toBeEnabled();
  await page.getByRole('link', { name: 'Back to faucet', exact: true }).click();
  await expect(page).toHaveURL('/');
});

test('configured network has no old branding or unrelated tokens', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { walletCalls: [], ethereum: { isMetaMask: true,
      request: async (request: unknown) => { (window as unknown as { walletCalls: unknown[] }).walletCalls.push(request); return []; },
    } });
  });
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  for (const route of ['/', '/add-chain']) {
    await page.goto(route);
    await expect(page).toHaveTitle('Anubis Testnet Faucet');
    expect(await page.locator('body').textContent()).not.toMatch(/robinhood|stock tokens?|TSLA|AMZN|PLTR|NFLX|46630/i);
    expect(await page.locator('[href], [src]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href') || node.getAttribute('src')).join(' '))).not.toMatch(/robinhood|offchain/i);
    expect(await page.evaluate(() => (window as unknown as { walletCalls: { method: string }[] }).walletCalls.map(call => call.method).join(' '))).not.toMatch(/wallet_addEthereumChain|wallet_switchEthereumChain|wallet_watchAsset|eth_sendTransaction|sign/i);
  }
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Import DAI to your wallet', exact: true })).toContainText('1DAI (ERC-20)');
  await expect(page.getByText(/\(Native\)/)).toHaveCount(0);
  expect(requests.join(' ')).not.toMatch(/robinhood|offchain/i);
});

test('privacy dialog is accessible and accurately describes local storage', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Your Privacy Choices', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Your Privacy Choices' });
  await expect(dialog).toContainText('does not use advertising or analytics cookies');
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

for (const width of [320, 375, 768, 1280]) {
  test(`both pages fit ${width}px without horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/', '/add-chain']) {
      await page.goto(route);
      await page.evaluate(() => document.fonts.ready);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow).toBe(false);
      for (const button of await page.locator('main button').all()) {
        const rect = await button.boundingBox();
        if (rect) { expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.x + rect.width).toBeLessThanOrEqual(width); }
      }
    }
  });
}

test('playing video covers the fallback image without a second mark', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  const video = page.locator('video');
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
  await video.evaluate(async (element: HTMLVideoElement) => {
    element.pause();
    await new Promise<void>(resolve => {
      element.addEventListener('seeked', () => resolve(), { once: true });
      element.currentTime = 2;
    });
  });
  const withFallback = await page.screenshot();
  await page.locator('img[src="/assets/background.jpg"]').evaluate(element => { element.style.visibility = 'hidden'; });
  const videoOnly = await page.screenshot();
  expect(withFallback.equals(videoOnly), 'The still image must not affect the pixels while the video is displayed').toBe(true);
});

test('reduced motion displays the original still background', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('video')).toHaveCount(0);
  await expect(page.locator('img[src="/assets/background.jpg"]')).toBeVisible();
});
