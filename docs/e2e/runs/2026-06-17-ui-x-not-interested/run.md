# E2E run — "Not interested" dismisses a post in-place, with Undo (UI loop, iteration 35)

Date: 2026-06-17 · Branch: `ui/x-not-interested` (off `origin/main`)

## The gap

The card action bar had a "Skip post" button that recorded the `skippedQuickly` signal (for ranking/
fatigue) but **left the post fully in the feed** — so the user couldn't actually declutter. On X,
"Not interested" collapses the post to a slim, reversible bar. That directly serves 筛选信息 (help
users filter their feed). No per-card overflow menu existed (MoreHorizontal is only in the right rail).

## The change

`KnowledgeCardView` gains a per-card `dismissed` state. The skip button is retitled **"Not
interested"**; clicking it still calls `onSkip` (records the signal) **and** sets `dismissed`, which
(via a hook-safe early return after the dwell effect) collapses the card to a slim
`.card-dismissed` bar: "Not interested — we'll show fewer posts like this." + an **Undo** button that
restores the full card. CSS for the bar is var/`color-mix` based, so it auto-adapts to dark. Renamed
the two `[title="Skip post"]` hover selectors to `[title="Not interested"]`.

## Verification (real browser — cdp-shot, dispatched clicks)

- Before: card not dismissed, has `.post-main` body, 3 cards.
- Click "Not interested" → `.knowledge-card.dismissed` with `.card-dismissed` bar, text "Not
  interested — we'll show fe…", Undo color `rgb(47,109,246)` (blue), `.post-main` gone (collapsed),
  card stays in place (total still 3).
- Click **Undo** → full card restored (`.post-main` back); the skip button now carries `.negative`
  (the `onSkip` signal persisted — ranking still informed).
- Light + dark crops: slim bar reads cleanly, muted text + blue Undo, border adapts in dark.
- `typecheck` exit 0; CSS braces balanced (491/491).

Result: **PASS** — X-style reversible "Not interested" that declutters the feed while keeping the
ranking signal.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Isolated worktree; ask-AI WIP untouched.
