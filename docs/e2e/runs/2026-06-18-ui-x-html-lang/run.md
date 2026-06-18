# E2E run — Fix document language (zh-CN → en) for an English UI (UI loop, iteration 66)

Date: 2026-06-18 · Branch: `ui/x-html-lang` (off `origin/main`) · index.html only

## The bug (WCAG 3.1.1 — Language of Page)

`apps/web/index.html` declared `<html lang="zh-CN">`, but the entire UI is English (every label, and the
date formatters were forced to English in iters 54/59). A wrong `lang` makes assistive tech apply Chinese
pronunciation/voice rules to English text → garbled screen-reader output. Same locale-leak class as the
iter-54 date fix (the author's zh-CN locale leaking into an English product).

## The fix (index.html only)

`<html lang="zh-CN">` → `<html lang="en">`. One attribute; no visual/behaviour change. The title
(`AITimeline`) and the theme pre-paint inline script are untouched.

## Verification (real browser — cdp-shot)

- Rendered `document.documentElement.lang` = `"en"` (was "zh-CN").
- Served HTML head: `<html lang="en">`.
- Theme inline script still runs (data-theme resolves to "light"/"dark"); `title` unchanged ("AITimeline").

Result: **PASS** — the page now declares its real content language (English).

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Isolated worktree; ask-AI WIP untouched.
