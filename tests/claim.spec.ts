import { test, expect } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4189' });

test('Turnstile-only claim resets used verification after failure and shows submitted transaction', async ({ page }) => {
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', route => route.fulfill({ contentType: 'text/javascript', body: `
    let count = 0;
    const widgets = new Map();
    window.turnstile = {
      render(element, options) {
        if (options.action !== 'faucet_claim') throw new Error('wrong action');
        count++;
        const token = 'token-' + count;
        const button = document.createElement('button');
        button.textContent = 'Complete test verification';
        button.onclick = () => options.callback(token);
        element.append(button);
        widgets.set(String(count), button);
        return String(count);
      },
      remove(id) { widgets.get(id)?.remove(); widgets.delete(id); }
    };
  ` }));
  let attempts = 0;
  const tokens: string[] = [];
  await page.route('http://127.0.0.1:3001/api/distribute', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST' } });
    tokens.push(route.request().postDataJSON().turnstileToken);
    attempts++;
    await route.fulfill({ status: attempts === 1 ? 429 : 202, headers: { 'Access-Control-Allow-Origin': '*' }, json: attempts === 1 ? { error: 'This address or IP has already claimed within the cooldown period.' } : { status: 'submitted', txHashes: ['0x' + 'a'.repeat(64)] } });
  });
  await page.goto('/?address=0x1111111111111111111111111111111111111111&step=auth');
  const dialog = page.getByRole('dialog');
  const claim = dialog.getByRole('button', { name: 'Claim tokens', exact: true });
  await expect(dialog.getByRole('button', { name: 'Sign in with Google' })).toHaveCount(0);
  await expect(claim).toBeDisabled();
  await dialog.getByRole('button', { name: 'Complete test verification' }).click();
  await expect(claim).toBeEnabled();
  await claim.click();
  await expect(dialog.getByRole('alert')).toContainText('already claimed');
  await expect(claim).toBeDisabled();
  await dialog.getByRole('button', { name: 'Complete test verification' }).click();
  await claim.click();
  await expect(page.getByRole('dialog', { name: 'Transaction submitted' })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'View transaction 1' })).toHaveAttribute('href', 'https://explorer.example.test/tx/0x' + 'a'.repeat(64));
  expect(tokens).toHaveLength(2);
  expect(tokens[0]).not.toBe(tokens[1]);
});
