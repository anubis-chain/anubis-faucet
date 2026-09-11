# AWS faucet backend

Node.js 24 ESM implementation for the Anubis ERC-20 DAI faucet. It replaces the Cloudflare Worker, D1 and cron runtime with two Lambda entry points and one DynamoDB table:

- `api.handler`: Lambda Function URL HTTP API (`/api/health`, `/api/distribute`).
- `reconcile.handler`: EventBridge invocation that checks or safely rebroadcasts the one active signed transaction.
- Build output: `dist/api.mjs` and `dist/reconcile.mjs`.

The backend is deliberately fail-closed. A transaction is never broadcast until the exact signed bytes and hash have been committed to DynamoDB. An uncertain RPC result keeps the signed bytes and global lock; reconciliation may only validate and rebroadcast those same bytes. A successful receipt must contain the exact configured token `Transfer` event before the raw transaction is removed.

## Install, test and build

From this directory, with Node.js 24:

```sh
npm ci
npm test
npm run check
npm run build
```

Runtime dependencies are `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-secrets-manager`, and `viem`. `esbuild` is the build-only dependency. The bundles include all runtime dependencies rather than relying on the SDK version bundled into a Lambda runtime.

If dependencies and scripts are managed only by the root package instead, add the three AWS SDK packages above to root `dependencies` (`viem` is already present), add `esbuild` to root `devDependencies`, and use:

```json
{
  "scripts": {
    "test:aws-backend": "node --test aws/backend/test/*.test.js",
    "check:aws-backend": "node --check aws/backend/*.js",
    "build:aws-backend": "node aws/backend/build.mjs"
  }
}
```

## Canonical Lambda environment contract

All entries below are required unless a default is shown. Fee values are decimal strings in 18-decimal pre-Aria DAI wei. Production gas and fee safety values must be approved from live RPC evidence; do not copy arbitrary examples.

| Variable | Meaning |
| --- | --- |
| `APP_STAGE` | Deployment stage. Must be exactly `staging` or `production`. |
| `FAUCET_ENABLED` | Only the exact string `true` enables new claims. Missing, `false`, `TRUE`, or any other value disables claims. Reconciliation always continues. |
| `ALLOWED_CLAIM_ADDRESS` | Optional single-recipient allowlist. When set, only this EVM address may claim. Enabled staging deployments require it so a public staging URL cannot pay arbitrary recipients. |
| `DYNAMODB_TABLE_NAME` | Single-table DynamoDB name. Partition key is String `pk`; TTL attribute is `expiresAt`. |
| `FAUCET_SECRET_ID` | Secrets Manager name or ARN for the JSON document below. |
| `CHAIN_ID` | Expected integer chain ID (`202601`). |
| `CHAIN_NAME` | Chain display name (`Anubis Test`). |
| `RPC_URL` | HTTPS JSON-RPC endpoint. Loopback HTTP is accepted only for tests. |
| `NATIVE_CURRENCY_NAME` / `NATIVE_CURRENCY_SYMBOL` | Both are currently `DAI`. |
| `NATIVE_CURRENCY_DECIMALS` | Must be `18`; defaults to `18`. |
| `TOKEN_ADDRESS` | Fixed ERC-20 DAI contract address. |
| `TOKEN_CODE_HASH` | Keccak-256 of the approved runtime bytecode. Current verified value: `0x938e093ab3e0191198ae5403f54f3725467fb6ac0ed1c0d0f9bacfdad2a242c7`. |
| `TOKEN_DECIMALS` | Must be `18`. |
| `TOKEN_AMOUNT_WEI` | Fixed payout in token base units (`1000000000000000000` for 1 DAI). |
| `COOLDOWN_SECONDS` | Address and IPv4/IPv6-prefix cooldown (`86400` for 24 hours). |
| `PREPARING_LEASE_SECONDS` | Unsigned reservation lease; defaults to `300`. |
| `TOKEN_REPLAY_SECONDS` | Local Turnstile token replay marker; defaults to `86400`. |
| `CLAIM_RETENTION_SECONDS` | Terminal claim TTL; defaults to `7776000` (90 days). |
| `MAX_GAS_LIMIT` | Hard maximum signed gas limit. |
| `MAX_FEE_PER_GAS_WEI` | Hard maximum legacy gas price or EIP-1559 max fee per gas. |
| `MAX_PRIORITY_FEE_PER_GAS_WEI` | Hard EIP-1559 priority-fee maximum. |
| `MAX_TOTAL_FEE_WEI` | Hard maximum `gas × feePerGas`. |
| `MIN_CONFIRMATIONS` | Receipt confirmations required; defaults to `1`. |
| `ALLOWED_ORIGINS` | Comma-separated exact HTTPS origins, for example the staging or production CloudFront hostname. |
| `TURNSTILE_HOSTNAMES` | Comma-separated exact hostnames registered with Turnstile, without protocols. |
| `TRUST_CLOUDFRONT_VIEWER_ADDRESS` | Must explicitly be `true`; startup otherwise fails closed. |
| `SECRETS_CACHE_MS` | Successful Secrets Manager cache lifetime; defaults to `300000`. Failed loads and failed refreshes are never cached or replaced with stale values. |

