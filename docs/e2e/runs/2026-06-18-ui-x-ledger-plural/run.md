# E2E run — Pluralize evidence-ledger count labels (UI loop, iteration 59)

Date: 2026-06-18 · Branch: `ui/x-ledger-plural` (off `origin/main`) · App.tsx only

## The bug (confirmed visible with the API connected)

The detail drawer's Evidence Ledger renders count nouns hardcoded plural. A card grounded in a single
source/chunk showed "**1 sources**" and "**1 chunks**". Verified by running the real API
(`AITIMELINE_ENABLE_FIXTURES=1 node apps/api/src/server.mjs` on :8787) and opening a follow-up card —
the ledger read "…0 warnings 0 failed **1 sources 1 chunks** 14 claims". (This is why the offline-only
harness missed it: the ledger summary only renders when `apiStatus === "connected"`; offline it shows
"Checking source grounding…".)

## The fix (App.tsx only, EvidenceLedgerPanel)

Apply the existing `pluralize(count, singular, plural)` helper (added iter 58, function-hoisted so it's
callable here) to the four **count-noun** strings: `warnings`, `sources`, `chunks`, `claims`. Left
`passed` and `failed` alone — those are past-tense verbs ("1 passed", "1 failed" are correct English),
not count nouns.

## Verification (real browser + real API — cdp-shot)

- API up on :8787; web connected (`apiStatus = connected`); follow-up card opened.
- `.evidence-summary` → `["14 passed","0 warnings","0 failed"]` (unchanged; "0 warnings" correct).
- `.evidence-meta` → `["1 source","1 chunk","14 claims"]` (was "1 sources"/"1 chunks").
- `has_1sources_bug: false`, `has_1chunks_bug: false`, `has_1source_fixed: true`, `has_1chunk_fixed: true`.
- Crop confirms pills: 14 passed / 0 warnings / 0 failed · 1 source / 1 chunk / 14 claims.
- `typecheck` exit 0.

Result: **PASS** — ledger singular counts now read correctly; verbs and plural counts unchanged.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Isolated worktree; ask-AI WIP untouched.
