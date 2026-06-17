# E2E run — System-preference dark mode (UI loop, iteration 20)

Date: 2026-06-17 · Branch: `ui/x-darkmode` (off `origin/main`, incl. iters 1–19)
The biggest remaining CSS-only X feature (X is dark-first). Pivoted here after the strict iter-19
panel confirmed the small-polish surface is at the floor.

## What shipped

A `@media (prefers-color-scheme: dark)` theme — the app now honors the user's OS dark/light
setting. **Additive only**: one media block appended at end of `apps/web/src/styles.css`; it edits
no existing rule, so **light mode is byte-for-byte unchanged** (zero light-mode risk).

Approach (colors were ~70 distinct hardcoded hex, mostly un-centralized — audited first):
1. Redefine the `:root` variables for dark (instantly recolors all ~129 `var()` usages):
   page `#15191e`, panel `#1b2026`, raised `#222831`, border `#2b333c`, ink `#e7ecf0`,
   muted `#8b98a5`, brightened accents (blue `#4d8bff`, green/amber/red lightened).
2. Group-override every hardcoded-hex / rgba surface by ROLE so no light patch remains:
   page/rail bg, panel/card bg, raised tints, avatars (distinct raised + retuned gradient),
   frosted header `rgba`, borders, dark inks → light text, muted text, blue/green/amber/red/indigo
   tinted state fills, action-bar hover halos, focus-ring inner color, the agent-brief CTA gradient.

## Verification (real browser render — CDP w/ media emulation)

Added `DARK=1` / `LIGHT=1` to `docs/e2e/cdp-shot.mjs` (`Emulation.setEmulatedMedia`
prefers-color-scheme) — NOTE this headless Chrome **defaults to dark**, so light must be emulated
explicitly. Scanned every surface for light patches:
- `dark-full.png` + zoom crops (`z-top`, `z-card`, `z-rail`): feed, header, source-import,
  cards/callouts/example/footer, right-rail widget cards — all cohesive dark, legible.
- `dark-drawer.png` + `z-drawer-top/bot`: drawer sections (Citation, Evidence Ledger, Takeaway,
  Thread, Context, Source Chunks, Graph Edges, Review, Feedback) — all dark, no light patches.
- **Found + fixed** the one real light patch: `.auto-scout-toggle` / `.candidate-row` /
  `.memory-status` use a *hardcoded* `#dce3e8` border (not `var(--border)`), so their outlines
  stayed light — added an explicit dark border override. `z-rail2.png` confirms the fix.
- `light-verify.png` (`LIGHT=1`): original light theme **fully intact** — confirms the dark block
  is correctly gated and light-preference users are unaffected.

Diff is append-only (`git diff` shows no removed/modified existing lines); braces balanced;
ask-AI work untouched.

Result: **PASS** — complete, cohesive dark theme across feed/rails/drawer; light mode unchanged.

## Delivery

Gated auto-merge: PR → CI `verify` (CSS-only, unaffected) → `--auto --squash`. Dark mode follows
the OS setting automatically; a future in-app toggle would need App.tsx markup (state + button).
