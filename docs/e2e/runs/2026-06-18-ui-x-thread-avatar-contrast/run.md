# E2E run — Thread reply-avatar initials to AA contrast, both themes (UI loop, iteration 68)

Date: 2026-06-18 · Branch: `ui/x-thread-avatar-contrast` (off `origin/main`) · styles.css only

## The bug (WCAG 1.4.3 — Contrast Minimum, both themes)

The thread-reply avatar chips (`.reply-avatar`) show the kind initials (2 letters, 10px = small text →
needs 4.5:1). Measured on the real feed (cdp-shot, computed getComputedStyle + WCAG relative-luminance):
- LIGHT: `#2f6df6` (var(--blue)) on pale-blue chip `#edf3ff` = **4.07:1** — FAIL.
- DARK: `#4d8bff` on shared accent chip `#1c2a44` = **4.41:1** — FAIL.
The pale/accent chip background drags the blue initials below AA (the adjacent full kind-label, on the
card bg, passes at 4.53/5.04). Found by measuring the rendered thread — the iter-61 "measure, don't
assume" lesson.

## The fix (styles.css only, surgical — shared accent group untouched)

- LIGHT (`.reply-avatar`, line ~941): initials `var(--blue)` → `#2862d8` (darker blue). Chip color only.
- DARK (dedicated `.reply-avatar` rule added AFTER the shared `#1c2a44` accent group inside the
  `:root[data-theme="dark"]` wrapper): `background: #15203a` (darker chip; keeps `#4d8bff` initials so
  they still match the adjacent kind-label). The shared group (`.icon-button.selected`,
  `.candidate-row strong`, etc.) is NOT modified.

## Verification (real browser — cdp-shot, before → after)

| element            | light before | light after | dark before | dark after |
|--------------------|--------------|-------------|-------------|------------|
| reply-avatar       | 4.07 ✗       | **4.93 ✓**  | 4.41 ✗      | **4.97 ✓** |
| kind-label (span)  | 4.53 ✓       | 4.53 ✓      | 5.04 ✓      | 5.04 ✓     |
| title (strong)     | 16.26 ✓      | 16.26 ✓     | 13.78 ✓     | 13.78 ✓    |
| body (p)           | 8.44 ✓       | 8.44 ✓      | 10.10 ✓     | 10.10 ✓    |

Both avatar chips now clear AA (≥4.5); nothing else shifted. Visual (thread-dark-after.png): chips still
render as proper blue chips with legible initials; connector lines + threaded layout intact.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Isolated worktree; ask-AI WIP untouched.
