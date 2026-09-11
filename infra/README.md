# Anubis Faucet AWS CDK

This directory deploys one isolated faucet stage at a time. It intentionally does
not create Route 53 records, a VPC, a NAT gateway, Jenkins, or CI/CD resources.
Cloudflare remains authoritative for `anubisfaucets.com`.

## Architecture

- CloudFront with a `us-east-1` AWS WAF web ACL.
- A private, versioned S3 origin protected by CloudFront OAC.
- `/api/*` routed without caching to a Node.js 24 Lambda Function URL using
  `AWS_IAM` and CloudFront OAC.
- DynamoDB on-demand with PITR and a TTL attribute named `expiresAt`.
- A separate Node.js 24 reconciliation Lambda invoked every minute by
  EventBridge, with an encrypted SQS dead-letter queue.
- A generated placeholder Secrets Manager JSON secret using the service's
  default AWS-managed encryption.
- CloudWatch alarms and an SNS topic. A structured-log metric also counts handled
  API 5xx responses, which do not increment Lambda's native `Errors` metric. An
  email address is optional and requires subscription confirmation.

The backend Lambdas run outside a VPC so that they can call Turnstile and the
Anubis RPC endpoint without a NAT gateway. They have no inbound network listener;
the API Function URL is restricted to the CloudFront distribution. Only the API
role can read the runtime secret. Reconciliation can replay only the exact signed
transaction stored in DynamoDB and cannot read the wallet private key.

## Prerequisites

- Node.js 24, npm, AWS CLI, and AWS CDK credentials for the target account.
- The root frontend built into `dist/` with `npm ci && npm run build`.
- The AWS backend built into `aws/backend/dist/`, containing `api.mjs` and
  `reconcile.mjs` with exported `handler` functions. Override the directory and
  handler names with CDK context if the backend packaging changes.
- CDK bootstrap in both `us-east-1` and `ap-southeast-1` because WAF is global
  and CloudFront-scope WAF resources must live in `us-east-1`.

From this directory:

```sh
npm ci
npx cdk bootstrap aws://ACCOUNT_ID/us-east-1 --profile PROFILE
npx cdk bootstrap aws://ACCOUNT_ID/ap-southeast-1 --profile PROFILE
```

## ACM and Cloudflare DNS

CloudFront viewer certificates must be in `us-east-1`. Because DNS stays at
Cloudflare, request and validate the certificate before the custom-domain CDK
deployment. One certificate can cover both stage names:

```sh
aws acm request-certificate \
  --region us-east-1 \
  --domain-name anubisfaucets.com \
  --subject-alternative-names staging.anubisfaucets.com \
  --validation-method DNS \
  --profile PROFILE

aws acm describe-certificate \
  --region us-east-1 \
  --certificate-arn CERTIFICATE_ARN \
  --profile PROFILE
```

Add every `DomainValidationOptions.ResourceRecord` CNAME to Cloudflare as
**DNS only**, wait for `ISSUED`, and pass the same ARN as the relevant stage
context. After deployment, add these Cloudflare DNS-only records:

- `staging.anubisfaucets.com` CNAME → the staging `CloudFrontDomainName` output.
- `anubisfaucets.com` CNAME → the production output. Cloudflare flattens the
  apex CNAME.

ACM public certificates are currently valid for 198 days rather than 15 years.
When the certificate remains in use and every DNS validation CNAME remains in
place, ACM performs managed renewal before expiry. Keep those validation records
for the full lifetime of the service.

Do not enable the Cloudflare proxy without redesigning the trusted-IP boundary.
With the proxy enabled, CloudFront sees a Cloudflare edge IP instead of the
viewer and the application must validate `CF-Connecting-IP` only after limiting
origin traffic to Cloudflare's maintained IP ranges.

## Manual deployment

Type-check and preview first:

