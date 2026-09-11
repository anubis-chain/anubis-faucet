# Anubis Faucet：AWS 手動部署手冊

本手冊用於第一版人工部署，不建立 Jenkins、GitHub Actions、長期 AWS access key、VPC 或 NAT Gateway。GitHub 只保存 private source；每次部署均由受控 Mac 以 AWS IAM Identity Center 的短期登入執行。

## 1. 固定部署範圍

- GitHub：`anubis-chain/anubis-faucet`（Private）
- AWS 主區域：Singapore `ap-southeast-1`
- CloudFront/WAF/ACM：`us-east-1`
- Production：`anubisfaucets.com`
- Staging：`staging.anubisfaucets.com`
- DNS：Cloudflare DNS-only（灰雲），不使用 Route 53
- 錢包：每個 stage 各用一個全新、低餘額、只供該 stage faucet 使用的普通 hot wallet；兩個 stage 不得共用私鑰，錢包亦不得作人工轉帳或其他服務用途；私鑰只存 AWS Secrets Manager
- 鏈：Anubis Test，chain ID `202601`
- 派發資產：DAI `0x83fd06F0846d9D90B3016bF670Efe2E0B11cDe14`，18 decimals，每次 1 DAI

## 2. AWS 新帳戶安全基線

1. 生產用途選 AWS Paid account plan；優惠 credits 只作折扣，不視為永久免費。
2. Root user 啟用 passkey 或 MFA（AWS 要求在首次登入後 35 日內完成），不建立 root access key。
3. 在 `ap-southeast-1` 啟用 IAM Identity Center 的 Single-Region organization instance，使用 AWS-owned key；不要為這個低流量單人項目選預設 Multi-Region customer-managed KMS key。建立一個一小時 session 的日常管理員，root user 只保留作緊急用途。
4. 建立 Billing Budget，先設 USD 10、30、60 告警。
5. 確認 CloudTrail 已記錄 management events。
6. CLI 只用 Identity Center/SSO 短期憑證，禁止把 access key 寫入 repo 或部署文件。

啟用 organization instance 會令這個新帳戶成為 AWS Organizations management account。本階段帳戶只服務這一個 faucet，可以先以單帳戶方式運作；若日後加入其他 AWS 帳戶或團隊 workload，應把 faucet 移到獨立 member account，不要繼續把一般 workload 留在 management account。

AWS CLI 安裝後，依 Identity Center 畫面提供的 Start URL 與 SSO Region 設定：

```sh
aws configure sso --profile anubis-faucet
aws sso login --profile anubis-faucet
aws sts get-caller-identity --profile anubis-faucet
```

最後一個命令顯示的 account ID 必須等於本次新帳戶，才可繼續。

## 3. 建立 Turnstile widget

在 Cloudflare 建立一個 Managed Turnstile widget，允許：

- `anubisfaucets.com`
- `staging.anubisfaucets.com`

Site Key 是前端公開設定；Secret Key 只能在 Secrets Manager 介面輸入。不要在聊天、Git、`.env`、命令參數或截圖傳送 Secret Key。

## 4. 申請 ACM 憑證

CloudFront 憑證必須位於 `us-east-1`。以同一張憑證涵蓋 production 與 staging：

```sh
aws acm request-certificate \
  --region us-east-1 \
  --domain-name anubisfaucets.com \
  --subject-alternative-names staging.anubisfaucets.com \
  --validation-method DNS \
  --profile anubis-faucet
```

查詢 `DomainValidationOptions.ResourceRecord`，把每一筆 CNAME 加到 Cloudflare，全部設成 DNS-only：

```sh
aws acm describe-certificate \
  --region us-east-1 \
  --certificate-arn CERTIFICATE_ARN \
  --profile anubis-faucet
```

只有狀態成為 `ISSUED` 才可綁定正式域名。ACM 公開憑證不是一張有效
15 年的固定憑證；目前每張有效 198 日。只要憑證仍綁在 CloudFront，並且
Cloudflare 上的 ACM 驗證 CNAME 一直保留為 DNS-only，ACM 會在到期前自動
驗證及續期，因此服務可以持續運作 15 年以上而毋須人工逐次換證。不可刪除
這些驗證記錄。

## 5. 本機建置與測試

從 repository 根目錄開始：

```sh
npm ci
npm test
VITE_FAUCET_API_URL=/ \
VITE_TURNSTILE_SITE_KEY=0x4AAAAAAEv-TZyEqCPXlFdQ \
npm run build
```

建置 AWS backend：

```sh
cd aws/backend
npm ci
npm test
npm run check
npm run build
```

建置並預覽 IaC：

