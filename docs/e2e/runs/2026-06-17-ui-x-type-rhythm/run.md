# E2E run — Display-heading tracking polish (UI loop, iteration 12)

Date: 2026-06-17 · Branch: `ui/x-type-rhythm` (off `origin/main`, incl. iters 1–11)
Source: iter-9 fresh panel's adversarially-ranked #4 (last of that backlog).

## User path

Reader scans the feed → the page title "Knowledge Timeline" and every post title render with
subtly tighter, more deliberate letterforms; opening a post into the drawer → the drawer title
matches — the small "clean type" polish that makes X feel premium, without changing any layout.

## Change (CSS-only — `apps/web/src/styles.css`, 1 end-of-file append, 3 declarations)

The three hero headings all carried `letter-spacing: 0` (a placeholder). Add subtle negative
tracking scaled to size (`body`-scoped, supersedes the base rules):
- `.timeline-header h1` (24px) → `-0.4px`
- `.knowledge-card h2` (21px) → `-0.3px`
- `.drawer-header h2` (20px) → `-0.3px`

Mid-size headings (18px/15px) deliberately left at default tracking (negative tracking there
hurts legibility). Pure paint: no box-model/reflow, no `-webkit-line-clamp` interference.
Isolated from the in-progress `feat/ask-ai-endpoint` work.

## Verification (real browser render — two ways, since the change is sub-pixel)

1. **Computed-style proof** (`docs/e2e/cdp-shot.mjs` + `docs/e2e/interactions/check-heading-
   tracking.js`, which reads `getComputedStyle().letterSpacing` on all three — opening the
   drawer so `.drawer-header h2` exists):
   - BEFORE: `{h1: normal, cardH2: normal, drawerH2: normal}`
   - AFTER:  `{h1: -0.4px, cardH2: -0.3px, drawerH2: -0.3px}`
   Confirms the rules apply to the real rendered elements, including the conditionally-rendered
   drawer title.
2. **Visual** (`title-compare.png`, 2.6× zoom, top=before / bottom=after): the after title
   "Knowledge Timeline" is visibly a touch more condensed (letters closer, word ends earlier).

Result: **PASS** — tracking applied (computed) and visible (zoom).

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. This exhausts the iter-9 panel backlog
→ iter 13 runs a FRESH design panel.
