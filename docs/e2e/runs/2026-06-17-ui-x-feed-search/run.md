# E2E run — Header search that filters the feed (UI loop, iteration 26)

Date: 2026-06-17 · Branch: `ui/x-feed-search` (off `origin/main`)
Second markup feature (greenlit). Directly serves the loop's core goal — 帮助用户筛选信息 (help
users filter info). The header Search icon was inert; now it filters the feed in place.
Built in an isolated `git worktree`; the uncommitted ask-AI WIP in the main checkout was untouched.

## Feature — user path

Click the header **Search** icon → the title swaps to a rounded search pill (autofocused) → type a
query → the feed filters live to cards whose title/summary/keyTakeaway/hook/thesis/concepts match →
no matches shows "No posts match "…"." → clear (×) or toggle the icon to restore the full feed.
Filters whatever feed tab (For you / Latest) is active.

## Change (App.tsx markup + state, styles.css)

- `App.tsx`: `searchOpen` + `searchQuery` state; a `visibleCards` useMemo that filters
  `displayedCards` by a lowercased haystack (title, summary, keyTakeaway, hook, thesis, shortBody,
  concepts); the header conditionally renders a `.header-search` input (autofocus, `XCircle` clear)
  in place of the title when open; the Search icon toggles it (and clears on close) + shows
  `selected`; feed map `displayedCards` → `visibleCards` with a `.feed-empty` no-match branch.
  Putting the input INSIDE the header keeps the header exactly 86px so the iter-25 sticky-tab offset
  is unchanged. No ranking/card-markup change.
- `styles.css`: `.header-search` pill + `input` + `.header-search-clear` + `.feed-empty`. All colors
  are `var(--panel/border/ink/muted/blue)` — the dark block redefines those vars, so the search
  auto-adapts to dark with ZERO extra dark rules.

## Verification (real browser render — cdp-shot, LIGHT=1 / DARK=1)

- **Typecheck**: `tsc -p tsconfig.json --noEmit` → clean.
- **Toggle + autofocus**: clicking Search opens the pill, `document.activeElement === input` (true),
  and `headerH` stays **86** (sticky tabs offset preserved).
- **Live filter (real, not cosmetic)**: 3 cards → query "memory" → 1 match (the agent-memory card).
- **Empty state**: query "zzzqqq" → 0 cards, `.feed-empty` shown, text `No posts match "zzzqqq".`.
- **Light + dark**: `light-search-memory-hdr` / `dark-search-hdr` crops — rounded pill, search glyph,
  blue focus ring, clear button; dark fill auto-adapted via vars. `light-search-empty.png` shows the
  centered empty message with the Search icon active.

Result: **PASS** — working, accessible, theme-correct in-feed search that narrows the timeline.

## Delivery

Gated auto-merge: PR → CI `verify` (npm ci → typecheck → build → smoke) → `--auto --squash`. Isolated
worktree removed afterward; main checkout (feat/ask-ai-endpoint WIP) untouched.
