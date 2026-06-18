# E2E run — Fix low-contrast user chat bubble (UI loop, iteration 61)

Date: 2026-06-18 · Branch: `ui/x-user-bubble-contrast` (off `origin/main`) · styles.css only

## The bug (found by dark-mode contrast QA of the API-connected drawer)

The Ask-AI "You" bubble (blue background) is supposed to have white body text — the dark-mode
`.chat-message.user` rule even carries an iter-21 comment that picked `#3568de` specifically so "white
text" hits 5.02:1 AA. But the message body `<p>` was being repainted by `.drawer-section p`
(`color:#354656` light / `#c4ccd4` dark, line 1945 / 3237) — which directly matches the `<p>` and beats
the inherited white. Result (measured, 16px/400 normal text, AA needs 4.5):
- **Light**: slate `#354656` on blue → **2.14:1** (fail)
- **Dark**: light-gray `#c4ccd4` on blue → **3.09:1** (fail)

So the documented white-text intent was silently defeated, and the user's own messages were hard to read.

## The fix (styles.css only)

1. `aside.detail-drawer .chat-message.user p { color:#ffffff }` — higher specificity (0,3,2) than
   `.drawer-section p` (0,1,1) and its dark twin (0,3,1), so the body text stays white in both themes.
2. Light user-bubble background `var(--blue)` (#2f6df6) → `#3568de` — white text on `var(--blue)` is only
   4.48:1; `#3568de` gives 5.02:1 and matches the dark-mode bubble (one consistent AA-passing blue).

## Verification (real browser + real API — cdp-shot, WCAG calc)

- LIGHT: user `<p>` color `rgb(255,255,255)` on `rgb(53,104,222)` → **5.02:1** (was 2.14).
- DARK:  user `<p>` color `rgb(255,255,255)` on `rgb(53,104,222)` → **5.02:1** (was 3.09).
- "You" label span also 5.02:1 in both. Crops (light + dark) show crisp white text on the blue bubble.
- AI bubble unchanged (already 9.64:1). `typecheck` exit 0.

Result: **PASS** — user message text is now AA-readable and consistent across themes.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Isolated worktree; ask-AI WIP untouched.
