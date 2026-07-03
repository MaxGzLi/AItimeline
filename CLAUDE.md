# CLAUDE.md

AITimeline is an open-core AI knowledge timeline: an agent imports sources (articles, YouTube), turns them into source-grounded knowledge cards, ranks them into a personal feed, and accumulates likes/saves/questions into a knowledge graph with spaced review.

## Repo Map

```text
apps/web           React + Vite prototype (single-file UI in src/App.tsx)
apps/api           Local Node HTTP API + background worker (src/server.mjs, plain JS)
packages/core      Open-source kernel (TypeScript, compiled to dist/)
  src/harness/     Post/followup harness, schema validation, grounding gate, model runner, grounded Q&A
  src/transform/   Article / YouTube import -> cited knowledge cards
  src/agents/      Background curation plan + persistent job queue
  src/ranking/     Personalized timeline ranker, post release plans
  src/graph/       Knowledge graph, cross-card connections
  src/memory/      Editable user memory
  src/review/      Spaced review scheduling
  src/storage/     JSON snapshot persistence store
  src/model/       OpenAI-compatible model client (server-side only)
scripts/           Smoke tests (smoke-core / smoke-api / smoke-model)
docs/              Product, architecture, roadmap docs; docs/e2e/ UI screenshot tooling
```

Key coupling: `apps/api` imports from `packages/core/dist/` (compiled output, not src). After editing core, run `npm run build -w @aitimeline/core` before testing the API. The smoke scripts already do this.

## Commands

```bash
npm run dev          # web app (Vite), expects API on 127.0.0.1:8787
npm run dev:api      # local API + worker
npm run typecheck    # all workspaces
npm run build        # all workspaces
npm test             # builds core, runs smoke:core + smoke:api + smoke:model
```

There is no unit-test framework; verification is `typecheck` + the three smoke scripts. New core behavior must be covered by extending a smoke script.

## Rules

- **Grounding is the product promise.** Any new generation or recommendation logic must preserve source registry records, citations, grounding validation, and smoke coverage (see CONTRIBUTING.md).
- Never call model providers from the browser. Model access goes through `packages/core/src/model/openaiCompatibleClient.ts` on the server/worker side; config via `AITIMELINE_MODEL_*` env vars (see `.env.example`).
- Everything must work with no model configured: each model-backed path needs a deterministic fallback (the smoke tests run network-free).
- `apps/api` is plain `.mjs` (no build step); `packages/core` and `apps/web` are TypeScript.
- Local data lives in `apps/api/data/*.json` (gitignored). Snapshot schema is `AITimelinePersistenceSnapshot` in `packages/core/src/storage/persistenceStore.ts`.
- Known limitation (fine locally, must fix before hosting): the import endpoints fetch arbitrary user-supplied URLs with no private-address blocklist (SSRF). Local fixtures depend on loopback URLs, so any future guard must be config-gated.

## Workflow

1. Before starting: `npm run typecheck && npm test` should be green on main.
2. Branch per change; keep diffs small and traceable to the request.
3. Before pushing: `npm run typecheck`, `npm run build`, `npm test`.
4. CI (`.github/workflows/ci.yml`) runs typecheck + build + all three smokes on PRs and pushes to main.
5. UI changes: capture before/after screenshots with `docs/e2e/` tooling into `docs/e2e/runs/<date>-<slug>/`.
