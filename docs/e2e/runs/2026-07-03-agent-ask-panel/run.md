# Agent Ask Panel — Phase A

Date: 2026-07-03

## What changed

- New agent entry panel at the top of the right rail ("Ask Your Knowledge"): question input, boundary-zone chips, grounded answer with source quote, "Open the cited card", and next-action proposals.
- Backend: `POST /api/agent/ask` (conversation agent + boundary placement + turn metering), real `discoverSources` wired to a pluggable search provider.

## Capture

- `agent-ask-answered.png`: full app at 1440px, after typing "Tell me more about AI Agent" into the agent panel and submitting (`docs/e2e/interactions/agent-ask.js`).
  - Zone chip shows "On your frontier" (fresh profile, concept exists in the library but has no interaction signals — correct placement).
  - Answer is the deterministic grounded answer citing "Learning agents need a timeline surface" (no model configured).
  - Action chips: "Start a learning series", "Find sources on this".

## How it was driven

```bash
AITIMELINE_ENABLE_FIXTURES=1 PORT=8787 node apps/api/src/server.mjs   # temp data dir
curl -X POST 127.0.0.1:8787/api/import/article -d '{"url":"http://127.0.0.1:8787/fixtures/article"}'
npx vite --port 5173   # in apps/web
node docs/e2e/cdp-shot.mjs docs/e2e/runs/2026-07-03-agent-ask-panel/agent-ask-answered.png \
  http://127.0.0.1:5173 1440 1600 docs/e2e/interactions/agent-ask.js
```

Interaction signal printed by the harness: `agent-answered:Based on "Learning agents need a timeline surface"...`
