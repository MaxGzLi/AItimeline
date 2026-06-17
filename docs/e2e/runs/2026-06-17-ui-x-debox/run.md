# E2E run — De-box embedded blocks (UI loop, iteration 2)

Date: 2026-06-17 · Branch: `ui/x-debox` (off `origin/main`, incl. iteration 1)

## User path

Reader scrolls the feed → each post's embedded blocks ("Agent take", "Review"/"Related"
prompts) read as light inline accents rather than a stack of bordered boxes, so the eye
flows down the post like an X thread instead of scanning a dashboard.

## Change (CSS-only — `apps/web/src/styles.css`)

1. **"Agent take" → left-accent callout** — `.post-claim-card` drops its full border +
   filled box and becomes a left-bar callout (`border-left: 3px solid var(--blue)`,
   faint tint), matching the existing `.post-thesis` pattern already in this codebase.
2. **Review/Related prompts → soft chips** — `.feed-prompt` loses its 1px border and
   white fill, becoming a borderless rounded chip (`background: #f3f6fa`) with a soft
   hover. Reads as tappable, not a form field.

Built on iteration 1 (circular avatars, connected thread replies). No `App.tsx` changes;
isolated from the in-progress `feat/ask-ai-endpoint` working-tree changes.

## Verification (real browser render)

Headless system Google Chrome via `docs/e2e/screenshot.mjs` against the live Vite dev
server (feed renders demo cards offline). `before.png` = current `main` (post-iter-1,
boxed blocks); `after.png` = de-boxed accents. Layout intact, all post content present.

Reproduce:
```
git checkout origin/main && npm run dev -w @aitimeline/web
node docs/e2e/screenshot.mjs docs/e2e/runs/2026-06-17-ui-x-debox/after.png
```

Result: **PASS** — render confirmed visually.

## Delivery

Gated auto-merge: PR → CI `verify` check (typecheck + build + smoke) → `--auto --squash`.
