# E2E run — X-style feed tabs: For you / Latest (UI loop, iteration 25)

Date: 2026-06-17 · Branch: `ui/x-feed-tabs` (off `origin/main`)
First MARKUP feature after the user greenlit App.tsx work (CSS-only surface had converged at iter 24).
Built in an isolated `git worktree` off origin/main so the uncommitted ask-AI WIP in the main
checkout was never touched (verified untouched afterward).

## Feature — user path

A sticky **"For you" / "Latest"** tab bar under the header lets users switch the feed between the
personalized ranking and newest-first. Serves the loop's core goal: help users *filter info* + the
addictive X-feed affordance. User path: load → "For you" active (ranked) → click "Latest" → same
cards re-sorted newest-first, blue underline moves → click "For you" → back to ranked.

## Change (App.tsx markup + state, styles.css)

- `App.tsx`: `feedTab` state (`"foryou" | "latest"`, default foryou); a `displayedCards` useMemo that
  returns `rankedCards` for "For you" or `[...rankedCards].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))`
  for "Latest"; a `.feed-tabs` tablist (two `role="tab"` buttons with `aria-selected`); feed map
  switched `rankedCards` → `displayedCards`. No change to ranking logic or card markup.
- `styles.css`: `.feed-tabs` (sticky `top:86px` = header height, frosted to match header) + `.feed-tab`
  (flex:1, var(--muted) → active var(--ink), `.active::after` blue underline pill via var(--blue)).
  Dark `@media` block: frost bg `rgba(21,25,30,0.86)` + hover `#222831` (colors use vars → auto-adapt).

## Verification (real browser render — cdp-shot, LIGHT=1 / DARK=1)

- **Typecheck**: `tsc -p tsconfig.json --noEmit` → EXIT 0.
- **Renders**: 2 tabs, "For you" active by default (`firstActive: "feed-tab active"`).
- **Re-sort works (not cosmetic)**: For you order = [RAG Field Notes, Agent Lab, Product Loop]
  (by score); after clicking Latest = [Product Loop, RAG Field Notes, Agent Lab] (by createdAt) —
  a genuinely different order. Active state moved (latest `feed-tab active`, foryou `feed-tab`).
- **Light + dark**: `light-foryou`/`light-latest`/`dark-foryou` tab-bar crops — frosted bar, blue
  underline under the active tab, muted/active text contrast correct in both themes.
- **Sticky**: scrollTop=500 applied (import panel moved up exactly 500px) while header stayed 0–86 and
  tabs stayed 86–139 — `gap:0`, `headerPinned:true`, `tabsPinnedUnderHeader:true`. Flush, no overlap.
  (The full-page `light-scrolled.png` mis-composites sticky els — capture artifact, not a bug; the
  per-element rect measurement is authoritative.)

Result: **PASS** — working, accessible, theme-correct sticky feed tabs that re-sort the feed.

## Delivery

Gated auto-merge: PR → CI `verify` (npm ci → typecheck → build → smoke) → `--auto --squash`. Isolated
worktree removed afterward; main checkout (feat/ask-ai-endpoint WIP) untouched.
