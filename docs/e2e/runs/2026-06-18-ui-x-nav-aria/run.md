# E2E run — Accessible names for the collapsed nav buttons (UI loop, iteration 55)

Date: 2026-06-18 · Branch: `ui/x-nav-aria` (off `origin/main`) · App.tsx only

## The bug (a11y / WCAG 4.1.2)

The left-rail nav buttons render `<button><icon/><span>{label}</span></button>`. At BOTH responsive
breakpoints (≤1100px and ≤820px) the CSS does `.nav-item span { display: none }` to collapse the rail to
an icon-only bar. `display:none` removes the text from the accessibility tree, so the buttons had **no
accessible name** — every tablet/mobile screen-reader user heard an unlabeled "button". Confirmed at
390px: span `display:none`, no aria-label, no title → accessible name empty.

## The fix (App.tsx only)

On the nav-item button: `aria-label={item.label}` (stable accessible name at every width) and
`aria-current={item.active ? "page" : undefined}` (marks the active view for assistive tech). No visual
or behaviour change.

## Verification (real browser — cdp-shot)

- Before: @390px accessibleNameEmpty = true.
- After @390px: all six buttons expose aria-label `["Timeline","Explore","Graph","Review","Agents",
  "Settings"]`; active "Timeline" has `aria-current="page"`; span still `display:none` (visual unchanged).
- After @1440px: same aria-labels + aria-current; visible label `display:block` (desktop unaffected;
  label text matches aria-label so no double-announcement).
- `typecheck` exit 0.

Result: **PASS** — nav buttons are now labeled for assistive tech at all breakpoints.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Isolated worktree; ask-AI WIP untouched.
