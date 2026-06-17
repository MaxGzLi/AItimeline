# E2E run — X-style action bar (UI loop, iteration 3)

Date: 2026-06-17 · Branch: `ui/x-actionbar` (off `origin/main`, incl. iters 1–2)
Chosen by an adversarial design panel (Workflow `ui-iter3-design`, 4 lenses → judge).

## User path

Reader reaches a post's footer → the like/save/ask/source/explain/skip actions read as an
X-style action row (borderless muted glyphs spread across the footer, per-action hover
colors) instead of a cramped toolbar of bordered boxes → liking a post turns the heart
**red and filled** (previously it shared Save's generic blue box and never turned red).

## Change (CSS-only — `apps/web/src/styles.css`)

Single append after the `.social-metrics` block, **all scoped under `.card-footer`** so the
~8 other `.icon-button.compact` instances (right rail / detail drawer) keep their boxed look:
- Footer action glyphs → borderless, transparent, circular hover halo, spread via
  `flex:1 + space-between` (max-width 360px).
- Per-action hover colors keyed off the stable `title` attrs: Like/Skip → red, Explain →
  neutral, default → blue.
- Selected states paint the glyph: `[title="Like"].selected` → red filled heart,
  `[title="Save"].selected` → blue filled bookmark (`fill: currentColor`).
- `:active` scale pop (0.9 button / 1.18 icon) for a tactile tap.
- Counts get `tabular-nums` + tighter gap to read as X's inline metric cluster.

No markup/`App.tsx` changes; isolated from the in-progress `feat/ask-ai-endpoint` work.

## Verification

Headless system Google Chrome via `docs/e2e/screenshot.mjs` against the live Vite dev
server (demo cards offline).
- **Auto-verified (before.png → after.png):** the default footer renders as a borderless,
  evenly-spread action row (vs. boxed cluster before); 3-column layout intact, all post
  content present, rail/drawer icons unchanged.
- **Not captured by a static shot (CSS-logic-verified):** hover halos, `:active` pop, and
  the liked-red / saved-blue `.selected` states. These selectors target the existing
  markup (`title="Like"`/`"Save"` + the `.selected` class App.tsx already toggles on
  `signal.liked`/`signal.saved`), and use existing `--red`/`--blue`/`--ink` vars. A static
  one-shot Chrome screenshot can't drive hover/click, so these are reasoned, not pixel-proven.

Result: **PASS** (default render confirmed; interactive states logic-verified).

## Delivery

Gated auto-merge: PR → CI `verify` (typecheck + build + smoke) → `--auto --squash`.
