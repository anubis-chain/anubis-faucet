# Anubis Testnet Faucet 部署与维护

> 本文件只保留原 Cloudflare Worker 路径；目前 AWS Singapore 人工部署请以 [`AWS-MANUAL-DEPLOY.zh-TW.md`](AWS-MANUAL-DEPLOY.zh-TW.md) 为准。

## 1. 架构与已配置网络

一个 Cloudflare Worker 同时托管前端与 `/api/*`。D1 保存领取记录；发币私钥只存在 Workers Secrets。Cron 每分钟检查未完成交易。部署目标是 **Cloudflare Workers + D1**。

| 参数 | 当前值 |
| --- | --- |
| 网络名 | Anubis Test |
| Chain ID | 202601，十六进制 0x31769 |
| RPC | https://cheras-rpc.anubispace.org/rpc |
| 浏览器 | https://cheras-rpc.anubispace.org |
| 领取代币 | ERC-20 DAI（Dai Stablecoin），18 位小数 |
| 代币合约 | 0x83fd06F0846d9D90B3016bF670Efe2E0B11cDe14 |
| 每次领取 | 1 ERC-20 DAI，即 1000000000000000000 个最小单位 |
| 冷却 | 每地址、每 IP 各 24 小时，任一命中即拒绝 |

DAI 在这里指上述**ERC-20 合约**，服务通过 `transfer(recipient, 1000000000000000000)` 发放代币，交易原生币 value 固定为 0。不要用其他网络的同名代币替代。

`src/lib/faucet-config.json` 中 `tokens` 必须恰好配置这一个合约，`distribution.tokenAmount` 为 `"1"`，`distribution.nativeAmount` 必须为 `""`。链信息中的 `nativeCurrency` 仅供添加网络使用，不决定领取哪种资产；沿用此前网络设置，如需修改 gas 币显示名称，应向网络运营方确认。网络、代币、金额或冷却配置修改后需要重新构建并部署。

## 2. 开发环境

需要 Node.js 22.13+、npm 和 Cloudflare 账户。本次交接在 macOS、Node.js 26.8.1 环境验证。首次安装需要访问 npm。

```sh
npm ci
npx wrangler login
npx wrangler whoami
```

确认登录的是接手者要部署的账户。多账户时在 `wrangler.jsonc` 加入目标 `account_id`；单账户可省略，由 Wrangler 确定。Wrangler 使用项目锁定版本，不需要全局安装。

## 3. Worker 名称和域名

在 `wrangler.jsonc` 设置 Worker `name`。默认名为 `anubis-testnet-faucet`。首次在账户使用 Workers 时，先在 Cloudflare 控制台设置该账户的 workers.dev 子域名。

默认访问地址形如：

```text
https://anubis-testnet-faucet.<你的账户子域名>.workers.dev
```

下文的 `faucet.example.com` 代表最终域名，必须替换成上述完整主机名或实际自定义域名。自定义域名可以在 Worker 的 Settings → Domains & Routes 中添加；添加后同步更新 Turnstile 和服务端允许域名，再重新部署。

## 4. 创建并迁移 D1

```sh
npx wrangler d1 create anubis-faucet
```

把返回的 `database_id` 填入 `wrangler.jsonc` 的 `d1_databases[0].database_id`，替换全零占位 ID。若修改数据库名称，也同步修改 `database_name`，绑定名必须保持 `DB`。

```sh
npm run db:migrate:remote
```

