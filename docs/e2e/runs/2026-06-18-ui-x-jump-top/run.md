# E2E run — `g` jump-to-top keyboard shortcut (UI loop, iteration 44)

Date: 2026-06-18 · Branch: `ui/x-jump-top` (off `origin/main`) · App.tsx only

## The gap

The feed has vim-style keyboard nav (j/k/Enter/l/s) but no way to snap back to the top by keyboard —
after scrolling deep you had to reach for the mouse (the floating scroll-top button) or scroll back up.
A single `g` (it pairs naturally with the existing j/k vim keys) lets you re-scan the feed from the top
without leaving the keyboard — faster triage flow (刷着上瘾).

## The change (App.tsx only)

- New `case "g"` in the keydown switch (after k): `window.scrollTo({top:0, behavior:"smooth"})` +
  `setFocusedIndex(-1)` (clear the focus ring so the off-screen card doesn't keep it). Inherits the
  existing typing-guard + modifier-guard.
- Documented in the `?` shortcuts overlay (a "Jump to top" row grouped with j/k).

## Verification (real browser — cdp-shot, dispatched KeyboardEvents)

- Focus a card + scroll to 1237 → press `g` → scrollY 0, no `.knowledge-card.focused` (focus cleared).
- **Typing-guard**: scroll to 1200, open search, type `g` in the input → scrollY stays 1200 (not 0),
  input still focused. Shortcut correctly suppressed while typing.
- Overlay keycaps: `j k g Enter l s / t ? Esc` — `g` present, light render clean.
- `typecheck` exit 0.

Result: **PASS** — keyboard-only jump-to-top, discoverable, typing-safe.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Isolated worktree; ask-AI WIP untouched.
