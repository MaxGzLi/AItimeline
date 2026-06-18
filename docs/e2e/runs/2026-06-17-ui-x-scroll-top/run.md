# E2E run — Scroll-to-top button (UI loop, iteration 30)

Date: 2026-06-17 · Branch: `ui/x-scroll-top` (off `origin/main`)
Sixth markup feature (greenlit). Engagement/刷着上瘾 — a frictionless jump back to the freshest posts
after a long scroll. Built in an isolated `git worktree`; the uncommitted ask-AI WIP was untouched.

## Feature — user path

Scroll the feed down ~one screen → a blue circular **↑** button fades in at the bottom-right → click
it → the page smooth-scrolls back to the top and the button disappears again.

## Change (App.tsx state + scroll effect + button, styles.css)

- `App.tsx`: import `ArrowUp` (lucide); `showScrollTop` state; a passive `scroll` listener effect
  (`window.scrollY > 600`); a fixed `.scroll-top-button` (`aria-label`, `ArrowUp`) rendered at the end
  of the app-shell that calls `window.scrollTo({top:0, behavior:"smooth"})`.
- `styles.css`: `.scroll-top-button` — `position:fixed` bottom-right (28/28), 48px circle,
  `background: var(--blue)` + white glyph + soft shadow, hover lift. `var(--blue)` auto-adapts to
  dark, so no override block.

## Verification (real browser render — cdp-shot, LIGHT=1 / DARK=1)

- **Typecheck**: `tsc -p tsconfig.json --noEmit` → clean.
- **Behavior**: at top → button absent; after `scrollTo(0,900)` → present; clicking it →
  `window.scrollY === 0` and button hidden again. Position rect = `right:28, bottom:28, w:48`.
- **Appearance** (computed): `background rgb(47,109,246)` light / `rgb(77,139,255)` dark (var auto-
  adapts), `border-radius 9999px`, 48×48, white glyph, `ArrowUp` svg present. `*-btn-vis-crop.png`
  (temp runtime reposition, not committed) shows the blue circle + white up-arrow in both themes.

Result: **PASS** — working, theme-correct scroll-to-top FAB that reveals on scroll and returns to top.

## Delivery

Gated auto-merge: PR → CI `verify` (npm ci → typecheck → build → smoke) → `--auto --squash`. Isolated
worktree removed afterward; main checkout (feat/ask-ai-endpoint WIP) untouched.
