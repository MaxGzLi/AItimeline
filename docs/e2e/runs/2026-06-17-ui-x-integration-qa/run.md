# E2E run — Integration QA pass over the 6 new feed features (UI loop, iteration 31)

Date: 2026-06-17 · Branch: `ui/x-integration-qa` (off `origin/main`)
A holistic pass verifying the six greenlit features (tabs #31, search #32, topic #33, keyboard-nav
#34, shortcuts #35, scroll-top #36) compose without conflict. Found and fixed one real bug.

## Bug found + fixed (genuine integration conflict)

The scroll-to-top FAB (`position:fixed` bottom-right, z-40) rendered **on top of the open detail
drawer**. With the drawer open and the page scrolled, `getBoundingClientRect` overlap = true: FAB at
x1364–1412 / y924–972 sits inside the drawer rect x1000–1440 / y0–1000 (and would cover the mobile
bottom-sheet). Fix: gate the FAB on `showScrollTop && !selectedCard` — hide it whenever the drawer is
open. One line in `App.tsx`; no CSS change.

## Verification (real browser — cdp-shot, dispatched events)

- **Bug repro (before)**: drawer open + scrolled → `overlap: true` (rects above).
- **Fix (after)**: `tsc --noEmit` clean; drawer open → `.scroll-top-button` absent
  (`fabHiddenWithDrawer: true`); FAB still shows when scrolled with no drawer; after a drawer
  open/close cycle, re-scrolling past 600 brings the FAB back (`fabAfterReScroll: true`) — not stuck.
- **Filter + keyboard focus compose**: focus card index 2, filter to RAG (1 card) → focus clamps to 0,
  in range (`focusInRange: true`).
- **Three filters compose**: Latest tab + RAG topic + search "eval" → `["RAG Field Notes"]`; adding a
  non-matching query → `.feed-empty` "No posts match …"; clear + switch topic to AI Agent →
  `["Agent Lab"]`. All correct via the single `visibleCards` pipeline.

Result: **PASS** — one real conflict (drawer/FAB overlap) fixed; all six features otherwise compose
cleanly across tab sort, topic concept, search text, keyboard focus, overlays, and the FAB.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Isolated worktree; ask-AI WIP untouched.
