# E2E run — Metadata declutter: quiet inline X-style metadata (UI loop, iteration 8)

Date: 2026-06-17 · Branch: `ui/x-declutter` (off `origin/main`, incl. iters 1–7)
Source: iter-6 fresh panel's adversarially-ranked #3 (last of that backlog).

## User path

Reader reaches the bottom of a post → the recommendation reasons, concept tags, and
"For you: …" context read as one quiet line of muted, middot-separated metadata instead
of three rows of bordered chips, so the post's actual content (agent take, thread) breathes
and the feed feels lighter to scroll.

## Change (CSS-only — `apps/web/src/styles.css`, 1 end-of-file append)

`body`-scoped overrides (edits no existing rule, trivially reversible):
- `.recommendation-reasons` / `.concept-list` chips → borderless muted inline tokens,
  `·`-separated via `span + span::before`; concepts keep a faint blue tint.
- `.post-social-context` → relaxed weight + same middot rhythm.
- `.feedback-strip` → de-boxed quiet status line with a leading state dot
  (`.interested/.confused/.fatigued/.needs_review` color the dot; neutral fallback).
  Scoped to `.feedback-strip`, never `.feedback-panel` (which shares variant classes).

Markup unchanged; isolated from the in-progress `feat/ask-ai-endpoint` work.

## Verification (real browser render)

Headless system Google Chrome via `docs/e2e/screenshot.mjs` + 1.4× before/after crops of
card 1's metadata band (`before-meta-zoom.png` / `after-meta-zoom.png`).
- **Auto-verified:** before = boxed "Matches interests" / "RAG · Evaluation · Vector Search"
  chips; after = the same content as muted (reasons) / faint-blue (concepts) inline tokens
  with `·` separators, plus the social-context middot rhythm. No boxes, no data loss, 3-column
  layout intact.
- **Not in a fresh shot (CSS-logic-verified):** `.feedback-strip` only renders after the user
  interacts (like/save/ask), so its de-boxed status-line + state-dot is reasoned, not captured.

Result: **PASS** — reasons/concepts/social-context declutter confirmed visually.

## Delivery

Gated auto-merge: PR → CI `verify` (typecheck + build + smoke) → `--auto --squash`.
This exhausts the iter-6 panel backlog → iter 9 runs a FRESH design panel.
