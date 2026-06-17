# E2E run — Drawer Ask-AI as an X reply thread (UI loop, iteration 10)

Date: 2026-06-17 · Branch: `ui/x-drawer-thread` (off `origin/main`, incl. iters 1–9)
Source: iter-9 fresh panel's adversarially-ranked #2.

## User path

Reader opens a post's detail drawer and asks the AI a question → the Q&A reads as an X-style
reply thread: their own question is a right-aligned blue bubble, the AI's grounded answer is a
left-aligned neutral bubble (each with an asymmetric "tail" corner and quiet role caption),
and the composer is a rounded pill with a brand focus ring — instead of full-width stacked
boxes with shouty uppercase role chips.

## Change (CSS-only — `apps/web/src/styles.css`, 1 end-of-file append)

`aside.detail-drawer`-scoped overrides (the feed's own styling is untouched):
- `.chat-list` → vertical flex column so bubbles self-align.
- `.chat-message` → `inline-grid`, `max-width:85%`, `width:fit-content`, 16px radius bubble.
- `.chat-message.user` → right-aligned `--blue` bubble, white text, squared bottom-right tail.
- `.chat-message.assistant` → left-aligned `#f4f7f9` bubble, hairline border, squared
  bottom-left tail; role label tinted blue.
- role `span` softened from uppercase chip to a quiet caption.
- `.ask-form input` → rounded pill (`border-radius:999px`) + blue focus ring; reduced-motion
  guard added.

Markup unchanged. The drawer Ask-AI **markup** is already on `origin/main` (verified: the
uncommitted `feat/ask-ai-endpoint` work is the API/backend, not this DOM) — so this stays
cleanly isolated in `styles.css`.

## Verification (real browser render, NEW interactive harness)

The static `docs/e2e/screenshot.mjs` can't reach this: the drawer is conditionally rendered
(only after a card click) and chat bubbles only exist after an Ask-AI submit. So this run
adds **`docs/e2e/cdp-shot.mjs`** — a Chrome DevTools Protocol harness using Node 22+'s built-in
global `WebSocket` (no Playwright/Puppeteer) that runs an interaction script before capturing —
plus **`docs/e2e/interactions/drawer-ask.js`** which clicks `.post-open-button` and submits two
Ask-AI questions (answers built offline via `buildGroundedAnswer`, no API).
- Harness signal: `chat-messages=4` (2 user + 2 assistant) for both before & after.
- `before-drawer.png` / `before-chat.png`: full-width stacked message boxes, "YOU"/"AI" chips.
- `after-drawer.png` / `after-chat.png`: right-aligned blue "You" bubble + left-aligned neutral
  "AI" bubbles with tails + rounded pill composer. Confirmed visually.
- Focus ring is CSS-logic-verified (the captured input is unfocused).

Result: **PASS** — X reply-thread bubbles + pill composer confirmed via interactive capture.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. The new harness files don't affect
build/typecheck/smoke (not imported). Backlog left from iter-9 panel: import-as-compose-box
(#3), type-rhythm (#4) → then a fresh panel.
