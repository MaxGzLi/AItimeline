# E2E run — Detail drawer: dialog semantics + focus management (UI loop, iteration 57)

Date: 2026-06-18 · Branch: `ui/x-drawer-focus` (off `origin/main`) · App.tsx only

## The gap

`SourceDetailDrawer` rendered a bare `<aside className="detail-drawer" aria-label="Source detail">` —
no `role="dialog"`, no `aria-modal`, and no focus management. Opening a card (a modal panel on desktop,
a full bottom sheet on mobile) left keyboard focus and the screen-reader cursor behind the drawer; on
close, focus was lost. The sibling shortcuts overlay already had `role="dialog"` + `aria-modal` — the
drawer didn't. This is the natural completion of iter 56 (Escape-to-close).

## The fix (App.tsx only, in SourceDetailDrawer)

- `role="dialog"`, `aria-modal="true"`, `tabIndex={-1}` on the drawer `<aside>` (keeps existing
  `aria-label="Source detail"` as the accessible name).
- A self-contained mount effect: capture `document.activeElement` (the opener), focus the drawer, and on
  unmount return focus to the opener if it's still in the DOM. No focus-trap library; ~10 lines.

## Verification (real browser — cdp-shot, dispatched events)

- Open via card click: `role=dialog`, `aria-modal=true`; focus moved into the drawer
  (`focusInDrawer: true`, activeElement = `.detail-drawer`).
- Return-focus (opener explicitly focused first, mirroring a real mouse click — note: programmatic
  `.click()` does NOT focus a button, so the first naive test reported false; with the opener focused the
  mechanism works): closing via the X button → focus returns to opener (`closeBtnReturnFocus: true`);
  closing via Escape → focus returns to opener (`escapeReturnFocus: true`).
- No stray focus ring: computed `outline-style: none` on the focused container; drawer crop renders clean.
- `typecheck` exit 0.

Result: **PASS** — the drawer is now a proper dialog; focus enters on open and returns on close.

Note (graceful degradation): when a card is opened via the `Enter` keyboard shortcut the card isn't
DOM-focused (keyboard nav uses a focusedIndex state, not DOM focus), so the opener is `body` and
return-focus is a harmless no-op. Mouse/real-focus opens return correctly.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Isolated worktree; ask-AI WIP untouched.
