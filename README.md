# Anubis Testnet Faucet ERC-20 DAI

目前的接管部署目標是 AWS Singapore，以 CloudFront、WAF、私有 S3、Lambda、DynamoDB 與 Secrets Manager 作人工部署；Cloudflare 只保留 DNS 與 Turnstile。請先閱讀 [AWS 手動部署手冊](docs/AWS-MANUAL-DEPLOY.zh-TW.md)。`worker/`、D1 migration、`wrangler.jsonc` 及原 Cloudflare 部署文件保留作交接參考與回歸測試，並非新 production 路徑。

原始開發交接內容如下。

这是可修改、可重新构建的完整源码交接包。先阅读 [部署文档](docs/DEPLOY.zh-CN.md)，再填写配置并发布。无需访问原开发者电脑，也无需 MCP。

## 已实现

- React + TypeScript 前端，JavaScript Cloudflare Worker，D1 数据库，Workers Static Assets。
- Anubis 最初的黑底荧光绿主题、用户提供的白色 PNG 字标（绿色三角）、绿色 Anubis 图案动画（MP4/WebM）；已修复动画与静态备用图叠加成两个地球的问题。
- Anubis Test，Chain ID `202601`，ERC-20 `DAI`，每次 `1 DAI`；合约 `0x83fd06F0846d9D90B3016bF670Efe2E0B11cDe14`，18 位精度。
- 地址和 IP 各自限制 24 小时一次；服务端验证 Cloudflare Turnstile。
- Workers Secrets 托管发币私钥；D1 原子占用额度、持久化签名交易，每分钟 Cron 恢复和核对交易。
- 23 项 Worker 测试和 17 项浏览器测试，包括重复地球、錢包連線與 API 安全回歸測試。

## 接手者需要准备

若沿用原 Cloudflare Worker 路徑，需要 Cloudflare 账户、部署域名、新建 D1、Turnstile Site Key 和 Secret Key、专用发币钱包私钥，以及该钱包在 Anubis Test 上的 ERC-20 DAI 余额。Anubis pre-Aria 的 gas 同樣從 DAI system-contract balance 扣除，不能只用一般 EVM native balance 判斷。使用项目锁文件运行 `npm ci`。

包内 `wrangler.jsonc` 和 `worker/config.json` 已换成独立部署模板。数据库的全零 ID、`faucet.example.com` 都是占位值，必须替换。不要把 `.env.example`、`.dev.vars.example` 的空值当作可用配置。

## 目录

| 路径 | 内容 |
| --- | --- |
| `src/` | 页面、钱包集成、API 客户端、网络与领取配置 |
| `public/assets/` | Logo、字体、视频和备用图片 |
| `worker/` | JS API、发币签名、限流、验证码、交易恢复 |
| `aws/backend/` | AWS Lambda API、原子限流、簽署交易持久化與交易恢復 |
| `infra/` | AWS CDK infrastructure；無 Jenkins／CI/CD |
| `worker/migrations/` | D1 SQL 迁移 |
| `tests/` | 服务端与浏览器自动化测试，测试私钥均为公开无资金夹具 |
| `docs/DEPLOY.zh-CN.md` | 从零部署、接管、验收、排错与日常维护 |
| `docs/AWS-MANUAL-DEPLOY.zh-TW.md` | AWS Singapore 人工部署、DNS、錢包與上線驗收 |
| `DESIGN.md` | 视觉规范及背景合成规则 |
| `references/` | 原始复刻阶段的参考截图和资源来源，截图记录复刻阶段，领取代币以当前 ERC-20 配置为准 |
| `MANIFEST.sha256` | 包内文件的 SHA-256 清单 |

交接包不含真实私钥、Turnstile Secret、Cloudflare Token、Git 历史、数据库内容、依赖目录或构建缓存。`.env.production` 需要接手者按部署文档创建。前端产物 `dist/` 由源码重新构建。

## 交接验收记录

2026-09-09，将 ERC-20 交接 ZIP 解压到独立目录并使用包内配置进行验证：`npm ci` 安装成功，`npm test` 的 38 项测试全部通过，`npm run worker:check` 的生产构建和 Worker dry-run 通过，`npm run db:migrate:local` 建表成功。交接包未在接手者账户创建资源；现有站点已发布，未执行真实资金转账。其後已確認 Anubis pre-Aria 的派發與 gas 均從發幣錢包的 DAI system-contract balance 扣除。

2026-09-11，AWS 人工部署版本已改用原生 EIP-1193 browser wallet provider，並以 EIP-6963 提供只限已安裝瀏覽器錢包的輕量選擇器；`window.ethereum` 只作舊式錢包後備，選擇只留在頁面記憶體。RainbowKit、Wagmi、React Query 與 WalletConnect 依賴均已移除。重新通過 23 項 Worker 測試、20 項瀏覽器測試、production build；完整與 production-only `npm audit` 均為 0 vulnerabilities。AWS Lambda backend 另有 48 項測試全部通過。

ZIP 同目录的 `.sha256` 文件用于核对整个压缩包；解压后在项目根目录运行 `shasum -a 256 -c MANIFEST.sha256` 可以验证包内文件。Linux 也可用 `sha256sum -c MANIFEST.sha256`。配置修改后相应文件的哈希变化属于预期。

现有参考站点：<https://anubis-testnet-faucet.price-proxy.workers.dev/>。2026-09-10 的背景视频更新已通过 Cloudflare MCP 发布到参考站点，保留绿色主题和 ERC-20 发放规则，Worker 版本为 `b9b7592b-3983-483a-9182-f521fca9d616`。若浏览器仍显示旧版，可访问带版本参数的地址 `/?v=video-20260910`。参考站点的账户与资金不会随此源码包转移。若接管它，请按部署文档的接管章节办理。

页面基于公开可访问的原站资源重建，不是原站内部源码。品牌及上游素材保留原权利归属，见 `references/SOURCES.md`；交接不代表对第三方素材授予新许可。

本轮 Logo 更新已检查桌面与 320px 手机渲染，并重新通过 15 项浏览器测试及生产构建；Worker 源码与此前通过 23 项服务端测试的版本一致。

2026-09-10 视频更新：15 项浏览器测试通过，桌面/手机实际渲染、MP4 播放、WebM 备用及静态图遮盖检查通过。服务端发币逻辑与上版一致。