这会应用 `worker/migrations/0001_claims.sql`，并维护 D1 迁移记录。不要另外手动执行同一份建表 SQL。后续更新仍使用 migrations apply；已应用的迁移不会重复执行。[D1 迁移说明](https://developers.cloudflare.com/d1/reference/migrations/)

## 5. 创建 Turnstile

在 Cloudflare 控制台的 Turnstile 创建站点，模式选 Managed，允许域名填写最终主机名，不加协议或路径。记录 **Site Key** 和 **Secret Key**。

编辑 `worker/config.json`：

```json
{
  "allowedOrigins": [],
  "turnstile": {
    "hostnames": ["faucet.example.com"],
    "action": "faucet_claim"
  }
}
```

前后端同域时 `allowedOrigins` 保持空数组，同源请求默认允许。只有前端部署到另一个 origin 时才添加该 origin，例如 `https://web.example.com`，不要填路径。`hostnames` 必须和实际访问域名、Turnstile 控制台允许域名一致；不要改 `action`。

服务端通过 Siteverify 校验 token、hostname、action 和客户端 IP，不能只在前端显示验证码。token 只能使用一次，过期或验证失败时需要重新验证。[Turnstile 服务端验证说明](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)

## 6. 前端环境变量

```sh
cp .env.example .env.production
```

编辑 `.env.production`：

```dotenv
VITE_FAUCET_API_URL=/
VITE_TURNSTILE_SITE_KEY=0x4AAAAAAEv-TZyEqCPXlFdQ
```

`Site Key` 是公开值。当前 production build guard 只接受上述 `Anubis Faucet` widget 的公开 Site Key；若日后有意替换 widget，必须同步审阅 build guard、server-side Secret 与 hostname。**Secret Key 和私钥绝不能放进 `VITE_` 变量**，这些变量会进入浏览器代码。目前前端以 EIP-6963 发现并选择浏览器已安装的钱包，再直接使用所选钱包的 EIP-1193 provider；不使用 WalletConnect Project ID，也不持久保存钱包选择。

Vite 的环境变量在构建时写入产物，修改后需要重新构建。已有 `.env.local` 或 `.env.production.local` 时检查是否覆盖了目标值。前端 API 留空会禁用领取。

## 7. 首次部署与 Secrets

准备一个仅供本水龙头使用的 EVM 发币钱包，将私钥保存在接手者自己的安全存储中。私钥格式为 `0x` 加 64 位十六进制字符。不要使用测试代码中的固定私钥。

先检查并部署代码：

```sh
npm run worker:check
npm run worker:deploy
```

`worker:check` 是生产构建和 dry-run，不会发布。`worker:deploy` 会重新构建前端并部署 Worker、静态资源及配置中的 Cron。首次发布尚未设置 Secrets 时，页面可以打开，API 暂时返回 503，属于此步骤的预期状态。

随后交互式输入两个 Secret：

```sh
npx wrangler secret put FAUCET_PRIVATE_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
```

第一个输入发币钱包私钥，第二个输入对应 Turnstile 站点的 Secret Key。不要把真实值写进命令参数、`wrangler.jsonc` 或 Git。Cloudflare 会创建并部署包含 Secret 更新的版本；后续普通部署保留现有 Secrets。[Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

最后向该私钥对应的**新发币地址**充值上述 ERC-20 DAI，金额要足以支付领取数量与 Anubis pre-Aria gas。gas 同样从 DAI system-contract balance 扣除，不要另以一般 EVM native balance 作为是否可发放的判断。旧站钱包地址不是新部署钱包的默认收款地址。

## 8. 部署验收

设置便于复用的公开站点地址：

```sh
FAUCET_URL='https://替换成实际部署域名'
curl -fsS "$FAUCET_URL/api/health"
```

预期 HTTP 200、`{"ok":true}`。健康检查只验证配置可加载及 D1 可读，**不证明钱包有余额、RPC 可用或转账成功**。

缺少验证码的请求必须被拒绝，不会发币：

```sh
curl -i "$FAUCET_URL/api/distribute" \
  -H 'Content-Type: application/json' \
  --data '{"recipientAddress":"0x1111111111111111111111111111111111111111"}'
```

预期 400、提示完成 Cloudflare 验证。若该地址或 IP 已在冷却中，也可能先返回 429。

人工检查首页及 `/add-chain` 的网络值、荧光绿按钮与单个绿色 Anubis 图案动画、手机布局和 Turnstile。用一个新的接收地址完成真实验证并领取，确认收款地址在上述合约的 balanceOf 增加 1 DAI，并核对 Transfer 事件，再用同地址或同 IP 重试，预期 429。实际验收会消耗测试币和该地址/IP 的额度。收到 202 和交易哈希只说明交易任务已提交，必须查链确认到账。

检查 Worker 的 Cron Trigger 是 `* * * * *`。用下面的只读查询查看状态：

```sh
npx wrangler d1 execute DB --remote --command "SELECT id,address,status,tx_hash,created_at,completed_at FROM claims ORDER BY created_at DESC LIMIT 20"
npx wrangler tail
```

## 9. 自动化测试与本地开发

```sh
npm test
```

共 23 项 Worker 测试和 17 项浏览器测试。浏览器测试默认使用本机 Google Chrome；没有 Chrome 时执行 `npx playwright install chromium`，再删除 `playwright.config.ts` 的 `channel: 'chrome'` 一行；Linux 可能需要 Playwright 对应系统依赖。测试服务端使用本地 Miniflare D1、模拟 RPC、模拟 Turnstile 和公开的无资金私钥，不发真实资产。

浏览器测试会监听 4173 和 4189 端口，运行前释放这两个端口。仅运行服务端可用 `npm run test:worker`。

只预览页面：

```sh
npm run dev
```

访问 `http://127.0.0.1:5173`。完整本地 Worker：

```sh
cp .env.example .env.local
cp .dev.vars.example .dev.vars
# 编辑 .env.local 和 .dev.vars 后继续
npm run db:migrate:local
npm run worker:dev
```

访问 `http://127.0.0.1:8787`。同源 API 设 `/`；若用 5173 的 Vite 调用 8787，则将 API 设为 `http://127.0.0.1:8787` 并在 `allowedOrigins` 加入 `http://127.0.0.1:5173`。

本地联调使用独立测试钱包和 [Turnstile 官方测试密钥](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)，根据 Siteverify 返回的 hostname 配置本地允许名单，不要让本地调试值进入生产配置。自动化测试已经隔离这些值；单纯运行 `worker:dev` 不会自动模拟真实链，完成验证后可能向配置 RPC 广播交易。

## 10. 更新、回滚和排错

正常更新：先运行测试；有新增迁移时执行 `npm run db:migrate:remote`；随后 `npm run worker:deploy`。前端与 Worker 共享网络配置，要一起发布。

回滚前在 Cloudflare Versions/Deployments 核对版本，或运行 `npx wrangler deployments list`；仅在网络、Secrets 和 D1 schema 兼容时使用 `npx wrangler rollback <目标版本ID>`。代码回滚不会回滚 D1 数据或交易；不能靠重建数据库解除冷却。

| 现象 | 检查 |
| --- | --- |
| `/api/health` 返回 503 | 两个 Secrets、网络配置、DB 绑定、迁移是否完成 |
| 验证码不显示 | 生产构建中的 Site Key、浏览器控制台、域名配置 |
| 验证码完成但 400 | Site Key/Secret 是否配套，hostname/action 是否一致，token 是否重用 |
| 403 | 前端请求 origin 是否同源或已允许 |
| 429 | 地址或 IP 冷却；共享出口用户共用一个 IP 额度 |
| 无法准备转账 / 503 | RPC 链 ID、合约 decimals、足以支付派发与 pre-Aria gas 的 ERC-20 DAI system-contract 余额、transfer 模拟和 RPC 可用性 |
| 一直 submitted / 后续请求繁忙 | `signed` 记录、Cron、RPC、回执及合约 Transfer 事件是否与领取记录一致 |
| 改了 Site Key 仍旧值 | 检查 `.env.*` 覆盖，重新构建再部署 |

全局只允许一笔活动签名任务，以避免 nonce 冲突。D1 先保存签名交易再广播，RPC 不确定时重发同一笔签名；未签名占用 5 分钟过期。成功回执包含指定合约、发币地址、领取地址和金额均匹配的 Transfer 事件后，开始计算 24 小时冷却，准备失败或链上回滚允许重新验证后重试。模拟 transfer 返回 false、revert 或合约精度不符时不签名；成功回执缺少匹配 Transfer 事件时保留活动记录，人工核查，避免自动重发新交易。存在 pending 交易时不要更换私钥、网络、代币、金额或 D1，或手动删除记录绕过锁。

## 11. 接管现有站点

本交接包是 ERC-20 绿色新版，已发布到参考站点，Worker 版本 `b9b7592b-3983-483a-9182-f521fca9d616`。此次切换前已确认没有 preparing/signed 记录，保留既有 D1 历史。部署验收时健康检查正常，缺验证码请求被拒绝，但发币钱包可用于派发与 pre-Aria gas 的 DAI 余额为 0，尚未做真实到账验证。若接手的是更早的原生币部署，由此前原生币版本升级前，先停止旧站接收新领取并让旧版本处理完交易，使用只读查询确认活动记录为 0：

```sh
npx wrangler d1 execute DB --remote --command "SELECT id,status,tx_hash FROM claims WHERE status IN ('preparing','signed')"
```

结果必须为空才能切换；新版本按 ERC-20 事件核验回执，不能拿旧原生转账回执直接完成新规则校验。保留原 D1 的历史记录，冷却继续有效，不需要新的数据库迁移。

如果接管的是 `anubis-testnet-faucet.price-proxy.workers.dev`，先由原账户所有者授予相应 Cloudflare 权限。这个包不会转移账户权限、数据库或资金。

从控制台核对并填入现有 account ID、Worker 名、D1 ID、实际域名和 Turnstile Site Key。复用现有 D1 和迁移历史，**不要按新站流程新建数据库替换它**。已有 Secrets 应保留，不要输入模板空值覆盖。

现有发币地址是 `0xBD512E1ed202C84326479A77b710608Ad96f0C1D`，私钥未随包提供。本次核验可用于派发与 pre-Aria gas 的 ERC-20 DAI 余额为 0；独立部署应改用新专用钱包并重新查余额。如确需迁移旧私钥，由所有者通过单独安全渠道交付；接管同一个 Worker 不需要从 Secrets 导出私钥。

若改为另一个账户独立部署，优先使用新钱包、新 D1 和新的 Turnstile 站点，按第 2–8 节操作。如果要求保留旧站限流历史或迁移旧资金，先停止旧站领取、处理完未完成交易，再单独安排 D1 和资金迁移；源码交接包没有包含这些数据。

## 12. 源码与视觉维护

主要入口：`src/App.tsx`、`src/components/Faucet.tsx`、`src/components/ClaimDialog.tsx`、`worker/index.js`。服务端流程由 `service.js` 串联 `store.js`、`sender.js`、`turnstile.js`。

主题变量在 `src/global.css`，样式在 `src/App.module.css`，钱包连接逻辑在 `src/components/WalletProvider.tsx`。Logo 使用用户提供的 `public/assets/anubis-logo-white.png`，白色字标带绿色三角；原始 SVG 留作资源来源参考。按钮主题为 #ccff00，背景采用用户更新的 Anubis 图案视频，MP4 优先、WebM 备用，减少动态效果时显示新版 JPG。

背景视频和备用图片在同一容器中。当前不加调色滤镜，视频完整覆盖静态图片；以后如需调色，**滤镜、透明度和混合模式加在容器，不要分别加在视频和图片上**，否则会再次显示两个地球。相关回归测试在 `tests/faucet.spec.ts`。
