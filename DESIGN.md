# Anubis faucet visual direction

## 1. Theme
Original black and lime green. A quiet utility for developers requesting Anubis Test DAI, with the Anubis eye sigil video as its visual anchor.

## 2. Palette
Canvas `#000000`, surface `#000000`, inset panel `#0f0f0f`, input `#333333`, border `#9e9e9e`, subtle border `#191919`, text `#f0f0f0`, muted text `#9e9e9e`, accent `#ccff00`, accent hover `#b8e600`, accent ink `#000000`, success `#00c758`. Tokens live in `src/global.css`; RainbowKit mirrors the accent pair in `src/lib/wallet.ts`.

## 3. Typography
Keep the locally hosted Roboto for familiar form labels and compact body copy, and Geist Mono for addresses and network data. Display: 60px, weight 450, tracking -0.035em. Body: 14–16px. Microcopy: 12px. Neutral light text sits on black.

## 4. Components
Primary actions and wallet buttons use lime green fill with black text. Focus rings use the accent. Disabled controls retain opacity 0.5. Small radii: 4px badges, 8px actions, 12px form containers. Use the supplied white ANUBIS PNG wordmark with its green triangle, rendered at 272 × 32px; crop transparent padding only.

## 5. Layout
Retain the centered faucet, 536px form container, 1200px page maximum, and existing responsive spacing. Sequence: identity, wallet connection, recipient and claim, allowance, FAQ, documentation. The claim remains the strongest action.

## 6. Depth
Use neutral black and gray surface steps. No new shadows or glass layers. The Anubis eye video stays fully opaque; readability comes from a veil on the background container after media are composited. The active video (MP4 first, WebM fallback) must fully cover the fallback image; applying opacity or screen blending to each child exposes both marks at once.

## 7. Guardrails
Keep the ERC-20 DAI contract, payout and chain parameters sourced from configuration. Label claim rewards as ERC-20; native currency is only used for network metadata and gas. Do not recolor error states green. Do not add ornamental gradients or additional hero effects. Do not tint third-party wallet logos. Keep the original logo and media files for provenance.

## 8. Responsive and motion
Preserve 320px through desktop layouts and keyboard focus. The eye sigil loops muted; reduced motion renders the still poster. Pointer presses scale to 0.98; keyboard focus avoids that transform. No new entrance animations.

## 9. Follow-up guide
For a new action, use an 8px radius, `#ccff00` background, `#000000` text, 16px/24px Roboto at weight 600, and hover `#b8e600`. For a new network field, use `#000000`, a 1px `#9e9e9e` border, 6px radius, a 12px muted label and 16px/20px Geist Mono value. Any palette update must include the wallet theme, original logo, video and reduced-motion still.
