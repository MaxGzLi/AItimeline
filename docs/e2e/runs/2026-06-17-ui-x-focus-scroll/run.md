# E2E run — Unified X-style keyboard focus ring (UI loop, iteration 15)

Date: 2026-06-17 · Branch: `ui/x-focus-scroll` (off `origin/main`, incl. iters 1–14)
Source: iter-13 fresh panel's adversarially-ranked #3.

## User path

Keyboard user tabs through the app → every button/link shows the SAME blue focus ring
(white inner gap + brand-blue outer) that hugs the control's own shape, instead of the
inconsistent — often invisible — browser default outline. Matches X's clear keyboard focus.

## Scope decision (honest)

The panel's #3 bundled the focus ring with custom `::-webkit-scrollbar` styling. I shipped
**only the focus ring** and **dropped the scrollbar**:
- The scrollbar is unverifiable in this environment: macOS headless Chrome uses overlay
  scrollbars that don't paint a styled `::-webkit-scrollbar` in a static screenshot. I drove a
  one-off capture with overflow forced and `--hide-scrollbars` off, then sampled the right-rail
  gutter pixels — only the rail bg `(245,247,248)` + border, no `#c4cfd8` thumb. Per the loop's
  artifact-per-change rule, I won't ship a change I can't verify here. (It's low-risk standard
  CSS that mainly helps Windows/Linux; can return later with a real-platform check.)
- I also **dropped the proposal's per-group `border-radius` overrides** in the focus rules:
  a box-shadow ring already follows each element's own radius, so setting radius only-on-focus
  was redundant and risked a shape-pop. Verified below that the ring auto-matches each shape.

## Change (CSS-only — `apps/web/src/styles.css`, 1 end-of-file append)

```
button:focus-visible, a:focus-visible, .icon-button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--panel), 0 0 0 4px var(--blue);
}
```
`outline:none` only under `:focus-visible` (native outline stays as a no-CSS fallback). Inputs
excluded (they ring their own shell). Isolated from the in-progress `feat/ask-ai-endpoint` work.

## Verification (real browser render)

- **Focus ring (temp-sim):** a temporary rule applied the ring box-shadow to a pill (topic-pill
  "AI Agent") and a rounded-square (header search `.icon-button`), captured
  (`focus-sim-crop.png`), then removed before commit (grep + diff confirmed no leak). The ring
  follows each element's native radius — pill ring on the capsule, rounded-square ring on the
  icon-button — with **no layout shift** (the adjacent bell icon is unmoved). This proves the
  box-shadow approach works across shapes without the dropped radius overrides.
- **:focus-visible matching** is standard CSS, and the exact ring idiom is already shipped &
  working on `.topic-pill:focus-visible` (iter 7) / `.nav-item:focus-visible` (iter 13).

Result: **PASS** — consistent focus ring confirmed across shapes; no reflow.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Backlog left from iter-13 panel:
empty/loading states (#4) → then a fresh panel.
