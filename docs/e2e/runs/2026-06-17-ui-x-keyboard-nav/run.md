# E2E run — X-style keyboard navigation (UI loop, iteration 28)

Date: 2026-06-17 · Branch: `ui/x-keyboard-nav` (off `origin/main`)
Fourth markup feature (greenlit). First engagement/刷着上瘾 feature (prior three served filtering).
X has exactly this (j/k); it makes the feed frictionless to browse without the mouse.
Built in an isolated `git worktree`; the uncommitted ask-AI WIP in the main checkout was untouched.

## Feature — user path

- **j / k** — move a focus highlight to the next / previous card (scrolls it to center).
- **Enter** — open the focused card's thread drawer.
- **/** — jump to the header search (opens it and focuses the input).
- **Escape** — in search: close + clear it; otherwise: clear the card focus.
- Typing in any input/textarea suppresses j/k/Enter/“/” (only Escape acts), so search/import/ask-AI
  fields keep working normally.

## Change (App.tsx state + effects + a card prop, styles.css)

- `App.tsx`: `focusedIndex` state; a `keydown` window listener (with an input/textarea/
  contentEditable typing-guard and a modifier-key guard) that maps j/k/Enter///Escape; an effect that
  `scrollIntoView({block:"center"})`s the focused card; an effect that clamps `focusedIndex` when the
  filtered list shrinks. `KnowledgeCardView` gains an `isFocused?` prop → `knowledge-card focused`.
  Composes with the existing tabs/search/topic filters (operates on `visibleCards`).
- `styles.css`: `.knowledge-card.focused` = full-strength version of the existing hover accent —
  `box-shadow: inset 3px 0 0 var(--blue)` + subtle tint; dark `@media` override for the tint bg.
  The bar uses `var(--blue)` so it auto-adapts (light `#2f6df6` / dark `#4d8bff`).

## Verification (real browser render — cdp-shot, LIGHT=1 / DARK=1)

- **Typecheck**: `tsc -p tsconfig.json --noEmit` → clean.
- **Functional** (dispatched real KeyboardEvents): j→focus 0, j→1, k→0; `/` opens search +
  `document.activeElement === input` (true); pressing j *while typing* leaves focus at 0 (guard
  works); Escape closes search; Enter → `.detail-drawer` present (focused card opened). All true.
- **Focus highlight**: focused card computed `box-shadow` = `rgb(47,109,246) 3px inset` (light) /
  `rgb(77,139,255) 3px inset` (dark) — auto-adapted; `light-first-bar.png` shows the blue leading
  bar + tint on the focused card.

Result: **PASS** — working, accessible, theme-correct keyboard navigation over the (filtered) feed.

## Delivery

Gated auto-merge: PR → CI `verify` (npm ci → typecheck → build → smoke) → `--auto --squash`. Isolated
worktree removed afterward; main checkout (feat/ask-ai-endpoint WIP) untouched.
