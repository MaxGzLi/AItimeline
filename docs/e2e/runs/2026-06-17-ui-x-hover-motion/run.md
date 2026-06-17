# E2E run — Kinetic card hover + reduced-motion guard (UI loop, iteration 6)

Date: 2026-06-17 · Branch: `ui/x-hover-motion` (off `origin/main`, incl. iters 1–5)
Source: FRESH adversarial design panel (Workflow `ui-iter6-design`, 4 lenses → judge).
Chosen over topic-tabs (#2), metadata-declutter (#3), dim/dark (#4, rejected).

## User path

Reader moves the cursor down the feed → each card eases (~180ms) to a faint blue-white
tint with a 3px brand-blue "active row" accent bar on its left edge (and the headline
underline eases in), then eases back out — so scrolling feels kinetic/alive instead of
strobing through a hard color snap. With OS "reduce motion" on, the same states apply
instantly with no animation.

## Change (CSS-only — `apps/web/src/styles.css`, 4 edits)

1. `.knowledge-card` → `transition: background-color/box-shadow 180ms` + transparent-start
   inset box-shadow (so the accent fades in; no transform → no reflow/clip).
2. `.knowledge-card:hover` → bg `#f5f8fb → #f7faff` + `box-shadow: inset 3px 0 0
   rgba(47,109,246,.55)` (the left accent bar; inset so `overflow:hidden` can't clip it
   and the shared `border-bottom` stays continuous).
3. `.post-open-button h2` → ease the existing hover underline.
4. New `@media (prefers-reduced-motion: reduce)` guard (the file had none) disabling only
   the two transitions added — hover end-states still apply, so affordances are preserved.

Markup unchanged; isolated from the in-progress `feat/ask-ai-endpoint` work.

## Verification (real browser render)

Headless system Google Chrome via `docs/e2e/screenshot.mjs`. Because this is a hover/motion
change, a static default shot looks unchanged — so the hover END-STATE was verified directly:
- `before.png` / `after.png`: default feed identical (no regression; nothing broken).
- `hover-sim.png` (+ `hover-sim-zoom.png`): a TEMPORARY rule applied the hover end-state to
  the 2nd card only, then was removed before commit (diff confirmed clean, no TEMP leak).
  The shot shows the 2nd card with the blue-white tint + a flush 3px blue left accent bar,
  while cards 1 & 3 stay white with continuous bottom borders — **no layout shift, no border
  break, accent not clipped.** Confirms the panel's one flagged risk (accent flush/clip).
- Reduced-motion + the easing curve are CSS-logic-verified (standard `transition` / `@media
  (prefers-reduced-motion)`), not captured by a static shot.

Result: **PASS** — hover end-state + no-regression confirmed visually; motion logic-verified.

## Delivery

Gated auto-merge: PR → CI `verify` (typecheck + build + smoke) → `--auto --squash`.
Next backlog (this panel): topic-strip-as-tabs (#2), metadata declutter (#3).
