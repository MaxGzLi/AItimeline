# E2E run — Escape closes the detail drawer (UI loop, iteration 56)

Date: 2026-06-18 · Branch: `ui/x-drawer-esc` (off `origin/main`) · App.tsx only

## The bug

Opening a knowledge card (click, or the `Enter` keyboard shortcut) opens the `SourceDetailDrawer`
(`role`-less `<aside className="detail-drawer">`; on mobile a full bottom sheet). The global `Escape`
handler only did `setShortcutsOpen(false); setFocusedIndex(-1)` — it never called
`setSelectedCardId(null)`, so **Escape could not close the drawer**. The only way out was clicking the X.
This breaks the X-style open-with-Enter / dismiss-with-Escape scroll flow and the universal
dialog-dismissal expectation (the shortcuts overlay already lists `Esc → Close / clear`).

## The fix (App.tsx only)

Add `setSelectedCardId(null)` to the `Escape` case. Uses only state setters (no state reads), so there's
no stale-closure risk from the handler's effect deps; both setters are no-ops when their layer is already
closed, so unconditionally closing both the overlay and the drawer is safe.

```
case "Escape":
  setShortcutsOpen(false);
  setSelectedCardId(null);   // <-- added: Escape now dismisses the detail drawer
  setFocusedIndex(-1);
  break;
```

## Verification (real browser — cdp-shot, dispatched KeyboardEvents)

- Open drawer via card click → drawer present; dispatch `Escape` → `drawerClosedByEsc: true`,
  `stillOpenAfterEsc: false`.
- Regression: `?` opens shortcuts overlay → `Escape` still closes it (`shortcutsClosedByEsc: true`);
  Escape with nothing open is harmless (`noErrorOnEmptyEsc: true`).
- `typecheck` exit 0.

Result: **PASS** — Escape now dismisses the detail drawer; shortcuts-overlay Escape unaffected.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Isolated worktree; ask-AI WIP untouched.