```sh
npm run build
npx cdk synth -c account=ACCOUNT_ID -c stage=staging \
  -c certificateArnStaging=CERTIFICATE_ARN
npx cdk diff -c account=ACCOUNT_ID -c stage=staging \
  -c certificateArnStaging=CERTIFICATE_ARN \
  -c faucetEnabled=false --profile PROFILE
```

Deploy staging:

```sh
npx cdk deploy --all --require-approval broadening \
  -c account=ACCOUNT_ID \
  -c stage=staging \
  -c certificateArnStaging=CERTIFICATE_ARN \
  -c faucetEnabled=false \
  --parameters AnubisFaucet-Staging:AlertEmail=alerts@example.com \
  --profile PROFILE
```

### Optional CloudFront Free flat-rate plan

For an eligible AWS **Paid account plan**, an operator may try to subscribe each
deployed distribution to the CloudFront `FREE` flat-rate plan. It includes the
associated CloudFront distribution and WAF web ACL at $0/month for the plan
allowance. AWS requires exactly one distribution ARN and one dedicated WAF ARN
in each subscription; this CDK app creates that one-to-one layout and outputs
both values.

```sh
aws pricing-plan-manager create-subscription \
  --plan-family CloudFront \
  --plan-tier FREE \
  --resource-arns CLOUDFRONT_DISTRIBUTION_ARN WAF_WEB_ACL_ARN \
  --region us-east-1 \
  --profile PROFILE
```

Only a returned `ACTIVE` status means the subscription exists. On 2026-09-11,
AWS rejected the current staging resources as ineligible for this tier, so the
secure OAC and custom request/response policies were retained and the stage
continues on pay-as-you-go pricing. Do not weaken those controls merely to fit a
plan, and do not create a paid `PRO`, `BUSINESS`, or `PREMIUM` subscription
without a separate human billing approval.

Both stages default to `FAUCET_ENABLED=false`. Populate the secret, validate
health, balances, gas estimation, alarms, and rollback first. Only then redeploy
the chosen stage with `-c faucetEnabled=true`. The API must reject new claims
while this value is false; the reconciliation handler intentionally continues
processing already signed claims.

Use a different dedicated sender wallet for every stage, and never use either
wallet for manual transfers or another service. The DynamoDB active lock is
stage-local, so shared keys would allow independent signers to race the same
account nonce. Before enabling production, redeploy staging with
`-c faucetEnabled=false`, verify `FAUCET_DISABLED`, and prove staging has no
`preparing` or `signed` claim. The cooldown and daily cap are also stage-local;
leaving both public stages enabled would let the same recipient claim once from
each hostname.

Deploy production only after staging validation and a manual change review:

```sh
npx cdk diff -c account=ACCOUNT_ID -c stage=production \
  -c certificateArnProduction=CERTIFICATE_ARN \
  -c faucetEnabled=false --profile PROFILE

npx cdk deploy --all --require-approval broadening \
  -c account=ACCOUNT_ID \
  -c stage=production \
  -c certificateArnProduction=CERTIFICATE_ARN \
  -c faucetEnabled=false \
  --parameters AnubisFaucet-Production:AlertEmail=alerts@example.com \
  --profile PROFILE
```

Omit the `AlertEmail` parameter to create the topic without an email
subscription. Production has CloudFormation termination protection plus S3,
DynamoDB, Secrets Manager, and log retention. Disable termination
protection explicitly before a deliberate production destroy. Staging data is
destroyable with `npm run destroy:staging -- -c account=ACCOUNT_ID -c
stage=staging --profile PROFILE`.

## Populate the runtime secret

The stack creates invalid placeholder values intentionally. Claims must remain
disabled/unhealthy until an operator replaces them through a secure channel.
Keep the generated `ipPepper` value when updating the other fields because
changing it invalidates existing IP cooldown keys.

Open the generated secret in the AWS Secrets Manager console and let the wallet
operator replace only the placeholder values directly in that protected UI.
Required JSON keys are `privateKey`, `turnstileSecret`, and `ipPepper`; preserve
the generated `ipPepper`. Never retrieve or supply secret values through terminal
output, CDK context, CloudFormation parameters, command-line arguments, build
logs, chat, screenshots, or Git.

