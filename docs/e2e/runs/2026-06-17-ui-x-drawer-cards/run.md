# E2E run — Drawer detail sections as X widget cards (UI loop, iteration 14)

Date: 2026-06-17 · Branch: `ui/x-drawer-cards` (off `origin/main`, incl. iters 1–13)
Source: iter-13 fresh panel's adversarially-ranked #2.

## User path

Reader opens a post's detail drawer → the detail sections (Thread, Source Chunks, Graph Edges,
Review & Next Actions, etc.) read as cohesive rounded X widget cards, and the read-only rows
inside them are flush divider-separated lines with a quiet hover — instead of a nested
"card-in-card" stack of individually-outlined white boxes. Matches the right rail's iter-9
"What's happening" grammar, so the whole expanded view feels like one surface.

## Change (CSS-only — `apps/web/src/styles.css`, 1 end-of-file append)

`aside.detail-drawer`-scoped overrides (mirrors the iter-9 right-rail treatment):
- `.drawer-section` → rounded 14px card, `#f7f9fb` tint (+ `.evidence-ledger-section` rounded to
  match so its green accent card isn't a different shape).
- `.thread-block-list/.chunk-list/.edge-list/.review-prompt-list` → `margin-top:2px` tuck.
- `.chunk-row/.thread-block/.edge-row/.review-prompt-row` → de-boxed (border:0, transparent),
  hairline `#e6edf2` top divider (none above each list's first row), quiet `#eef3f7` hover +
  reduced-motion guard. Base grid/flex layout untouched → row layout unchanged.
- **Left alone:** `.chat-list` (already an X thread, iter 10), `.feedback-panel`, signal/
  next-action chips, evidence stats — their colored fills encode state.

All 10 targeted classNames verified present in `origin/main:App.tsx`. Markup unchanged; isolated
from the in-progress `feat/ask-ai-endpoint` work.

## Verification (real browser render via the CDP harness)

The drawer is interaction-gated, so verified with `docs/e2e/cdp-shot.mjs` +
`docs/e2e/interactions/open-drawer.js` (clicks `.post-open-button`; signal `drawer-open=true`),
captured at a tall 1440×2200 viewport so the full-height fixed drawer shows all stacked sections.
- `before-sections.png`: Thread blocks (EXAMPLE/CONTRAST/EXTEND) as individually-outlined white
  boxes (card-in-card).
- `after-sections.png`: same blocks de-boxed into hairline-divider lines on a tinted section card.
- `after-drawer.png` (full): every section a cohesive rounded tinted card; Feedback Loop +
  Ask-AI chat preserved; nothing broken.
- Row hover (`#eef3f7`) is CSS-logic-verified.

Result: **PASS** — drawer widget-card grammar confirmed visually.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Backlog left from iter-13 panel: global
focus/scrollbar (#3), empty/loading (#4) → then a fresh panel.
