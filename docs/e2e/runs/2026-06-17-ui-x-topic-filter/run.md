# E2E run — One-click topic-chip feed filter (UI loop, iteration 27)

Date: 2026-06-17 · Branch: `ui/x-topic-filter` (off `origin/main`)
Third markup feature (greenlit). Deepens 帮助用户筛选信息 (help users filter info) — the topic chips
were decorative; now they filter the feed by concept, complementing the iter-26 search.
Built in an isolated `git worktree`; the uncommitted ask-AI WIP in the main checkout was untouched.

## Feature — user path

The topic strip now starts with an **All** chip (active by default) followed by the profile
interests. Click a topic → the feed filters to cards whose `concepts` include it, and the chip turns
solid blue; click it again (or click **All**) to clear. Stacks with search and the For-you/Latest
tabs (one filter pipeline). No-match shows "No posts in "…".".

## Change (App.tsx markup + state, styles.css)

- `App.tsx`: `activeTopic` state (`string | null`); folded a concept filter into the existing
  `visibleCards` memo (card kept iff `activeTopic` is null OR `card.concepts` has it, case-insensitive,
  AND it still passes the search query); topic strip prepends an **All** button and gives each chip
  `active`/`aria-pressed` + a toggle `onClick`; empty-state branch extended to `(searchQuery ||
  activeTopic)` with a topic-specific message. No ranking/card-markup change.
- `styles.css`: `.topic-pill.active` = solid blue chip (`var(--blue)` bg + white), placed after the
  existing `:hover`/`:active` rules so it wins the cascade. `var()`-based → auto-adapts to dark.

## Verification (real browser render — cdp-shot, LIGHT=1 / DARK=1)

- **Typecheck**: `tsc -p tsconfig.json --noEmit` → clean.
- **Chips**: `["All","AI Agent","RAG","Product Strategy"]` — All prepended, `active` by default, 3 cards.
- **Filter (real, not cosmetic)**: click **RAG** → 1 card ("RAG Field Notes"); RAG chip `active`, All
  deactivated. (Demo concepts map AI Agent/RAG/Product Strategy → one card each, so 3→1 is a true filter.)
- **Light + dark**: `light-rag` / `dark-rag` crops — selected chip solid blue (auto-adapted in dark),
  others muted; feed shows only the matching card. `light-all` crop — All chip solid blue by default.

Result: **PASS** — working, accessible, theme-correct one-click concept filter that narrows the feed.

## Delivery

Gated auto-merge: PR → CI `verify` (npm ci → typecheck → build → smoke) → `--auto --squash`. Isolated
worktree removed afterward; main checkout (feat/ask-ai-endpoint WIP) untouched.
