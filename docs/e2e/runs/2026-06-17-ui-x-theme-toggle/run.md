# E2E run — User-controlled dark/light theme toggle (UI loop, iteration 34)

Date: 2026-06-17 · Branch: `ui/x-theme-toggle` (off `origin/main`)

## What & why

Dark mode existed but was **system-only** (`@media (prefers-color-scheme: dark)`) — no way to
override it. X has an explicit theme switch. Added a header **sun/moon toggle** that forces light or
dark over the OS setting and remembers the choice (localStorage), with no flash on load.

## How (the careful part)

The ~500-line dark block was driven by a media query, so a user could never force light over a dark
OS. Converted the trigger to a JS-resolved `[data-theme]` attribute:
- **CSS:** wrapped the whole dark block in `:root[data-theme="dark"] { … }` via CSS nesting — one
  edit instead of prefixing ~70 selectors by hand. **esbuild flattens the nesting at build** into
  standard flat selectors (`:root[data-theme=dark] body, :root[data-theme=dark] .left-rail, …`, 198
  rules), so the shipped CSS has zero nesting/runtime dependency and works in every browser.
- **index.html:** a tiny synchronous head script resolves the theme before first paint (localStorage,
  defaulting to `prefers-color-scheme`) and sets `data-theme` on `<html>` → no flash.
- **App.tsx:** `theme` state (seeded from the attribute the head script set), an effect that writes
  `data-theme` + localStorage on change, and a Sun/Moon `icon-button` in `.header-actions`.

## Verification (real browser — cdp-shot, computed bg + dispatched click)

| start | initial | after toggle |
|-------|---------|--------------|
| **LIGHT system** | `data-theme=light`, bg rgb(245,247,248), Moon icon | `data-theme=dark`, bg **rgb(21,25,30)**, localStorage=dark |
| **DARK system**  | `data-theme=dark`, bg rgb(21,25,30), Sun icon | `data-theme=light`, bg **rgb(245,247,248)**, localStorage=light |

- Default still follows the OS (light→light, dark→dark).
- Toggle forces the opposite and persists. **Force-light over a dark OS works** (DARK row, after
  toggle → light bg) — the hard case the media query couldn't do.
- Header crops: light shows Moon, dark shows Sun, between Search & Bell, both themes render cleanly.
- `typecheck` exit 0; `build` succeeds (49.5 kB css). No-flash head script runs pre-paint.

Result: **PASS** — explicit, persisted, no-flash theme switch; dark CSS rescoped with zero behaviour
change for system-default users.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Isolated worktree; ask-AI WIP untouched.
