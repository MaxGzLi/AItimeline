# E2E run — Fix feed body type hierarchy (UI loop, iteration 17)

Date: 2026-06-17 · Branch: `ui/x-feed-body` (off `origin/main`, incl. iters 1–16)
Source: FRESH adversarial design panel (Workflow `ui-iter17-design`) — judge's #1 over the
left-rail CTA (#2, medium), metric row (#3), wildcard (#4). Panel was tasked to find the single
highest-impact remaining CSS-only change or declare the ceiling; it found a real hero-feed defect.

## The defect (on the hero scroll)

`.summary` is the only text token in a knowledge-card with NO explicit `font-size`, so it
inherited the UA-default **16px**, while every deliberate token sits on a 13/14/15/21px scale.
The bold lead-in `.post-hook` is 15px/800 — so the regular-weight summary directly below it
rendered **larger (16px) than the bold line introducing it**: a backwards hierarchy step the eye
hits on every card during the exact action the directive prioritizes ("make scrolling addictive").

## Change (CSS-only — `apps/web/src/styles.css`, 1 rule)

```
body .summary { font-size: 15px; line-height: 1.55; }
```
Puts the body on the card's own scale (15px == X tweet body) and bumps leading to 1.55 so the
slightly smaller glyphs keep their air. `body`-scoped to beat the base rule; color + the 2-line
`-webkit-line-clamp` are inherited (clamp counts lines, not px → still two lines, no overflow).
Base `.summary` rule untouched. Isolated from the in-progress `feat/ask-ai-endpoint` work.

## Verification (real browser render — measured before/after)

Computed `font-size`/`line-height` read via `docs/e2e/cdp-shot.mjs` + an inline check
(`getComputedStyle` on `.summary` / `.post-hook` / card `h2`; 3 summaries render):
- **BEFORE** (rule temporarily disabled): `.summary` **16px** / lh 24px — **larger** than the bold
  `.post-hook` (15px). Backwards step confirmed.
- **AFTER**: `.summary` **15px** / lh 23.25px — now **equal to** the hook (15px). Hierarchy correct
  (title 21 > hook/summary 15).
- Full feed shot (`after.png`): summaries render as 2-line clamped bodies, no overflow/clipping,
  feed packs marginally tighter. Title/hook crop (`before-body.png`/`after-body.png`) unchanged
  (only the body token moved). The temp-disable marker was removed before commit (grep + diff clean).

Result: **PASS** — backwards body>hook step fixed (16px→15px), measured; clamp + layout intact.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Next backlog (this panel): the left-rail
"Run Scout" CTA → X "Post"-style pill with hover/active/focus states (#2, the panel's only
*medium*-impact item) is the strongest follow-up for iter 18.
