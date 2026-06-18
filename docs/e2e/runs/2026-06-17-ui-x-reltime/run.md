# E2E run — Integration QA + X-style relative post time (UI loop, iteration 36)

Date: 2026-06-17 · Branch: `ui/x-integration-qa2` (off `origin/main`)

## Part 1 — Integration QA over the 11 features since greenlight (PASSED clean)

Composed the newest features and checked for conflicts:
- **Focus + dismiss**: keyboard-focus a card, click "Not interested" → it collapses in place, stays
  in the list (total 3), no crash; `j` still moves focus afterward. ✓
- **Thread expand + dismiss + undo**: expand a thread (3 replies), dismiss, Undo → thread state
  preserved (still 3 replies). ✓
- **Dark coherence**: liked card + expanded thread + saved card + dismissed bar all composed in dark
  → coherent, no clashes (`qa-dark-composed.png`; signal dismissed=1, liked=1, expandedReplies=3). ✓

No behavioural or visual conflict — the features are well-isolated (per-card view state survives
dismiss/undo; keyboard nav operates on `visibleCards`, unaffected by per-card state).

## Part 2 — The genuine gap found → shipped (relative post time)

The post header read `Name @handle  5m read` (read-time only) — every X post shows a **relative
posted-age** (`· 2h` / `· 3d`), and the cards carry real `createdAt` (used for the Latest sort) that
was never surfaced. Added:
- `formatRelativeTime(iso)`: "now" / "Nm" / "Nh" / "Nd", then a short date ("Jun 8") for older posts.
- A timestamp span in `.post-author-line` between the handle and read-time.
- CSS `span + span::before { content: "·" }` middot separators → `@handle · Jun 8 · 5m read` (X pattern).

## Verification (real browser — cdp-shot)

- Header spans now `["@rag", "Jun 8", "5m read"]`; `::before` content `"·"` on the 2nd+ spans.
  ("Jun 8" because demo `createdAt` is 2026-06-08, ~10 days old → date form.)
- Light + dark header crops: `RAG Field Notes @rag · Jun 8 · 5m read`, middots + muted text adapt in
  dark. (`light-header-crop.png`, `dark-header-crop.png`)
- `typecheck` exit 0; CSS braces balanced (492/492).

Result: **PASS** — features compose cleanly; the header now carries an X-style relative timestamp.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. Isolated worktree; ask-AI WIP untouched.
