# E2E run — Inline thread expansion in the feed (UI loop, iteration 33)

Date: 2026-06-17 · Branch: `ui/x-inline-thread` (off `origin/main`)

## The gap

Each demo card carries **3 thread replies** (`card.thread`), but the feed showed only **1**
(`getTimelineThreadPreview` → `.slice(0, 1)`); the "Open thread" button just opened the **drawer**, so
reading replies 2–3 forced you out of the scroll. That undercuts two core goals — "以thread的形式"
(present as threads) and "刷着上瘾" (addictive scrolling). X lets you expand a thread in place.

## The change

`KnowledgeCardView` (App.tsx) gains a per-card `threadExpanded` state. Collapsed shows the 1-line
preview; the count button becomes a **chevron toggle** ("Show this thread · N replies" ⇄ "Show less",
`aria-expanded`) that reveals the **full thread inline** (`visibleThread = expanded ? card.thread :
preview`). Cards with no extra replies keep the original "Open thread" drawer button. CSS: `.thread-
chevron` rotates 180° when open; `.social-thread-preview.expanded` un-clamps the reply title/body
(`-webkit-line-clamp: unset`) so the thread is fully readable in-feed; reduced-motion guard on the
chevron. The drawer is still one click away (any reply block, or Ask AI / View source / Explain).

## Verification (real browser — cdp-shot, dispatched clicks)

- Collapsed: 1 reply, toggle "Show this thread · 3 replies", chevron present, body `line-clamp: 1`.
- Click → `expanded` class, **3 replies**, toggle "Show less", `aria-expanded: true`, chevron
  `transform matrix(-1,0,0,-1,…)` (180°), body `line-clamp: none` (full text).
- Click again → re-collapses to 1 reply + "Show this thread · 3 replies".
- Light + dark crops: full thread (EXAMPLE / CONTRAST / EXTEND) reads inline, connector line spans all
  blocks, dark theme adapts via existing overrides. (`light-expanded-crop.png`, `dark-expanded-crop.png`)
- `typecheck` exit 0; CSS braces balanced (487/487).

Result: **PASS** — the whole thread is now readable in the feed without leaving the scroll.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Isolated worktree; ask-AI WIP untouched.
