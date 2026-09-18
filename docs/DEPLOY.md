# Self-hosting the Anubis Testnet faucet

This guide deploys the open-source faucet to **Cloudflare Workers + D1**. It does not reproduce or modify the infrastructure behind the live `anubisfaucets.com` service.

## Before you start

You need:

- Node.js 24 or newer
- A Cloudflare account with Workers, D1, and Turnstile access
- A dedicated disposable faucet wallet
- Testnet DAI for payouts and the required Anubis Test gas balance

Never use a personal wallet or reuse a production private key.

## 1. Install and verify

```sh
npm ci
npm test
npm run worker:check
```

The dry run does not publish anything.

## 2. Review the faucet settings

`src/lib/faucet-config.json` is shared by the frontend and Worker. Confirm the chain ID, RPC, explorer, token contract, decimals, payout amount, and cooldown before deployment.

The included configuration targets Anubis Test:

| Setting | Included value |
| --- | --- |
| Chain ID | `202601` |
| RPC | `https://cheras-rpc.anubispace.org/rpc` |
| Token | DAI `0x83fd06F0846d9D90B3016bF670Efe2E0B11cDe14` |
| Amount | `1` DAI |
| Cooldown | 24 hours |

This faucet transfers ERC-20 tokens. `distribution.nativeAmount` must remain empty.

## 3. Create D1

Authenticate Wrangler and create a database:

```sh
npx wrangler login
npx wrangler d1 create anubis-faucet
```

Put the returned database ID in `wrangler.jsonc`, replacing the all-zero placeholder. Keep the binding name `DB`, then apply the migration:

```sh
npm run db:migrate:remote
```

## 4. Configure Turnstile and the frontend

Create a Turnstile widget for the hostname that will serve the faucet. Put the hostname, without a protocol or path, in `worker/config.json`.

Copy the frontend environment template:

```sh
cp .env.example .env.production
```

Set:

```dotenv
VITE_FAUCET_API_URL=/
VITE_TURNSTILE_SITE_KEY=your-public-site-key
```

The Site Key is public. The Turnstile Secret Key is not and must never use a `VITE_` variable.

If the frontend and API use different origins, add the exact frontend origin to `worker/config.json`. Same-origin deployments should leave `allowedOrigins` empty.

## 5. Deploy and add secrets

Deploy the code first:

```sh
npm run worker:deploy
```

Store the secrets through Wrangler's interactive prompt:

```sh
npx wrangler secret put FAUCET_PRIVATE_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
```

Do not place secret values in command arguments, tracked files, screenshots, or CI logs.

Fund only the address derived from the configured faucet key. It needs the configured ERC-20 DAI for payouts and the chain's required gas balance.

## 6. Verify safely

1. Open the deployed homepage and check the displayed chain, token, amount, and explorer.
2. Confirm `/api/health` returns HTTP 200.
3. Confirm a claim without a valid Turnstile response is rejected.
4. Use a new recipient address for one small test claim.
5. Verify the ERC-20 `Transfer` event and recipient balance on the explorer.
6. Repeat with the same address and confirm the cooldown is enforced.

A submitted transaction hash is not proof of payment. Verify the receipt and matching token event.

## Local full-stack development

```sh
cp .env.example .env.local
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run worker:dev
```

Open `http://127.0.0.1:8787`. Use Turnstile test keys and a disposable development wallet. A real key and live RPC can result in real broadcasts even when the Worker runs locally.

## Operations

- Run `npm test` before every release.
- Apply new D1 migrations before deploying code that depends on them.
- Keep the faucet wallet deliberately low balance.
- Monitor failed claims, cooldown responses, pending transactions, RPC errors, and wallet balances.
- Disable or remove the Worker route immediately if its private key may be exposed.
- Do not delete D1 claim records to bypass cooldowns or pending-transaction locks.

Code rollback does not roll back D1 data or on-chain transactions. Confirm schema and pending-transaction compatibility before using Wrangler rollback.
