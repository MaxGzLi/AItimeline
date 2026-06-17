# E2E run — X-style "Open thread" CTA on the connector line (UI loop, iteration 4)

Date: 2026-06-17 · Branch: `ui/x-thread-cta` (off `origin/main`, incl. iters 1–3)
Source: design panel's adversarially-ranked #2 (Workflow `ui-iter3-design`); re-validated
against current main and implemented this iteration.

## User path

Reader scrolls a post's thread preview → the "Open thread · N replies · M checks" row is
now an X-style "Show replies" CTA: a full-width blue tappable pill whose node dot sits ON
the vertical reply-connector line, visually continuing the thread down and inviting a tap
to expand the conversation.

## Change (CSS-only — `apps/web/src/styles.css`, 2 edits)

1. `.social-thread-preview` → `position: relative` (additive; enables the dot's coordinate
   space; no existing absolutely-positioned children).
2. `.thread-count-button` → full-width blue pill CTA (`border-radius:9999px`, blue text,
   38px tall, hover fill `#eaf1ff` + underline), plus a `::before` node dot
   (`left:-19px`, 9px hollow blue circle on `--panel` fill) anchored on the connector line.

Builds on iter1 (connected borderless replies) and iter3 (action bar); markup unchanged;
isolated from the in-progress `feat/ask-ai-endpoint` work.

## Verification (real browser render)

Headless system Google Chrome via `docs/e2e/screenshot.mjs`, plus a 1.5× crop of the first
card's thread region (`after-thread-zoom.png`).
- `before.png` → `after.png`: the count row becomes a blue full-width CTA; layout intact.
- **Flagged risk confirmed safe:** the panel warned the `left:-19px` dot was layout-
  sensitive. The zoom crop shows the hollow blue dot sitting cleanly centered on the 2px
  connector line, left of the CTA text — no overlap, no misalignment. This is a static
  affordance (always visible), so the screenshot fully verifies it (hover underline/fill
  is the only non-captured state, CSS-logic-verified).

Result: **PASS** — render + the risk-area dot positioning visually confirmed.

## Delivery

Gated auto-merge: PR → CI `verify` (typecheck + build + smoke) → `--auto --squash`.
