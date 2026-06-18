# E2E run — Respect prefers-reduced-motion for programmatic scrolls (UI loop, iteration 45)

Date: 2026-06-18 · Branch: `ui/x-reduced-motion-scroll` (off `origin/main`)

## The gap

The keyboard nav I built scrolls with `behavior: "smooth"` in JS at three sites — `g` jump-to-top
(#44), the j/k focus follow (`scrollIntoView`), and the floating scroll-top button (#36). **JS
smooth-scroll ignores `prefers-reduced-motion`** (unlike CSS `scroll-behavior`). The codebase already
honors reduced motion in CSS (8 `@media (prefers-reduced-motion: reduce)` blocks), so these three JS
scrolls were the lone inconsistency — users who asked the OS for reduced motion still got animated
scrolling (the exact discomfort the preference exists to prevent).

## The change

- App.tsx: `scrollMotion()` helper → `matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto"
  : "smooth"`. All three sites now pass `behavior: scrollMotion()`.
- docs/e2e/cdp-shot.mjs: added `REDUCE=1` to emulate `prefers-reduced-motion: reduce` (mirrors the
  existing DARK/LIGHT prefers-color-scheme emulation), so motion a11y is verifiable now and later.

## Verification (real browser — cdp-shot, dispatched KeyboardEvents)

- **Normal** (`matchMedia` matches = false): `g` scrolls 1423 → 0 (smooth). Functionality intact.
- **REDUCE=1** (`matchMedia` matches = true → `scrollMotion()` returns "auto"): `g` still scrolls
  1423 → 0, instantly. Functionality preserved; animation suppressed per preference.
- 0 hardcoded `behavior: "smooth"` remain in App.tsx. `typecheck` exit 0.

Result: **PASS** — programmatic scroll now matches the codebase's reduced-motion discipline.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Isolated worktree; ask-AI WIP untouched.
