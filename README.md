# Anubis Testnet DAI Faucet

[![CI](https://github.com/anubis-chain/anubis-faucet/actions/workflows/ci.yml/badge.svg)](https://github.com/anubis-chain/anubis-faucet/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Source code for the **Anubis Testnet ERC-20 DAI faucet**, including the React frontend and Cloudflare Worker.

**[Live faucet](https://anubisfaucets.com)** · Chain ID `202601` · DAI `0x83fd06F0846d9D90B3016bF670Efe2E0B11cDe14`

For local development, testing, and self-hosting. Production credentials and infrastructure are not included.

## Features

- Sends a configurable ERC-20 amount; the included Anubis Test configuration sends **1 DAI**
- Applies a 24-hour cooldown to the recipient address and client network identity
- Supports browser wallets discovered through EIP-6963 and manually entered addresses
- Verifies Cloudflare Turnstile tokens on the server
- Stores claims in D1 before broadcasting and reconciles pending transactions
- Includes Worker unit tests and Playwright browser tests

## Try the interface locally

Requires Node.js 24 or newer.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. This starts the web interface only; a claim requires a configured Worker API.

## Run the complete local stack

Copy the example configuration and add local-only values:

```sh
cp .env.example .env.local
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run worker:dev
```

Then open `http://127.0.0.1:8787`.

Use Cloudflare's Turnstile test keys and a disposable, low-balance test wallet. The Worker can broadcast a real transaction when supplied with a real private key and reachable RPC, so do not use a personal or production wallet.

See [docs/DEPLOY.md](docs/DEPLOY.md) for configuration and self-hosting instructions.

## Test and build

```sh
npm test
npm run build
npm run worker:check
```

`worker:check` performs a production build and Wrangler dry run. It does not deploy.

## Project structure

| Path | Purpose |
| --- | --- |
| `src/` | React and TypeScript frontend |
| `public/assets/` | Static brand and interface assets |
| `worker/` | Worker API, D1 storage, token sender, Turnstile verification, and reconciliation |
| `worker/migrations/` | D1 database migrations |
| `tests/` | Worker and browser tests |
| `wrangler.jsonc` | Self-hosting template with placeholder D1 identifiers |
| `docs/DEPLOY.md` | Cloudflare deployment guide |

## Configuration

The checked-in settings target Anubis Test. Review these files before running a claim service:

- `src/lib/faucet-config.json`: chain, RPC, explorer, token, amount, and cooldown
- `worker/config.json`: allowed frontend origins and Turnstile hostnames
- `.env.example`: public frontend settings
- `.dev.vars.example`: local Worker secrets template

Never commit a faucet private key, Turnstile secret, funded test wallet, `.dev.vars`, or production environment file.

## Security

Please report vulnerabilities privately as described in [SECURITY.md](SECURITY.md). Do not include exploit details or credentials in a public issue.

## License

MIT — see [LICENSE](LICENSE). Brand and visual assets remain with their respective owners.
