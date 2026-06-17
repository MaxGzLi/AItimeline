# E2E run — Track the .section-label uppercase eyebrow to the house value (UI loop, iteration 19)

Date: 2026-06-17 · Branch: `ui/x-eyebrow-tracking` (off `origin/main`, incl. iters 1–18)
Source: STRICT fresh design panel (`ui-iter19-design`) — judge shipped P1 (defaulted to ceiling
otherwise). Footer lens correctly PASSED (geometry verified clean, no churn). Mobile not proposed
(verified solid this iter — see memory `responsive-verified`).

## The defect (genuine inconsistency, in-file precedent)

`.section-label` is the app's most-used uppercase eyebrow — "TODAY", "SOURCE AGENT", "ACTIVE
AGENT", every right-rail card label (13 instances), 12px/800/uppercase — and was set to a
placeholder `letter-spacing: 0`. Its identical-species sibling `.trust-badge` (11px/800/uppercase)
already carries `letter-spacing: 0.3px`. So the codebase establishes 0.3px as the house tracking
for small bold uppercase, yet the largest/most-used label of that species sat at zero. Zero
tracking on small uppercase is a standard legibility issue AND an internal inconsistency — not a
preference. (Same defect-class as iter-17's `.summary` 16px inherit and iter-12's heading tracking.)

## Change (CSS-only — `apps/web/src/styles.css`, one property)

`.section-label { letter-spacing: 0 → 0.3px; }` — matches `.trust-badge`. Pure paint; all 13
labels are short 1-2 word strings, no wrap/reflow risk. Isolated from the `feat/ask-ai-endpoint`
work.

## Verification (real browser render — measured)

Computed `letter-spacing` via `docs/e2e/cdp-shot.mjs` + `check-eyebrow.js` (all `.section-label`):
- **BEFORE** (rule temporarily reverted): `normal` (no tracking), all 9 visible instances.
- **AFTER**: `0.3px`, all 9 instances (`allSame: true`).
- `compare-eyebrow.png`: stacked before/after of the "TODAY" + "SOURCE AGENT" eyebrows — AFTER
  tracking is slightly looser/more legible, identical line positions (no reflow), feed unchanged.
- Temp-revert marker removed before commit (`grep TEMP-BEFORE` = 0, `git diff` shows only the
  letter-spacing line + its comment).

Result: **PASS** — eyebrow tracking 0 → 0.3px, measured; matches the house value, no layout shift.

## Delivery

Gated auto-merge: PR → CI `verify` → `--auto --squash`. The strict panel found this one genuine
inconsistency; the footer was verified clean and passed. We are at the CSS-only ceiling — the next
real X gains (For-you/Following tabs, new-posts pill, inline composer, real search) need App.tsx
markup, which the loop keeps hands-off to protect the uncommitted ask-AI work. Flagged to the user.
