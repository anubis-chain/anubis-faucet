# Anubis Faucet deployment guide

Operator guide for the AWS Singapore deployment. This is a **manual** CDK release process. GitHub Actions only run tests; they do not deploy.

## Scope

| Item | Value |
| --- | --- |
| Live site | https://anubisfaucets.com |
| Staging (optional) | https://staging.anubisfaucets.com |
| AWS app region | `ap-southeast-1` (Singapore) |
| CloudFront / WAF / ACM | `us-east-1` |
| DNS | Cloudflare DNS-only (grey cloud) |
| Chain | Anubis Test, chain ID `202601` |
| Token | DAI `0x83fd06F0846d9D90B3016bF670Efe2E0B11cDe14`, 18 decimals, 1 DAI per claim |

## Architecture

- CloudFront + AWS WAF in front of a private S3 origin (frontend) and an IAM-protected Lambda Function URL (API)
- DynamoDB for atomic claim cooldowns (address + hashed network identity)
- Secrets Manager for the faucet sender private key and Turnstile secret
- EventBridge-triggered reconciliation Lambda
- Cloudflare Turnstile for bot checks; DNS remains on Cloudflare

## Before you deploy

1. Use AWS IAM Identity Center short-lived credentials (do not commit long-lived access keys).
2. Provision **separate** low-balance sender wallets for staging and production. Never share keys across stages.
3. Fund each sender with enough DAI on Anubis Test for payouts and gas (pre-Aria gas is charged from the DAI system-contract balance).
4. Create Turnstile keys; put the **site** key in the frontend build env and the **secret** in Secrets Manager only.
5. Keep `faucetEnabled=false` until preflight passes.

## Build frontend

```sh
npm ci
VITE_FAUCET_API_URL=/ \
VITE_TURNSTILE_SITE_KEY=<public-turnstile-site-key> \
npm run build
```

## Deploy with CDK

From `infra/`:

```sh
npm ci
npm run build
npx cdk diff -c stage=production
npx cdk deploy --all -c stage=production --require-approval broadening
```

Always run `cdk diff` before deploy. A frontend-only release must not change Lambda, DynamoDB, IAM, WAF, or secret configuration.

## Enable traffic

1. Confirm CloudFront serves the new UI and `/api` routes.
2. Confirm Secrets Manager values for the target stage.
3. Run a single allowlisted test claim if staging is enabled with a dedicated sender.
4. Set `faucetEnabled=true` for production only after preflight succeeds.
5. Watch CloudWatch alarms and the sender DAI balance.

## Security rules

- Private keys and Turnstile secrets never go in git, frontend env, or CI.
- Staging must stay disabled while it shares a production sender wallet.
- Prefer DNS-only Cloudflare records unless the trusted client-IP design is revisited.
- Monitor abuse (cooldown hits, WAF, claim volume) even when traffic is low.

## Rollback

Redeploy the previous known-good CDK revision / frontend artifact, or set `faucetEnabled=false` immediately if the sender key or API misbehaves.
