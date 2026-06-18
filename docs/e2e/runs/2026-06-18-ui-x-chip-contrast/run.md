# E2E run — Lift the rest of the blue-chip family to AA contrast (UI loop, iteration 69)

Date: 2026-06-18 · Branch: `ui/x-chip-contrast` (off `origin/main`) · styles.css only

## The bug (WCAG 1.4.3 — systemic, both themes)

Iteration 68 fixed the thread reply-avatar, but the SAME blue-chip pattern (12px `var(--blue)` glyph/label
on `#edf3ff` light / shared `#1c2a44` dark) is reused by four sibling chips, all sub-AA:
- `.candidate-row strong` — candidate relevance score (Candidates panel)
- `.graph-row strong` — concept count badge (Saved Concepts panel)
- `.inline-next-actions strong` — inline next-action chip
- `.next-action-list span` — next-action label (card drawer)

Measured in-context (cdp-shot): `.graph-row strong` (renders in the default Saved Concepts panel) =
**light 4.07:1 / dark 4.41:1** — same fail as the avatar. The other three are not in the default offline
view (need API records / an open drawer) but share byte-identical color/bg declarations → identical
contrast by construction. No status-variant rule overrides their color (grep-confirmed).

## The fix (styles.css only, systemic + surgical)

- DARK: the shared accent group (`.icon-button.selected, .candidate-row strong, .graph-row strong,
  .next-action-list span`) background `#1c2a44` → `#15203a` (one edit fixes all the text chips; matches
  the reply-avatar chip). `.icon-button.selected` is an icon (3:1 bar) so it only improves (4.41 → 4.97).
- LIGHT: the four chip rules' initials `var(--blue)` → `#2862d8` (darker blue), same as the avatar.
- `.inline-next-actions strong` sits in the same dark group via `.candidate-row strong` sibling list /
  its own group entry; light rule patched directly.

## Verification (real browser — cdp-shot, before → after)

| element (representative `.graph-row strong`) | light before | light after | dark before | dark after |
|----------------------------------------------|--------------|-------------|-------------|------------|
| chip initials/label                          | 4.07 ✗       | **4.93 ✓**  | 4.41 ✗      | **4.97 ✓** |

- Generic `.icon-button.selected` (icon): 4.41 → 4.97 (≥3:1, no regression).
- Feed card-action selected state (red filled heart) uses its own action-color override — NOT touched.
- Visual (chips-dark-after.png): Saved Concepts number badges render as proper blue chips; no breakage.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Isolated worktree; ask-AI WIP untouched.
