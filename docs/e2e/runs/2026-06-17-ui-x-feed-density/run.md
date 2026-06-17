# E2E run — X-style feed density & thread connectors (UI loop, iteration 1)

Date: 2026-06-17 · Branch: `ui/x-feed-density`

## User path

Reader opens the timeline → scrolls the feed of knowledge posts → each post reads as
an X-style social post (circular avatar, author line, a connected thread of replies)
rather than a dashboard of nested bordered boxes — making the feed scannable and
"scrollable".

## Change (CSS-only — `apps/web/src/styles.css`)

1. **Circular avatars** — `.post-avatar`, `.reply-avatar` `border-radius: 8px → 50%`.
2. **X-style thread replies** — `.social-thread-reply` lose their box border + filled
   background and become borderless rows hanging off the existing left connector line,
   with a soft hover highlight. The thread preview now reads as a connected reply chain.
3. **Clearer whole-post hover** — `.knowledge-card:hover` background `#fbfdff → #f5f8fb`
   so the post row is the obvious scannable unit.

No `App.tsx` / markup changes — this is a pure visual-density pass, isolated from the
in-progress `feat/ask-ai-endpoint` working-tree changes (which were left untouched).

## Verification (real browser render)

Headless system Google Chrome (no Playwright/Puppeteer) via the reusable harness
`docs/e2e/screenshot.mjs`, against the live Vite dev server (`npm run dev -w
@aitimeline/web`). The web app falls back to demo cards when the API is offline, so the
feed renders without an API server.

- `before.png` — boxed thread replies, square avatars.
- `after.png` — circular avatars, connected borderless thread replies, cleaner feed.

Reproduce:
```
npm run dev -w @aitimeline/web        # serves on http://127.0.0.1:5173
node docs/e2e/screenshot.mjs docs/e2e/runs/2026-06-17-ui-x-feed-density/after.png
```

Result: **PASS** — render confirmed visually; layout intact, all post content present.
