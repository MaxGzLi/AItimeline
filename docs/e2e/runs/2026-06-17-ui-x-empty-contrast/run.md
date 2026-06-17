# E2E run — Fix light-mode empty-state contrast (UI loop, iteration 23)

Date: 2026-06-17 · Branch: `ui/x-empty-contrast` (off `origin/main`, incl. iters 1–22)
Source: a LIGHT-mode WCAG AA contrast audit (parallel to iter 21's dark audit — never done for
light). Audited every text/bg pair; one genuine failure, the rest pass (only decorative middot/dot
separators are sub-threshold, by design).

## The defect (genuine AA failure, self-inflicted in iter 16)

`.empty-state` copy ("No imports yet" / "No candidates yet" — real text, renders on default load in
the right-rail cards) is `#8896a2`, set by iter 16's de-box. On the rail card bg `#f7f9fb` that is
only **2.9:1** — fails WCAG AA (needs 4.5 for this ~13.5px readable copy). It also fails on every
other surface it lands on (white 3.0, rail 3.0, page 2.8).

Audit summary (all other pairs PASS): `--muted #62707c` 4.7–5.1 everywhere, `.summary #3f4f5d` 8.4,
`#334454` 10.0, accents on tinted fills (green/amber/red/blue) 4.5–5.1, section-label blue on white
4.5. The only other sub-4.5 items are the decorative middot `·` / state-dot `::before` glyphs
(non-text, AA-exempt) and a 3.0 UI icon (passes its 3.0 threshold).

## Change (CSS-only — `apps/web/src/styles.css`, 1 color)

`body .empty-state` color `#8896a2` → `#62707c` (the existing `--muted` token). On `#f7f9fb` =
**4.8:1** (AA pass; 4.7–5.1 on every surface). Reuses a palette value already used by the rest of
the rail copy, so it's tonally consistent. Dark mode is unaffected — its block overrides
`body .empty-state` to `#8b98a5` (5.6:1, already passing). Isolated from `feat/ask-ai-endpoint`.

## Verification (real browser render — LIGHT emulation, since Chrome now defaults to dark)

`docs/e2e/cdp-shot.mjs` with `LIGHT=1` (the new flag) so the default light theme renders:
- Computed `.empty-state` color = `rgb(98,112,124)` = `#62707c` (fix applied).
- `before-rail.png` vs `after-rail.png`: "No candidates yet" / "No imports yet" render in a darker,
  clearly more legible grey, tonally matching the surrounding rail copy; layout unchanged.
- Contrast computed independently: `#8896a2` 2.9 → `#62707c` 4.8 on the `#f7f9fb` card.
- Diff is a 1-color change (+ comment); dark override intact; ask-AI untouched.

Result: **PASS** — light-mode empty-state copy now clears AA (2.9 → 4.8); dark mode unchanged.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Both themes now pass AA on real body/label
text. CSS-only surface remains exhausted; bigger X gains need App.tsx markup (awaiting greenlight).
