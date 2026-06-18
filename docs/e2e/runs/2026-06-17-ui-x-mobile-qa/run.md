# E2E run — Mobile (390px) QA across all 16 features (UI loop, iteration 40)

Date: 2026-06-17 · Branch: `ui/x-mobile-qa` (off `origin/main`) · **NO CODE CHANGE — verification only**

## Why

~8 markup features were added since the last mobile check (iter 19): feed tabs (#31), in-header search
(#32), topic strip filter (#33), dismissed "Not interested" bar (#41), relative-time header (#42), rail
search/review buttons (#43/#44), the theme toggle button (#40). Each adds header/feed elements that
could break the narrow (≤820px single-column) layout. Verified 390px in light + dark.

## Result — PASS (no defect, nothing to ship)

- **No horizontal overflow**: viewport 390, `document.scrollWidth` 390 in every state checked.
  (The only element extending past 390 is a `.topic-pill` inside the horizontal-scroll topic strip —
  expected; the page itself does not overflow.)
- **Header fits**: brand + "Knowledge Timeline" + the 3 icons (Search · theme toggle · Bell) sit
  comfortably; theme toggle shows Moon in light / Sun in dark.
- **Collapsed nav**: left rail becomes the horizontal top icon bar (AI · Home · Explore · Graph ·
  Memory · Bot · Settings).
- **Feed chrome**: "For you / Latest" tabs (active blue underline) + horizontally-scrollable topic
  strip (All/AI Agent/RAG/Product Strategy) render full-width and clean.
- **Card header**: `RAG Field Notes @rag · Jun 8 · 5m read` — the relative time + middots render on
  mobile.
- **Interaction states**: expanding a thread (3 un-clamped replies) keeps page scrollWidth 390;
  dismissing a card → "Not interested" bar right edge 366px (in bounds) with Undo visible.
- Both light and dark themes verified (`mobile-light.png` / `mobile-dark.png` + `-top` crops).

Conclusion: the mobile/responsive layout absorbs all 16 features cleanly — **no fix needed**, so no
code change was made (holding the no-manufactured-diff rule). This commit is the verification record.

## Delivery

Docs-only PR (no `src` change) → CI `verify` → `--auto --squash`. Isolated worktree; ask-AI WIP untouched.
