# E2E run — Right-rail "Saved Concepts" rows search the feed (UI loop, iteration 37)

Date: 2026-06-17 · Branch: `ui/x-rail-search` (off `origin/main`)

## The gap

The right-rail "Saved Concepts" rows already had full-row hover styling (looked interactive) but were
inert `<div>`s. On X, the right-rail trends are clickable → they run a search. Wiring these to the
existing feed search (#32) connects the rail to the feed and serves 筛选信息 — with zero new filter
logic. First confirmed it's safe: every node label returns ≥1 result when searched
(Evaluation→2, RAG→1, Vector Search→1, AI Agent→1, Memory→1, Product Strategy→1) — no dead-ends.

## The change

`.graph-list .graph-row` is now a `<button>` whose onClick opens search and sets the query to
`node.label` (`setSearchOpen(true); setSearchQuery(node.label)`). CSS adds a `button.graph-row` reset
(width:100%, font/color inherit, text-align left, pointer, appearance:none) so it looks identical to
the de-boxed hover row — the existing flex/hover/dark styling is untouched. Also gives the rows a real
`:focus-visible` ring (shared button rule) and a "Search …" tooltip.

## Verification (real browser — cdp-shot, dispatched clicks)

- All 6 rows are `<button>`; click "RAG" → search opens, input "RAG", feed → 1 card; click
  "Evaluation" → input "Evaluation", feed → 2 cards.
- Computed style: row width 269px (full), background transparent, cursor pointer — no visual change.
- Light + dark crops: "Saved Concepts" list renders identically to before, dark adapts.
- `typecheck` exit 0; CSS braces balanced (493/493).

Result: **PASS** — the right rail is now a working discovery surface (click a concept → searched feed),
with no visual regression.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Isolated worktree; ask-AI WIP untouched.
