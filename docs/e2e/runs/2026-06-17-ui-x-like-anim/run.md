# E2E run — Celebratory pop when a like/save lands (UI loop, iteration 32)

Date: 2026-06-17 · Branch: `ui/x-like-anim` (off `origin/main`)

## What I found first (avoided a redundant/breaking diff)

The like/bookmark interaction was **already well-built**: `.card-footer .card-actions
.icon-button.compact[title="Like"].selected` already paints the glyph red + fills it
(`fill: currentColor`), Save fills blue, there are per-action hover colors, and a press-pop on
`:active` (svg `scale(1.18)`). My first attempt (swapping `.selected` for new `is-liked` classes +
re-adding fill) only **broke** the existing higher-specificity rules — reverted entirely.

## The one genuine gap → the change (CSS only)

The existing pop fires on **press** (`:active`), not when the like **lands** (state change). Added a
one-shot celebratory bounce to the existing `[title="Like"].selected svg` / `[title="Save"].selected
svg` rules via `animation: like-land-pop 0.4s ease` (scale 1 → 1.5 → 0.85 → 1.12 → 1), plus a
`prefers-reduced-motion: reduce` guard that disables it. No markup change — buttons already toggle
`.selected`, so the ask-AI App.tsx WIP is untouched.

## Verification (real browser — cdp-shot, dispatched clicks)

- Click Like → `.selected`, computed `color rgb(175,69,69)` (var(--red)), svg `fill rgb(175,69,69)`
  (filled red heart), `animation-name: like-land-pop`. ✓
- Click Save → `.selected`, `color rgb(50,109,238)` (var(--blue)), `animation-name: like-land-pop`. ✓
- Light + dark screenshots of the action row: heart fills red, bookmark fills blue, other glyphs
  stay muted outline. (`light-actions-crop.png`, `dark-actions-crop.png`)
- CSS braces balanced (481/481); existing `.selected` fill rules preserved.

Result: **PASS** — adds an X-style "the like landed" bounce on top of the existing fill, without
touching the existing press-pop, hover colors, or markup.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Isolated worktree; ask-AI WIP untouched.
