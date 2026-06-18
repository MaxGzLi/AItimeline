# E2E run — "Due Soon" review rows open the post's drawer (UI loop, iteration 38)

Date: 2026-06-17 · Branch: `ui/x-review-open` (off `origin/main`)

## The gap

The right-rail "Due Soon" review-queue rows (concept + due date) had hover styling but were inert
`<div>`s. Each row carries a `cardId` — the specific post due for review — so the natural action is to
**open that post's drawer** (the drawer is the review surface: full card + Ask-AI + review prompts).
Continues #43's "make the decorative-but-inert right rail actually work".

## Safety check first (no dead-ends)

The drawer resolves `selectedCard` from `rankedCards`, while the review queue is built from `allCards`,
so a `cardId` could in principle not resolve. Verified at runtime that **all 4 rows open the correct
drawer**: RAG & Evaluation → the RAG post; AI Agent & Memory → the Agent post (the finer concepts map
to the post that teaches them). No dead clicks.

## The change

`.review-list .review-row` is now a `<button>` whose onClick is `setSelectedCardId(item.cardId)` (opens
the drawer for that post) + a "Open … to review" tooltip. Extended the existing `button.graph-row`
reset to `button.graph-row, button.review-row` so it stays visually identical to the de-boxed hover row
(shared `body .review-row` border/hover/dark styling untouched) and gains a `:focus-visible` ring.

## Verification (real browser — cdp-shot, dispatched clicks)

- All 4 rows are `<button>`; clicking each opens `.detail-drawer` with the right post title
  (RAG/Evaluation → "RAG systems need eval sets…"; AI Agent/Memory → "Agent memory works better…").
- Computed style: cursor pointer, background transparent — no visual change.
- Light + dark crops: "Due Soon" renders identically, dark adapts.
- `typecheck` exit 0; CSS braces balanced (493/493).

Result: **PASS** — the review queue is now actionable (click → open the post to review), no regression.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Isolated worktree; ask-AI WIP untouched.
