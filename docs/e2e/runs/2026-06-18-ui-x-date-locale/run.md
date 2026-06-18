# E2E run — Fix Chinese date locale in an all-English UI (UI loop, iteration 54)

Date: 2026-06-18 · Branch: `ui/x-date-locale` (off `origin/main`) · App.tsx only

## The bug

`formatDueDate` and `formatShortTime` were hardcoded to `Intl.DateTimeFormat("zh-CN", …)`, so the
right-rail "Due Soon" review dates rendered as "6月9日 / 6月10日" and the scout time in Chinese — for
EVERY user (the locale is hardcoded, not locale-aware). The rest of the app is uniformly English: all
labels ("Knowledge Timeline", "For you", "Due Soon", "You're all caught up", …) and the other two date
formatters (`formatRelativeTime`, `formatFullTimestamp`) explicitly force `"en"`. Two of four date
formatters using "zh-CN" in an all-English UI is a clear inconsistency / oversight.

## The change (App.tsx only)

`"zh-CN"` → `"en"` in `formatDueDate` and `formatShortTime`. Now all four date formatters and the whole
UI are consistently English. (Two string changes; no logic/markup change.)

## Verification (real browser — cdp-shot)

- Review-row dates now render `["Jun 9","Jun 10","Jun 9","Jun 10"]` (was 6月9日/6月10日); no CJK chars.
- Crop confirms the "Due Soon" section: RAG·Jun 9 / Evaluation·Jun 10 / AI Agent·Jun 9 / Memory·Jun 10.
- `formatShortTime` (scout time) fixed by the same change; not visible in the offline demo
  (`lastScoutAt` null), but the edit is identical.
- 0 `"zh-CN"` remain; `typecheck` exit 0.

Result: **PASS** — the UI now uses English dates everywhere, consistently.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Isolated worktree; ask-AI WIP untouched.
