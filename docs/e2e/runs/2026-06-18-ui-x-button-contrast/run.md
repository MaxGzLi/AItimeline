# E2E run — Fix dark-mode primary-button contrast (UI loop, iteration 62)

Date: 2026-06-18 · Branch: `ui/x-button-contrast` (off `origin/main`) · styles.css only

## The bug (found by a dark-mode contrast sweep of colored elements)

In dark mode, `--blue` is the brightened accent `#4d8bff`, and `.primary-action` buttons
(`Run Scout`, `Import`, `Queue`, the source/candidate submit buttons) take `background: var(--blue)` with
white text → **3.25:1**, failing WCAG AA (16px/800 is still "normal" text; AA needs 4.5). The dark-block
`.primary-action` rule only set `color:#fff`, never fixing the background. This is the SAME `#4d8bff`/white
= 3.25:1 problem the iter-21 comment documented and fixed for the chat bubble (`#3568de`) — it just was
never propagated to the buttons. Light mode is fine (white on `#2f6df6` = 4.53).

## The fix (styles.css only)

Give the dark `.primary-action` resting state `background:#3568de` (the established AA-passing dark blue;
white text = 5.02:1). One rule; fixes every dark primary button's resting state. Light unchanged.

## Verification (real browser — cdp-shot, WCAG calc)

- DARK: Run Scout / Import / Queue all `bg rgb(53,104,222)` (#3568de), contrast **5.02:1** (was 3.25).
- LIGHT: unchanged — `bg rgb(47,109,246)`, **4.53:1** (still passes).
- Crop shows the dark "Run Scout" button: crisp white text on the blue. `typecheck` exit 0.

Result: **PASS** — dark primary buttons are now AA-readable.

Note (left as-is, surgical): the `.agent-brief .primary-action:hover` (#3a78f0 ≈ 4.10:1) is a transient,
pre-existing, single-button hover state — not introduced here and far better than the 3.25 resting bug
just fixed; out of scope for this resting-state fix.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Isolated worktree; ask-AI WIP untouched.
