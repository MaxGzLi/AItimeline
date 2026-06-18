# E2E run — Correct singular/plural in feed count labels (UI loop, iteration 58)

Date: 2026-06-18 · Branch: `ui/x-plural` (off `origin/main`) · App.tsx only

## The bug (visible on every card)

Each knowledge card's footer renders `social-metrics`: `{score} useful · {thread.length} replies ·
{reviewPrompts.length} checks`. The count nouns were hardcoded plural. All three demo cards have exactly
**1** review prompt, so every card showed "**1 checks**" instead of "1 check". The same unpluralized
pattern was in the thread-count strings (`Show this thread · N replies`, the `Open thread · N replies ·
M checks ready` fallback). X-style feeds always get this right; "1 checks" reads as unpolished.

## The fix (App.tsx only)

Add a `pluralize(count, singular, plural)` helper (reply→replies is irregular, so a naive `+s` is wrong)
and apply it to the reply/check count strings: footer `replies`/`checks` (lines 1838-1839), the
`Show this thread · N replies` toggle, and the `Open thread · … · M checks ready` fallback. The `useful`
metric is left alone — it's always ≥12 and "useful" is an adjective, not a count noun.

## Verification (real browser — cdp-shot)

- Per-card `.social-metrics` now: `["83 useful","3 replies","1 check"]`, `["76 useful","3 replies",
  "1 check"]`, `["49 useful","3 replies","1 check"]`.
- `has_1checks_bug: false`, `has_1check_fixed: true`, `has_1replies_bug: false`.
- Footer crop confirms "83 useful · 3 replies · 1 check".
- `typecheck` exit 0.

Result: **PASS** — singular counts read correctly ("1 check"); plural counts unchanged ("3 replies").

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Isolated worktree; ask-AI WIP untouched.
