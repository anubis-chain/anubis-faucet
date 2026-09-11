# Reconstruction evidence

## Anubis Testnet branding update

The current brand is **Anubis Testnet**, using `https://anubischain.ai/assets/anubislogo_light.svg` unchanged as `public/assets/anubis-logo.svg`, with an adjacent Testnet label. The official `https://anubischain.ai/favicon.png` is saved as `public/assets/anubis-favicon.png`. Header and footer share the same brand component. The site's own documentation link is `https://anubis-network.gitbook.io/anubis-network`. Original Robinhood screenshots and measurements below are retained as layout reference, not current brand screenshots.

Anubis network parameters have not been supplied. All former network parameters, contract addresses and explorer links have been removed from the application. Network actions remain disabled until actual Anubis configuration is provided. Historical source names below are retained solely for provenance.

Observed on 2026-09-09 from https://faucet.testnet.chain.robinhood.com/ and `/add-chain` using Chrome. Inspected rendered DOM, the site's generated stylesheet, application chunks and the public `/api/tokens` response. The actual private repository, server handlers, OAuth credentials and faucet signing keys are not available from the public website.

| Local asset | Original resource |
| --- | --- |
| Former `chain-logo.svg` (removed from public assets) | `https://faucet.testnet.chain.robinhood.com/chain-logo.svg` |
| `background.webm` | Anubis eye sigil animation (converted from `ANUBIS动画.mp4`, VP9, muted) |
| `background.jpg` | Still from the same animation (~5s), used as poster / reduced-motion fallback |
| Former `offchain.webp` (removed from public assets) | Original `/ocl_logo.webp`, served through the public Next image optimizer |
| `roboto.woff2` | `/_next/static/media/ce62453a442c7f35-s.p.0333ktddfbsxy.woff2` |
| `geist-mono.woff2` | `/_next/static/media/797e433ab948586e-s.p.08e28id.o-okb.woff2` |
| `privacy-toggle.svg` | `/privacy_toggle_icon.svg` |
| `google.svg` | `/google_icon.svg` |

Observed application stack: Next.js, React, Tailwind CSS, RainbowKit/wagmi/viem, Cloudflare Turnstile, Google Sign-In/NextAuth, Usercentrics. Reconstruction stack: Vite, React, TypeScript, CSS Modules, a native EIP-1193 provider adapter, and EIP-6963 wallet discovery. Retains the visual rules and public wallet functionality as readable components instead of replaying the site's compiled bundles.

At 1440px viewport width, original measurements: main width 1200px, main height 1916px, hero heading y=178px and height=60px, form x=485px, y=558px, width=470px, height=376px. At 375px viewport width: form x=33px, y=539.25px, width=309px, height=450px. The copy and font files are taken from the actual reference, not inferred from screenshots.

Intentional differences: no original tracking scripts; privacy dialog describes this replica; no real CAPTCHA/OAuth/distribution without owner configuration; EIP-6963 discovers only installed browser wallets with a legacy `window.ethereum` fallback and no WalletConnect dependency; invalid recipients get an inline error; keyboard focus is visible; background animation respects reduced motion. Public brand assets retain upstream rights.

## 用户更新的 Logo

2026-09-09，用户提供 `public/assets/anubis-logo-white.png`，1352 × 257px，透明背景、白色 ANUBIS 字标及绿色三角。当前页头与页脚使用此图；`Brand.tsx` 和 CSS 控制显示尺寸与透明留白裁切。此 PNG 不标记为官网抓取素材。

## 用户更新的背景视频

2026-09-10，用户更新 `background.mp4`、`background.webm` 和 `background.jpg`，内容为绿色 Anubis 图案，分辨率 2560 × 1152，视频约 15.1 秒。当前页面优先使用 MP4，WebM 作为备用；减少动态效果时显示 JPG。此版本替换了最初的白色粒子球背景。
