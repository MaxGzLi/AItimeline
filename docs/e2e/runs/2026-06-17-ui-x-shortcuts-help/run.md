# E2E run — "?" keyboard-shortcuts help overlay (UI loop, iteration 29)

Date: 2026-06-17 · Branch: `ui/x-shortcuts-help` (off `origin/main`)
Fifth markup feature (greenlit). Makes the iter-28 keyboard nav discoverable — X has the same "?"
shortcuts modal. Built in an isolated `git worktree`; the uncommitted ask-AI WIP was untouched.

## Feature — user path

Press **?** anywhere (not while typing) → a centered modal lists every shortcut (j / k / Enter / "/" /
? / Esc) with keycaps. Press **?** again, **Esc**, the **×** button, or click the backdrop to close.

## Change (App.tsx state + keydown + overlay markup, styles.css)

- `App.tsx`: `shortcutsOpen` state; keydown handler gains `case "?"` (toggle) and Escape now also
  closes the overlay; the overlay (`role="dialog"`, `aria-modal`) renders after the detail drawer —
  backdrop `onClick` closes, modal `stopPropagation`, `XCircle` close button, a `<ul>` of `<kbd>` +
  label rows. The "?" key (Shift+/) isn't blocked by the existing modifier guard (only meta/ctrl/alt
  are), and the typing-guard still suppresses it inside inputs.
- `styles.css`: `.shortcuts-overlay` (fixed scrim, grid-center, z-index 50 > drawer's 10),
  `.shortcuts-modal` (`var(--panel)`/`var(--border)`), `.shortcuts-list`/`kbd`. All `var()`-based plus
  a translucent `rgba(128,128,128,.12)` keycap fill, so it adapts to dark with NO override block.

## Verification (real browser render — cdp-shot, LIGHT=1 / DARK=1)

- **Typecheck**: `tsc -p tsconfig.json --noEmit` → clean.
- **Functional** (dispatched real KeyboardEvents): `?` → overlay present, `role="dialog"`; keycaps =
  `["j","k","Enter","/","?","Esc"]`; labels = `["Next post","Previous post","Open thread","Search",
  "Toggle this menu","Close / clear"]`; `?` again → closed (toggle); reopen + `Esc` → closed.
- **Light + dark**: `light-shortcuts-modal` / `dark-shortcuts-modal` crops — rounded panel, heading,
  × button, keycap + row; dark panel auto-adapted via vars; scrim dims the page behind.

Result: **PASS** — working, accessible, theme-correct shortcuts overlay that documents the nav.

## Delivery

Gated auto-merge: PR → CI `verify` (npm ci → typecheck → build → smoke) → `--auto --squash`. Isolated
worktree removed afterward; main checkout (feat/ask-ai-endpoint WIP) untouched.
