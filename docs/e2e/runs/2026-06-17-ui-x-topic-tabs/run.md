# E2E run — Topic strip as X-style segmented filter pills (UI loop, iteration 7)

Date: 2026-06-17 · Branch: `ui/x-topic-tabs` (off `origin/main`, incl. iters 1–6)
Source: iter-6 fresh panel's adversarially-ranked #2.

## User path

Reader looks at the topic row under the header → topics ("AI Agent", "RAG", "Product
Strategy") read as X-style segmented filter capsules (fully-rounded, muted resting, blue
on hover/press) that invite tapping to filter the feed, with a clean hidden-scrollbar
horizontal scroll.

## Change (CSS-only — `apps/web/src/styles.css`, 2 edits)

1. `.topic-strip` → tighter (`gap 8px`, `padding 10px 24px`), panel bg, `scrollbar-width:
   none` + `::-webkit-scrollbar { display:none }` for a clean horizontal scroll.
2. `.topic-pill` → fully-rounded capsule (`border-radius:999px`), muted `#f1f4f7` fill +
   `--border` hairline, 14px/600 text, with `:hover` / `:focus-visible` / `:active` blue
   states + a small press scale. Deliberately **not** sticky (a prior panel flagged the
   sticky-strip z-index/variable-header-height risk).

Shared base rule (`.nav-item/.primary-action/.secondary-action/.topic-pill`) untouched, so
nav + action buttons are unaffected. Markup unchanged; isolated from the in-progress
`feat/ask-ai-endpoint` work.

## Verification (real browser render)

Headless system Google Chrome via `docs/e2e/screenshot.mjs` + a 1.6× crop of the topic row
(`after-topic-zoom.png`).
- `before.png` → `after.png`: topic chips become fully-rounded capsules; layout intact, feed
  + header unaffected.
- Crop confirms the three capsule pills render as designed. Hover/focus/active blue states
  are CSS-logic-verified (not captured by a static shot).

Result: **PASS** — capsule pills confirmed visually.

## Delivery

Gated auto-merge: PR → CI `verify` (typecheck + build + smoke) → `--auto --squash`.
Backlog left from iter-6 panel: metadata declutter (#3) → then a fresh panel (iter 9).
