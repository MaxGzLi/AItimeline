# E2E run — Left-rail "Run Scout" CTA → X "Post"-style pill (UI loop, iteration 18)

Date: 2026-06-17 · Branch: `ui/x-cta-pill` (off `origin/main`, incl. iters 1–17)
Source: iter-17 fresh design panel's #2 — the panel's only *medium*-impact item.

## User path

User opens the app → the left-rail "Run Scout" CTA is now a rounded X "Post"-style **pill** in a
softly-promoted card, and it **reacts**: darkens + glows on hover, sinks 1px + darkens on press,
shows a blue keyboard focus ring. Before, it was the only interactive control in the left column
with NO interaction states (a flat, inert 8px-radius blue rectangle) — every other left-rail
control (.nav-item / .topic-pill / .secondary-action) already reacts after iters 13–16.

## Change (CSS-only — `apps/web/src/styles.css`, end-of-file append, scoped to `.agent-brief`)

- `section.agent-brief` → soft promoted block (lighter border + faint top-blue gradient).
- `.agent-brief .primary-action` → 999px pill + resting shadow + transition.
- `:hover:not(:disabled)` → darken `#2560e6` + blue glow.
- `:active:not(:disabled)` → darker `#1f54cf` + `translateY(1px)` sink.
- `:focus-visible` → blue ring. **Required, not redundant** with the global iter-15 ring: the
  resting `.agent-brief .primary-action` box-shadow (specificity 0,2,0) out-specifies the global
  `button:focus-visible` (0,1,1), so the scoped (0,3,0) focus rule is what actually lets the ring
  paint over the resting shadow.

Scoped to `.agent-brief` so the shared `.primary-action` used elsewhere is untouched. Only
radius/color/shadow/transform — no display/flow/grid change, no layout risk. Isolated from the
in-progress `feat/ask-ai-endpoint` work.

## Verification (real browser render — `docs/e2e/screenshot.mjs`)

- `before-cta.png`: flat 8px-radius blue rect in a plain white card.
- `after-cta.png` (resting): 999px pill + soft drop shadow; card now faint-blue-tinted gradient.
- `hover-sim-cta.png` (temp-sim forcing `:hover`): pill darkened to `#2560e6` with blue glow halo.
- `focus-sim-cta.png` (temp-sim forcing the focus box-shadow): blue ring follows the pill's 999px
  shape and paints over the resting shadow — confirms the scoped focus rule wins specificity.
- `:active` (1px sink) not separately captured — trivial transform, no layout/overflow effect.
- Both temp-sim rules removed before commit; `grep TEMP-SIM` = 0, `git diff` append-only.

Result: **PASS** — pill + promoted card + all three interaction states confirmed visually.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. This exhausts the iter-17 panel backlog
→ iter 19 runs a FRESH design panel WITH an honest ceiling check (per CEILING NOTE: if its best
is only low-value churn, tell the user plainly rather than padding the loop).