```sh
cd ../../infra
npm ci
npm run build
npx cdk synth -c account=ACCOUNT_ID -c stage=staging \
  -c certificateArnStaging=CERTIFICATE_ARN
```

## 6. Bootstrap 與 staging 部署

每個新 AWS 帳戶只需 bootstrap 一次：

```sh
npx cdk bootstrap aws://ACCOUNT_ID/us-east-1 --profile anubis-faucet
npx cdk bootstrap aws://ACCOUNT_ID/ap-southeast-1 --profile anubis-faucet
```

先檢視變更，然後保持 faucet 關閉部署 staging：

```sh
npx cdk diff -c account=ACCOUNT_ID -c stage=staging \
  -c certificateArnStaging=CERTIFICATE_ARN \
  -c faucetEnabled=false \
  --profile anubis-faucet

npx cdk deploy --all --require-approval broadening \
  -c account=ACCOUNT_ID \
  -c stage=staging \
  -c certificateArnStaging=CERTIFICATE_ARN \
  -c faucetEnabled=false \
  --profile anubis-faucet
```

保存輸出的 CloudFront domain、Runtime Secret ARN、Lambda names 和 DynamoDB table name。

若新帳戶選用 AWS **Paid account plan**，而且 AWS 判定相關資源符合資格，
可嘗試把每個 stage 各自加入 CloudFront `FREE` flat-rate plan。這個 $0/月
plan 可涵蓋該 distribution 及其專用 WAF；AWS 要求每個 subscription 恰好
一個 CloudFront ARN 及一個 WAF ARN，兩者都由 stack 輸出：

```sh
aws pricing-plan-manager create-subscription \
  --plan-family CloudFront \
  --plan-tier FREE \
  --resource-arns CLOUDFRONT_DISTRIBUTION_ARN WAF_WEB_ACL_ARN \
  --region us-east-1 \
  --profile anubis-faucet
```

只有回傳狀態成為 `ACTIVE` 才代表成功。2026-09-11 對目前 staging 安全設定
的實際申請結果是 `resources are not eligible for this subscription tier`，因此
沒有建立 subscription 或產生 plan 費用，現時繼續使用 pay-as-you-go。保留
現有 OAC、request/response policy 與安全 headers，不為了符合免費 plan 而
削弱設定。不要在未另行人工批准收費的情況下改用 `PRO`、`BUSINESS` 或
`PREMIUM`。

## 7. 設定普通 faucet 錢包與 Turnstile Secret

為目前部署的 stage 建立一個全新專用錢包。不要使用交接文件中的舊地址，亦不要使用 `0x` 加 64 個 `1` 的公開測試 key。Staging 與 production 的 DynamoDB lock 彼此獨立，若共用同一 sender，兩邊同時簽署會發生 nonce 衝突；因此兩個 stage 必須使用不同錢包，而且這些錢包不得在 faucet 之外送出交易。

在 AWS Secrets Manager 打開 stack 輸出的 Runtime Secret，更新 JSON：

```json
{
  "privateKey": "由操作者在 AWS 介面輸入",
  "turnstileSecret": "由操作者在 AWS 介面輸入",
  "ipPepper": "保留 stack 已生成的隨機值"
}
```

輸入密鑰是唯一需要人工接管的步驟。私鑰不得貼到聊天、終端 command line 或任何會被同步的文字檔。備份放在團隊批准的離線密碼保管位置。

## 8. 上線前鏈驗證

2026-09-11 的 live 基準：

- `eth_chainId`：`0x31769`（202601）
- DAI runtime bytecode hash：`0x938e093ab3e0191198ae5403f54f3725467fb6ac0ed1c0d0f9bacfdad2a242c7`
- DAI decimals：18

每次部署仍須重新驗證，不可只信任這個快照。正式 enable 前必須確認：

1. `/api/health` 顯示預期 chain、token、sender address，且沒有洩漏 secret。
2. DAI code hash/decimals 與設定相符。
3. 新 sender 有足夠 DAI 支付「派發數量＋Anubis gas」。Anubis 的 pre-Aria gas 由 DAI system-contract balance 扣除，不能只看一般 EVM native balance。
4. 對新 sender 執行 `eth_estimateGas` 與 ERC-20 `transfer` simulation。
5. DynamoDB 沒有 `preparing` 或 `signed` 的舊交易。
6. 完成人工批准的一次 1 DAI 真實 claim，receipt 必須包含正確的 `Transfer(from,to,value)`。
7. 同地址和同 IP 的第二次請求被拒絕；Turnstile token 不能重用。

驗證全部通過後，重新部署 staging 並明確開啟：

```sh
npx cdk deploy --all --require-approval broadening \
  -c account=ACCOUNT_ID \
  -c stage=staging \
  -c certificateArnStaging=CERTIFICATE_ARN \
  -c faucetEnabled=true \
  --profile anubis-faucet
```

