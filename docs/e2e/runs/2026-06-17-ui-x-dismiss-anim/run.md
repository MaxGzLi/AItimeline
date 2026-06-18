# E2E run — Ease the "Not interested" dismiss bar in (UI loop, iteration 41)

Date: 2026-06-17 · Branch: `ui/x-dismiss-anim` (off `origin/main`) · CSS-only

## What & why

The "Not interested" dismiss (#41) swapped the post for the slim Undo bar **instantly** — a hard snap.
X eases that transition. Small polish: the `.card-dismissed` bar now fades + slides in
(`@keyframes dismiss-in`: opacity 0→1, translateY(-6px)→0, 220ms ease), reduced-motion guarded.
CSS-only; no behaviour or markup change.

## Verification (real browser — cdp-shot)

- Mid-dismiss: bar `animation-name: dismiss-in`, `animation-duration: 0.22s`.
- After settle: `opacity 1`, `transform: none` (lands cleanly at final state).
- Undo still restores the full card (`.post-main` returns).
- Settled bar crop: "Not interested — we'll show fewer posts like this." + Undo, unchanged from #41.
- CSS braces balanced (498/498).

Result: **PASS** — modest, real smoothing of the dismiss interaction; no regression.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Isolated worktree; ask-AI WIP untouched.
