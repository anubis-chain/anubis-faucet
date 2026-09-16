# Anubis Testnet DAI Faucet

Open-source source for the production-operated ERC-20 DAI faucet on Anubis Testnet. Clone and run locally for development; the hosted product is the [live faucet](https://anubisfaucets.com). The application is deployed manually to AWS Singapore, while Cloudflare remains responsible for DNS and Turnstile.

[Live faucet](https://anubisfaucets.com) · [AWS deployment guide](docs/AWS-MANUAL-DEPLOY.zh-TW.md) · [Detailed handoff guide](docs/HANDOFF.md)

## Production

| Item | Value |
| --- | --- |
| Website | <https://anubisfaucets.com> |
| Canonical source | `main` |
| Deployment tracking branch | `deploy/aws-production` |
| AWS region | Singapore (`ap-southeast-1`) |
| Release process | Manual AWS CDK deployment; GitHub Actions runs tests only (no auto-deploy) |
| Cloudflare | DNS-only records and Turnstile |

The production frontend and API share the same CloudFront distribution. The legacy Cloudflare Worker implementation remains in this repository for handoff reference and regression testing; it is not the current production path.

## Faucet behavior

- Network: Anubis Test, chain ID `202601`.
- Token: ERC-20 DAI at `0x83fd06F0846d9D90B3016bF670Efe2E0B11cDe14`, with 18 decimals.
- Payout: exactly `1 DAI` per successful claim.
- Cooldown: one successful claim per recipient address and per source network every 24 hours. Either condition blocks a repeated claim.
- There is deliberately no whole-site daily claim cap.
- Anubis pre-Aria charges both the payout and transaction gas against the sender wallet's DAI system-contract balance.

The sender must therefore hold only a deliberately limited amount of DAI that the operator can afford to lose. Monitor its balance and claim volume even when traffic is expected to be low.

## Wallet support

Connecting a wallet is optional; a recipient can paste an EVM address and claim directly.

The frontend discovers installed browser wallets through EIP-6963 and falls back to a legacy injected `window.ethereum` provider. The selected provider is kept only in page memory. The application does not use WalletConnect and does not request a wallet signature or send a transaction from the visitor's wallet.

Regular mobile Safari and Chrome cannot discover separate wallet apps. Mobile users can either open the faucet in a wallet's built-in DApp browser or paste their receiving address manually.

## Security controls

- Cloudflare Turnstile is verified server-side, including token reuse, hostname, action, and source IP checks.
- Address and source-network cooldowns are reserved atomically in DynamoDB.
- IPv4 identities and IPv6 `/64` prefixes are HMAC-hashed before storage; raw client IP addresses are not stored.
- Each environment allows only one active signing transaction, but this lock is not shared between staging and production.
- Signed transaction bytes are persisted before broadcast and can only be reconciled or rebroadcast unchanged.
- A successful receipt must contain the exact expected ERC-20 `Transfer` event.
- The API Function URL accepts production traffic only through its CloudFront distribution.
- AWS WAF, CloudWatch alarms, an SNS alert topic, a reconciliation Lambda, and an encrypted SQS dead-letter queue provide additional operational controls.
- The private key and Turnstile secret are stored in AWS Secrets Manager and are never included in frontend variables or source control.

Staging and production currently share the same sender wallet. Staging must remain disabled (`faucetEnabled=false`) while that remains true; do not enable it even for an allowlisted test. Before staging can be used again, provision and fund a separate dedicated staging sender and verify that its address differs from production.

## AWS architecture

- CloudFront with a global AWS WAF web ACL.
- A private, versioned S3 origin protected by Origin Access Control.
- A Node.js Lambda API reached through an IAM-protected Function URL and CloudFront OAC.
- DynamoDB on-demand capacity with point-in-time recovery and TTL cleanup.
- A separate reconciliation Lambda invoked every minute by EventBridge.
- AWS Secrets Manager for runtime secrets.
- CloudWatch alarms and optional SNS email notifications.

The regional application stack runs in `ap-southeast-1`. CloudFront certificate and global WAF resources run in `us-east-1`, as required by AWS.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/` | React frontend, wallet integration, API client, and faucet configuration |
| `public/assets/` | Logos, fonts, background video, and still-image fallback |
| `aws/backend/` | AWS Lambda API, atomic cooldowns, signing, and reconciliation |
| `infra/` | AWS CDK infrastructure for manual staging and production deployments |
| `worker/` | Legacy Cloudflare Worker implementation retained for reference and tests |
| `worker/migrations/` | Legacy D1 database migrations |
| `tests/` | Worker and Playwright browser tests |
| `docs/` | Deployment, operations, and handoff documentation |
| `references/` | Reconstruction evidence and asset provenance |
| `MANIFEST.sha256` | SHA-256 inventory for generated handoff archives |

## Local development

Use Node.js 24 for a consistent frontend, backend, and CDK toolchain.

```sh
npm ci
npm run dev
```

The example frontend configuration is in `.env.example`. Values prefixed with `VITE_` are public and become part of the browser bundle. Never place a private key, Turnstile secret, AWS credential, or other secret in a `VITE_` variable.

Build the production frontend with the approved API path and public Turnstile site key:

```sh
VITE_FAUCET_API_URL=/ \
VITE_TURNSTILE_SITE_KEY=0x4AAAAAAEv-TZyEqCPXlFdQ \
npm run build
```


## Continuous integration

Pull requests and pushes to `main` (and `deploy/aws-production`) run GitHub Actions:

- Worker unit tests
- Playwright browser tests
- AWS Lambda backend tests
- CDK TypeScript typecheck for `infra/`

CI does **not** deploy to AWS and does not need production secrets. Production releases stay a manual CDK process — see [the AWS manual deployment guide](docs/AWS-MANUAL-DEPLOY.zh-TW.md).

## Validation

```sh
# Legacy Worker and browser regression suites
npm test

# AWS backend
cd aws/backend
npm ci
npm test

# CDK type checking
cd ../../infra
npm ci
npm run build
```

Current validated baseline as of 2026-09-11:

- 23 legacy Worker tests passed.
- 20 Playwright browser tests passed.
- 48 AWS backend tests passed.
- The production frontend and CDK type checks passed.
- Full and production-only npm audits reported zero vulnerabilities.

All test private keys are public, unfunded fixtures. No production secret is required to run the automated tests.

## Deployment

Follow [the AWS manual deployment guide](docs/AWS-MANUAL-DEPLOY.zh-TW.md) for account preparation, ACM validation, Cloudflare DNS, secret entry, preflight checks, staged enablement, rollback, alarms, and cost controls.

Important deployment rules:

- Run CDK diff before every deployment.
- Keep `faucetEnabled=false` until the target environment passes preflight.
- Do not enable staging while it shares the production sender wallet.
- If a separate staging sender is provisioned later, restrict staging to one explicitly approved recipient and disable it immediately after testing.
- Production must omit the staging-only recipient allowlist.
- Keep Cloudflare DNS records in DNS-only mode unless the trusted client-IP boundary is redesigned.
- A frontend-only release must not alter the Lambda, DynamoDB, IAM, WAF, or secret configuration.

Generated handoff archives exclude private keys, Turnstile secrets, Cloudflare or AWS credentials, databases, dependency directories, build caches, and Git history. Verify an archive with its adjacent `.sha256` file and verify extracted files with `MANIFEST.sha256`.

## Legacy handoff and provenance

The original handoff path used a JavaScript Cloudflare Worker, D1, Workers Static Assets, Workers Secrets, and a one-minute reconciliation cron. Its source snapshot is preserved by the `source-handoff-2026-09-10` tag. The reference deployment is <https://anubis-testnet-faucet.price-proxy.workers.dev/>. That deployment belongs to the earlier Cloudflare environment and is not the current AWS production service.

The initial source handoff was validated on 2026-09-09, and the updated Anubis background video was validated on desktop and 320 px mobile layouts on 2026-09-10. The current AWS production path and lightweight installed-wallet selector were validated on 2026-09-11.

The interface was reconstructed from publicly accessible reference material rather than the original site's private source repository. Brand and upstream asset rights remain with their respective owners. See [the reconstruction evidence](references/SOURCES.md) for provenance details.
