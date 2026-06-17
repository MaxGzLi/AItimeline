# E2E run — Fix remaining dark-mode light-border leaks (UI loop, iteration 22)

Date: 2026-06-17 · Branch: `ui/x-dark-borders` (off `origin/main`, incl. iters 1–21)
Source: a dark-theme elevation/state/border audit (continuing the iter-21 audit angle). Cleared
shadows, focus rings, and state legibility as fine; found one more genuine border-leak class.

## The defect (genuine latent leak, same class as iter 20/21 fixes)

Four bg-overridden surfaces carry a hardcoded `border: 1px solid #dce3e8` (light grey) in the base —
NOT `var(--border)` — so on their dark fills the light box border survives in dark mode:
`.post-reason`, `.post-thesis`, `.timeline-thread-block`, `.evidence-meta span`. The iter-20 dark
block fixed the same class for `.auto-scout-toggle`/`.candidate-row`/`.memory-status` but missed
these four. `#dce3e8` (220,227,232) on `#1b2026`/`#222831` is a stark light outline on a dark card.

These render only for **grounded/evidence posts** (the evidence-ledger feature), so they do NOT
appear in the offline demo data (`querySelectorAll` returns 0 in the feed and the demo drawer).
`.thread-block` (drawer, which DOES render) was verified visually clean — already de-boxed.

## Change (CSS-only — `apps/web/src/styles.css`, in the dark `@media` block)

```
.post-reason, .timeline-thread-block, .evidence-meta span { border-color: #2b333c; }
.post-thesis { border-color: #2b333c; border-left-color: var(--blue); }
```
`#2b333c` = `--border` (the value every other fixed `#dce3e8` element uses). `.post-thesis` keeps
its 3px blue left accent (a blanket `border-color` would have killed it — caught and preserved).
Dark-gated, so light mode is byte-for-byte unchanged. Isolated from `feat/ask-ai-endpoint`.

## Verification (real browser render — element injection, since they don't render in the demo)

Because these selectors don't appear in offline demo data, verified by injecting test elements with
each class into the live DARK page (`cdp-shot.mjs DARK=1`) and reading computed `border-color`:
- **BEFORE**: `.post-thesis` `#dce3e8 #dce3e8 #dce3e8 / left #4d8bff`, `.post-reason`/
  `.timeline-thread-block`/`.evidence-meta span` all `#dce3e8` — light leak confirmed.
- **AFTER**: all three sides `#2b333c`; `.post-thesis` left stays `#4d8bff` (blue accent preserved).
- Diff is a dark-block addition only; braces balanced; light mode untouched; ask-AI intact.

Result: **PASS** — all four light-border leaks → dark `#2b333c`, blue accent preserved (verified by
injection; latent for real grounded posts, not visible in the offline demo).

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. This completes dark-mode border coverage
for the `#dce3e8`-box defect class. CSS-only surface remains exhausted; bigger X gains need App.tsx
markup (awaiting user greenlight).
