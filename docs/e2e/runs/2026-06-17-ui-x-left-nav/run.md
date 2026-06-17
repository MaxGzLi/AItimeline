# E2E run — Left nav as X-style rounded-pill rows (UI loop, iteration 13)

Date: 2026-06-17 · Branch: `ui/x-left-nav` (off `origin/main`, incl. iters 1–12)
Source: FRESH adversarial design panel (Workflow `ui-iter13-design`, 4 lenses → judge).
Ranked #1 over: rest-of-drawer widget cards (#2), global focus+scrollbar (#3), empty/loading (#4).

## User path

Reader scans the left nav → the current section ("Timeline") reads as a borderless rounded
pill with a bold label, idle rows are clean 19px labels, hovering any row fills a soft grey
pill behind the icon+label, and keyboard-tabbing shows a blue focus ring — i.e. X's primary
nav, instead of the current section looking like a bevelled bordered button.

## Change (CSS-only — `apps/web/src/styles.css`, 2 edits)

`.nav-item` shared the `border-radius:8px; border:1px solid transparent` block with
`.primary-action/.secondary-action/.topic-pill`, so nav rows read as bevelled buttons-in-a-box
— the most un-X thing in the left column. Fix (scoped strictly to `.nav-item`):
- Rewrote `.nav-item` → borderless `border-radius:999px` pill (house vocabulary, used 11×
  already), split the combined active/hover rule into `:hover` (`#eef2f5` fill) and `.active`
  (`#e9eef3` fill) — pure grey fills, no bevel.
- Appended: `.nav-item span` 19px + `-0.01em` tracking (X icon+label rhythm), `.active span`
  bold (weight the current section instead of boxing it), `:focus-visible` blue ring (same
  box-shadow idiom as the shipped `.topic-pill:focus-visible`).

`.primary-action/.secondary-action/.topic-pill/.brand-mark` untouched; the 1100px/820px
icon-collapse media queries keep their explicit width/centering overrides. Isolated from the
in-progress `feat/ask-ai-endpoint` work.

## Verification (real browser render)

Headless system Google Chrome via `docs/e2e/screenshot.mjs` + left-rail crops.
- **Active/idle (static):** `before-nav.png` = "Timeline" as an 8px bevelled bordered box;
  `after-nav.png` = "Timeline" as a borderless rounded pill with a bold label, idle rows clean
  19px borderless labels. Rail width + agent-brief below unaffected.
- **Hover (temp-sim):** a temporary rule applied the hover fill to row 2 ("Explore"), captured
  (`hover-sim-nav.png` → borderless rounded pill with the lighter `#eef2f5` fill), then removed
  before commit (grep + diff confirmed no leak).
- **Focus ring:** CSS-logic-verified — identical `box-shadow` idiom to the already-shipped
  `.topic-pill:focus-visible` (iter 7).

Result: **PASS** — box→pill + bold-active + hover pill confirmed visually; focus ring by precedent.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Next backlog (this panel): rest-of-drawer
widget cards (#2) is a strong follow-up; then global focus/scrollbar (#3), empty/loading (#4).
