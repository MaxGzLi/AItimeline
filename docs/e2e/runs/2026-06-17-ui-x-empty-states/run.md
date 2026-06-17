# E2E run — Calm X-style empty states (UI loop, iteration 16)

Date: 2026-06-17 · Branch: `ui/x-empty-states` (off `origin/main`, incl. iters 1–15)
Source: iter-13 fresh panel's adversarially-ranked #4 (last of that backlog; impact: low/honest).

## User path

On first load (no imports, no candidates) the user looks at the right-rail Candidates and
Imports cards → "No candidates yet" / "No imports yet" read as centered, breathing muted copy
(a deliberate X-style "nothing here yet" rest state) instead of cramped left-aligned text in a
dashed "fill me in" outline box that looked like leftover scaffolding next to the de-boxed rows.

## Change (CSS-only — `apps/web/src/styles.css`, 1 end-of-file append)

`body .empty-state` override (additive, edits no existing rule): drop the `1px dashed #cbd7df`
border, center the copy (`display:grid; place-items:center; text-align:center`), grow to
`min-height:72px` + `20px 14px` padding for breathing room, softer `#8896a2` / 13.5px / 600 voice.
Brings the empty slots in line with the de-boxed list rows above them (iters 9/14).

Markup unchanged; isolated from the in-progress `feat/ask-ai-endpoint` work.

## Verification (real browser render)

Both targets render on default load (sourceImports/sourceCandidates init `[]`), so this is
statically screenshot-verifiable with no interaction — `docs/e2e/screenshot.mjs` + right-rail crop.
- `before-rail.png`: "No candidates yet" / "No imports yet" as left-aligned text in dashed
  rounded boxes.
- `after-rail.png`: same copy centered, borderless, with vertical breathing room — calm rest state.
- Right rail layout otherwise unchanged; feed unaffected (`.empty-state`-scoped).

Result: **PASS** — de-boxed centered empty states confirmed visually.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. This exhausts the iter-13 panel backlog
→ iter 17 runs a FRESH design panel.

## Note on trajectory

This was the iter-13 panel's lowest-ranked item (honest impact: low). After 16 iterations the
high-value CSS-only surface is largely covered; the biggest remaining X moves (For-you/Following
tabs, new-posts pill, inline composer) need `App.tsx` markup, which the loop keeps hands-off to
protect the uncommitted ask-AI work. Flagged to the user; awaiting a go-ahead to touch markup.