## 9. Cloudflare DNS 與 production

先新增 staging CNAME，Proxy status 選 DNS only：

- Name：`staging`
- Target：staging stack 的 `CloudFrontDomainName`

完成 staging 驗收後，先把 staging 重新部署為 `faucetEnabled=false`，確認 `/api/distribute` 回傳 `FAUCET_DISABLED`，並確認 staging 沒有 `preparing` 或 `signed` claim。Staging 與 production 的 cooldown、daily cap 和 active lock 不共用；若兩者同時公開啟用，同一人可在兩個 hostname 各領一次。Production 啟用 gate 必須同時確認 staging 已關閉，且兩個 `/api/health` 顯示的 sender address 不同。

然後以 `stage=production`、`certificateArnProduction` 重複 diff/deploy、Secret 輸入、資金與真實 claim 驗證。最後新增 apex CNAME：

- Name：`@`
- Target：production stack 的 `CloudFrontDomainName`
- Proxy status：DNS only

Cloudflare 會對 apex CNAME flatten。不要先開橙雲；否則可信 IP、WAF 及 24 小時限制模型都要重新設計。

## 10. 緊急停止與回滾

- 停止新 claim：優先以 `faucetEnabled=false` 重新部署；若屬即時事故，才把 API Lambda reserved concurrency 設為 0。
- 事故後先以 `faucetEnabled=false` 部署，再用 `delete-function-concurrency` 把 API 恢復至共用併發池；目前新帳戶的區域配額只有 10，不可直接恢復成 reserved concurrency 5。
- 不要停止 reconcile Lambda；它必須繼續處理已簽署交易。
- 不要因 timeout 刪除 `signed` lock 或重新簽另一筆 nonce 未核對的交易。
- Lambda 以 `live` alias 指向版本，可人工切回上一版本。
- S3 versioning 保存靜態版本；回滾前端後 invalidation `/*`。
- DynamoDB PITR 要 restore 成新 table；程式回滾不代表資料回滾。
- 改 private key、RPC、token、amount 前，先確認沒有 `preparing`/`signed` claim。

## 11. 日後加入 CI/CD

CDK、建置及測試命令已版本化。日後 GitHub Actions 只需以 OIDC 取得短期 AWS role，再順序執行同一套 test/build/diff/deploy；不需要重做 AWS 架構，也不需要讓 GitHub 讀取 faucet private key。

## 12. 低流量每月成本預算

以下為 2026-09-11 的低流量估算，不含稅、已購買的 domain、錢包內 DAI 及鏈上 gas：

- 目前 staging 未獲 CloudFront `FREE` flat-rate plan 接納，按 pay-as-you-go
  計費：三條 WAF 規則連同 Web ACL 約 USD 8/月，整個 stage 約
  **USD 8.5–10/月**；帳務上可預留 **USD 10–12/月**。
- 若日後 AWS 接納 `FREE` plan，單一低流量 stage 才可能降至約
  **USD 1–3/月**；在 AWS 顯示 subscription 為 `ACTIVE` 前不可把它計入預算。
- 固定項主要是 WAF 約 USD 8/月及 Secrets Manager 約 USD 0.40/secret/月。
  CloudWatch 每月前 10 個 standard alarm metrics 免費，所以帳戶目前這 7 個
  alarms 預計為 USD 0；若日後其他 alarms 用盡免費額度，7 個最多約
  USD 0.70/月。CloudFront PAYG 的 Always Free 額度足以涵蓋這個預期低流量
  stage；Lambda、DynamoDB、S3、EventBridge、SQS、SNS 及 logs 通常也只是
  免費額度內或零碎費用。
- Turnstile Free plan 為 USD 0；ACM public certificate 亦不另收憑證月費。
- 若 staging 與同等 production 長期同時保留，兩套合計約
  **USD 17–20/月**。
- faucet 的資產流出另計：目前每日上限 100 次、每次 1 DAI，31 日的理論最高派發量為 **3,100 DAI 加 gas**。這是風險上限，不代表預期用量；可日後把 `DAILY_CLAIM_CAP` 調低。

正式帳單仍以 AWS Pricing Calculator、Billing 與 Cost Explorer 為準。參考：[CloudFront flat-rate plans](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html)、[CloudFront PAYG pricing](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/)、[AWS WAF pricing](https://aws.amazon.com/waf/pricing/)、[CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/)、[Secrets Manager pricing](https://aws.amazon.com/secrets-manager/pricing/)、[Lambda pricing](https://aws.amazon.com/lambda/pricing/)、[Turnstile plans](https://developers.cloudflare.com/turnstile/plans/)。
