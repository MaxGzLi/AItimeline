# E2E run — Exact-timestamp hover tooltip on post age (UI loop, iteration 43)

Date: 2026-06-18 · Branch: `ui/x-time-tooltip` (off `origin/main`) · App.tsx only

## The gap

The card header compresses the post age to a relative label ("now"/"5m"/"3h"/"2d"/"Jun 8"), which
drops the exact time. X restores it on hover: mousing the timestamp shows the full date/time. That
precise recency aids info-triage (筛选信息) without leaving the feed. The relative-time `<span>` had no
`title`.

## The change

- `formatFullTimestamp(value)` helper: `Intl.DateTimeFormat("en", {dateStyle:"full", timeStyle:"short"})`
  (NaN-guarded).
- The relative-time span now carries `title={formatFullTimestamp(card.createdAt)}`. Kept it a `<span>`
  (not `<time>`) on purpose so the `.post-author-line span + span::before` middot separators stay intact.

## Verification (real browser — cdp-shot)

- Time span `title` = "Monday, June 8, 2026 at 10:30 AM"; visible text still "Jun 8".
- Middot `::before` still renders before the time span AND the "5m read" span (computed content "·") —
  no separator regression.
- Header crop: "RAG Field Notes @rag · Jun 8 · 5m read" — visually unchanged.
- `typecheck` exit 0.

(Native `title` tooltips don't paint in headless Chrome; the attribute value is the authoritative proof.)

Result: **PASS** — hovering a post's age now reveals its exact timestamp; zero visual regression.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Isolated worktree; ask-AI WIP untouched.
