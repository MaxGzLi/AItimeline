# E2E run — Right-rail as X "What's happening" widget cards (UI loop, iteration 9)

Date: 2026-06-17 · Branch: `ui/x-rail-widgets` (off `origin/main`, incl. iters 1–8)
Source: FRESH adversarial design panel (Workflow `ui-iter9-design`, 4 lenses → judge).
Ranked #1 over: drawer-as-reply-thread (#2), import-as-compose-box (#3), type rhythm (#4).

## User path

Reader's eye moves to the right rail → each context section (Candidates, Imports, Saved
Concepts, Review, AI Credits) reads as a distinct rounded, softly-tinted X-style widget card,
and the read-only concept/review/import rows are flush divider-separated lines (with a quiet
full-row hover) instead of a column of individually-outlined white boxes — so the rail feels
like X's "What's happening" sidebar, not a grid of nested boxes.

## Change (CSS-only — `apps/web/src/styles.css`, 1 end-of-file append)

`body`-scoped overrides (edits no existing rule; matches the file's override convention):
- `.context-section` → rounded 14px card, `#f7f9fb` tint, full border (overriding the base
  border-bottom-only), 14px gaps; `:first-child` regains top padding, `:last-child` flush.
- `.graph-list/.review-list/.import-list` → `margin-top:6px` so the first row tucks under the
  heading.
- `.graph-row/.review-row/.import-row` → de-boxed (border:0, transparent), separated by a
  `#e6edf2` hairline top divider (none above each list's first row), quiet `#eef3f7` full-row
  hover + a reduced-motion guard. Base `display:flex` left intact → row layout unchanged.
- **Excluded `.candidate-row`** and the candidate form controls/auto-scout toggle: their
  queued/imported/dismissed colored borders+fills encode state and must stay as chips.

No position/overflow/display changes → the sticky rail is preserved. The center feed selectors
are untouched. Isolated from the in-progress `feat/ask-ai-endpoint` work.

## Verification (real browser render)

Headless system Google Chrome via `docs/e2e/screenshot.mjs` + a before/after crop of the right
rail (`before-rail.png` / `after-rail.png`).
- **Auto-verified:** before = concept rows as individually-outlined white boxes, sections split
  only by hairlines; after = each section a rounded tinted card spaced by gaps, concept rows
  flush divider-separated lines with count chips, candidate controls still boxed. Rail still
  sticky/scrolls; center feed unaffected (rail-scoped selectors only).
- **Not in a static shot (CSS-logic-verified):** the `#eef3f7` row hover.

Result: **PASS** — rail widget-card grammar confirmed visually.

## Delivery

Gated auto-merge: PR → CI `verify` (typecheck + build + smoke) → `--auto --squash`.
Next: a fresh panel (iter 10) over remaining CSS-only surface (drawer reply-thread was the
panel's #2 and is a strong follow-up candidate).
