# Anubis Testnet DAI Faucet

Open-source source for the Anubis Testnet ERC-20 DAI faucet.

**[Live faucet](https://anubisfaucets.com)** · Chain ID `202601` · Token DAI `0x83fd06F0846d9D90B3016bF670Efe2E0B11cDe14`

This repository is the **development source** for the hosted faucet. Production runs on AWS (Singapore) with Cloudflare DNS and Turnstile. GitHub Actions run tests only; releases are deployed manually with AWS CDK.

## What it does

- Pays out exactly **1 DAI** per successful claim
- 24-hour cooldown per recipient address and per source network
- Optional wallet connect (EIP-6963); paste-an-address claims also work
- Server-side Cloudflare Turnstile verification
- AWS Lambda API, DynamoDB cooldowns, Secrets Manager for the sender key

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/` | React frontend |
| `aws/backend/` | Lambda API (signing, cooldowns, reconciliation) |
| `infra/` | AWS CDK stacks for staging and production |
| `worker/` | **Legacy** Cloudflare Worker path (not production). Kept for unit tests and history only; live traffic uses AWS. |
| `tests/` | Playwright and worker tests |
| `docs/DEPLOY.md` | Operator deployment guide (English) |

## Local development

Requires Node.js 24+.

```sh
npm ci
npm run dev
```

Copy `.env.example` for frontend env. Never put private keys or Turnstile secrets in `VITE_*` variables.

```sh
# Worker unit tests + Playwright
npm test

# AWS backend tests
cd aws/backend && npm ci && npm test

# CDK typecheck
cd ../../infra && npm ci && npm run build
```

## Continuous integration

Pushes and pull requests to `main` run:

- Worker unit tests
- Playwright browser tests
- AWS backend tests
- CDK TypeScript typecheck

CI does **not** deploy and does not need production secrets.

## Deployment

See [docs/DEPLOY.md](docs/DEPLOY.md). Production secrets stay in AWS Secrets Manager.

## License

MIT — see [LICENSE](LICENSE). Brand and visual assets remain with their respective owners.
