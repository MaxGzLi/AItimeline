# E2E run — Fix dark-mode chat-bubble contrast (UI loop, iteration 21)

Date: 2026-06-17 · Branch: `ui/x-dark-contrast` (off `origin/main`, incl. iters 1–20)
Source: a focused WCAG contrast audit of the NEW dark theme (iter 20). Computed AA ratios for every
text-on-bg pair; all passed EXCEPT one genuine, user-read failure.

## The defect (real WCAG AA failure, dark-mode regression)

The drawer Ask-AI "You" bubble (`aside.detail-drawer .chat-message.user`) used `var(--blue)`, which
in dark mode is the brightened accent `#4d8bff`. White message text on `#4d8bff` = **3.25:1** —
fails WCAG AA (needs 4.5:1 for this regular-weight ~15px body text users actually read). It's a
regression from iter 20: the same bubble in light mode uses `#2f6df6` (4.53:1, passes).

Audit summary (all other pairs PASS): ink `#e7ecf0`/panel 13.8, secondary `#c4ccd4`/panel 10.1,
muted `#8b98a5`/panel 5.6, blue `#4d8bff`/panel 5.0, green/amber/red on their tinted fills 5–7,
section-label blue/page 5.4. The only other sub-4.5 items are the intentionally-faint decorative
middot `·` separators (2.1) — by design, not body text.

## Change (CSS-only — `apps/web/src/styles.css`, 1 line in the dark block)

`aside.detail-drawer .chat-message.user` dark bg `var(--blue)` → `#3568de`. White on `#3568de` =
**5.02:1** (AA pass), still an unmistakably-blue bubble. Scoped to the bubble selector so `--blue`
and every other blue accent are unchanged; light mode untouched (change is inside the dark
`@media` block). Isolated from the `feat/ask-ai-endpoint` work.

## Verification (real browser render + computed)

- Contrast math computed independently (sRGB WCAG 2.1): `#4d8bff` 3.25 → `#3568de` 5.02.
- `docs/e2e/cdp-shot.mjs` with `DARK=1` + the drawer-ask interaction (opens drawer, submits 2
  questions → 4 chat messages): the user bubble computes `background rgb(53,104,222)` = `#3568de`,
  `color rgb(255,255,255)` — exactly the fix. `dark-chat.png` shows the legible blue "You" bubbles.
- Diff is a 1-line bg change (+ comment) inside the dark block; `--blue` untouched; ask-AI intact.

Result: **PASS** — dark chat bubble now clears AA (3.25 → 5.02), accents/light mode unchanged.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Dark mode now passes AA on all real body
text. CSS-only surface is exhausted; remaining X gains need App.tsx markup (awaiting user greenlight).
