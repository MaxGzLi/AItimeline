# E2E run — Source-import as an X compose box (UI loop, iteration 11)

Date: 2026-06-17 · Branch: `ui/x-compose-import` (off `origin/main`, incl. iters 1–10)
Source: iter-9 fresh panel's adversarially-ranked #3.

## User path

Reader goes to add a source (top of the feed) → the URL field reads like X's compose
("what's happening?") box: a pill-rounded input that lights up a blue focus ring with its
leading link icon turning blue when active, paired with a matching prominent pill Import CTA —
instead of a flat rounded-rectangle input + rectangular button with no focus affordance.

## Change (CSS-only — `apps/web/src/styles.css`, 1 end-of-file append)

`body`-scoped overrides (the `.source-form` grid/sizing/gaps + responsive override untouched):
- `.source-input-shell` → `border-radius:999px` pill; new `:hover` + `:focus-within` blue ring
  (`0 0 0 1px blue, 0 0 0 4px rgba(blue,.14)`) — the file had no focus affordance here.
- leading `svg` icon → muted `#8a98a4` at rest, `--blue` on `:focus-within`.
- `.source-submit` → pill + shadow, `:hover` darker blue + lift.
- reduced-motion guard for the added transitions.

Markup/layout unchanged. Isolated from the in-progress `feat/ask-ai-endpoint` work.

## Verification (real browser render)

- Resting state (static `docs/e2e/screenshot.mjs`): `before-import.png` = flat 8px input +
  rectangular button; `after-import.png` = pill input + pill Import button.
- Focus state (`docs/e2e/cdp-shot.mjs` + `docs/e2e/interactions/focus-import.js`, which focuses
  the URL input; signal `focused=true`): `after-focus-import.png` = blue focus ring around the
  pill + blue leading icon — the X compose affordance.
- Hover states (`#bcd0ee` shell, `#2961e0` button) are CSS-logic-verified.
- Feed unaffected (`.source-*`-scoped selectors only).

Result: **PASS** — pill compose box + blue focus ring confirmed visually (resting + focused).

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Backlog left from iter-9 panel:
type-rhythm (#4) → then a fresh panel (iter 13).