The Secrets Manager value is one JSON object with these exact camel-case field names:

```json
{
  "privateKey": "0x<64 lowercase or uppercase hex characters>",
  "turnstileSecret": "<Turnstile server secret>",
  "ipPepper": "<at least 32 bytes of random secret material>"
}
```

Never put this JSON, any field value, a real IP, a Turnstile response token, or a raw transaction in Lambda environment variables, source control, build output, or logs.

The private key must be a valid non-zero secp256k1 scalar. Placeholder values and Cloudflare's three official Turnstile test secret keys are rejected, so a test credential cannot silently reach production. After rotating any secret, force a new API Lambda execution environment (for example, publish/redeploy the function) or temporarily set `SECRETS_CACHE_MS=0`; otherwise an already-warm environment can retain the previous successful value for up to the configured cache lifetime.

## DynamoDB records and invariants

The table uses a String partition key named `pk` and no sort key:

- `LOCK#ACTIVE`: the only preparing or signed claim. A signed lock has no TTL and is never automatically released.
- `CLAIM#<uuid>`: claim state. `rawTx` exists only while signed and is removed on confirmed or explicitly reverted terminal state.
- `COOLDOWN#ADDRESS#<lowercase address>`: owner and logical `blockedUntil`.
- `COOLDOWN#IP#<HMAC>`: owner and logical `blockedUntil`; no raw IP is stored.
- `REPLAY#TURNSTILE#<SHA-256>`: logical replay expiry; no Turnstile token is stored.
- `CAP#DAY#YYYY-MM-DD`: uncapped UTC volume counter retained for audit and safe rolling-deploy/rollback compatibility. It is not consulted when authorizing a claim.

Reservation is one six-action `TransactWriteItems`: active lock, address cooldown, IP cooldown, replay marker, an unconditional daily audit-count increment, and claim. The audit counter has no cap condition. The reservation never steals an expired preparing lock; the lease is first released by an owner-checked transaction. Preparing failures, expired unsigned leases, and explicit on-chain reverts atomically mark the claim failed, release its exact lock and cooldown guards, and decrement the audit count. Unknown states remain locked.

There is intentionally no whole-site daily claim quota. The address and source-network cooldowns, Turnstile replay protection, WAF rate limit, and one-active-transaction lock still apply, but they are not an aggregate payout ceiling. Fund the sender conservatively and monitor its DAI balance and the uncapped audit count.

DynamoDB TTL is only cleanup. All authorization and cooldown conditions compare logical timestamps, because TTL deletion is asynchronous.

## Network and signing safety

Before signing, the sender verifies RPC chain ID, token runtime bytecode hash, decimals, DAI balance, simulation result, exact destination/value/calldata, recovered signer, gas limit, per-gas fees, and total fee. Anubis pre-Aria charges fees from the same 18-decimal DAI accounting used by this faucet, so the DAI `balanceOf(sender)` gate requires at least `TOKEN_AMOUNT_WEI + gas × feePerGas`; it intentionally does not use an EVM native-balance query. Simulation and gas estimation remain additional live affordability checks.

Every reconciliation pass revalidates the persisted raw transaction, signer, chain, token, amount and fee caps before querying or rebroadcasting. Secret rotation does not alter a pending transaction: the signer address is persisted with the signed claim, while the private key is never persisted.

## CloudFront and Function URL boundary

The Function URL must use `AWS_IAM` and a resource policy restricted to the specific CloudFront distribution through Origin Access Control. Production accepts client identity only from CloudFront's overwritten `CloudFront-Viewer-Address`; `X-Forwarded-For`, `X-Real-IP`, request JSON and the Function URL source IP are ignored. IPv4-mapped IPv6 becomes IPv4, while true IPv6 is grouped by `/64`; the resulting identity is HMAC-SHA256'd with `ipPepper` before persistence.

CloudFront must forward the generated viewer-address header. For POST, the browser must send `x-amz-content-sha256` for the exact JSON bytes; this handler independently verifies that hash with a constant-time comparison before parsing at most 8 KiB. Function URL CORS should not add a second policy; the application returns its exact-origin CORS headers.

## IAM and scheduling

Both Lambda roles require `dynamodb:GetItem` on the one table. Their
transactional writes are authorized through the underlying
`dynamodb:PutItem`, `dynamodb:UpdateItem`, and `dynamodb:DeleteItem` actions,
restricted by the `dynamodb:EnclosingOperation=TransactWriteItems` condition;
`TransactWriteItems` is not a standalone IAM action. Only the API role needs
`secretsmanager:GetSecretValue` on the one secret; reconciliation uses the
signer persisted with the signed claim and does not read the current private
key. EventBridge needs permission to invoke only `reconcile.handler`. The
reconcile code deliberately ignores `FAUCET_ENABLED`, so disabling new claims
cannot strand an already signed transaction.

Operational alarms should cover Lambda errors, a signed lock older than the expected confirmation window, unexpected claim volume, and low DAI balance. Never delete the active lock manually before proving the persisted transaction's chain state.