## OAC POST requirement

AWS Lambda Function URL OAC does not accept unsigned POST or PUT payloads. The
browser must hash the exact UTF-8 bytes passed as the request body and send the
lowercase hexadecimal digest in `x-amz-content-sha256`. That header is reserved
for the OAC SigV4 flow and must not be listed in a cache or origin request policy;
CloudFront consumes and forwards it when signing the origin request. The origin
request policy separately forwards `CloudFront-Viewer-Address`. Requests without
a matching digest fail before the Lambda handler with `InvalidSignatureException`.

The function URL policy generated by current CDK must contain both
`lambda:InvokeFunctionUrl` and `lambda:InvokeFunction` for the CloudFront service
principal and must scope them to this distribution. Verify both actions in the
synthesized template before deployment; Function URLs created after October 2025
return 403 if either permission is missing.

## Preflight and rollback

Before enabling or changing production, verify:

1. `/api/health` is 200 and reports the expected chain ID and sender address.
2. RPC `eth_chainId` is `0x31769` (decimal `202601`); ERC-20 decimals are 18.
   The backend also fails closed unless the deployed token bytecode matches the
   2026-09-11 baseline hash
   `0x938e093ab3e0191198ae5403f54f3725467fb6ac0ed1c0d0f9bacfdad2a242c7`.
   A contract upgrade requires an explicit hash review, test, and CDK update.
3. The sender has enough DAI for both payouts and the chain's pre-Aria DAI gas
   charging. Verify the current rule with `eth_estimateGas` and a live transfer;
   do not assume a separate native-gas balance. The stack output includes the
   exact contract and payout amount.
4. No claim is in `preparing` or `signed` state before changing the private key,
   RPC, token, amount, or DynamoDB table.
5. One manually approved claim emits the exact ERC-20 `Transfer` event and a
   repeat address/IP is rejected.
6. Before production is enabled, staging returns `FAUCET_DISABLED`, has no
   active claim, and its health sender address differs from production.
7. At least one production alarm receiver is documented and tested. If
   `AlertEmail` was supplied, confirm that the SNS subscription is no longer
   pending; otherwise attach an equivalent receiver to the output topic before
   enabling claims.
8. Review the active-lock item and structured reconciliation logs for a claim
   that remains `signed` or repeatedly rebroadcasts, and review WAF sampled
   requests when claim traffic or rejection rates change unexpectedly.

Both API and reconciliation use versioned Lambda aliases. EventBridge targets
the reconciliation `live` alias; roll the two aliases back to their reviewed,
compatible versions together. S3 versioning preserves static releases.
DynamoDB rollback is not coupled to code rollback; use backward-compatible
expand/contract changes, and restore PITR into a new table only after an
incident review.

The stack intentionally uses the regional shared Lambda concurrency pool. New
AWS accounts can have a quota of only 10, and Lambda requires all 10 to remain
unreserved. WAF rate limits, the daily cap, and DynamoDB's atomic active lock
remain the payout-safety controls. Do not increase faucet traffic after raising
the regional concurrency quota until the same reviewed change reserves 5
executions for the API and 1 for reconciliation (minimum regional quota 16).

For an immediate emergency stop, set only the API function's reserved
concurrency to zero; never stop the reconciliation function while a transaction
may be signed or pending:

```sh
aws lambda put-function-concurrency \
  --function-name anubis-faucet-production-api \
  --reserved-concurrent-executions 0 \
  --region ap-southeast-1 --profile PROFILE
```

After the incident, first deploy with `-c faucetEnabled=false`, return the API to
the shared pool with `aws lambda delete-function-concurrency`, confirm
reconciliation is healthy, and only enable new claims after another preflight.
If dedicated concurrency was added after a quota increase, restore its reviewed
value instead.
