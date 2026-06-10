# Agent Harness v0

## Purpose

The Agent Harness is the product brain of AITimeline. It defines how an agent turns sources into timeline-native knowledge posts, how those posts expand into threads, how knowledge is stored as graph/review objects, and how interaction feedback changes the next agent run.

The harness exists so AITimeline does not become another generic:

- summarizer
- read-it-later app
- NotebookLM clone
- chat-with-documents workspace
- RSS digest

## Harness Contract

Every agent run should produce:

- `KnowledgePost`
- `KnowledgeThreadBlock[]`
- `KnowledgeGraphEdge[]`
- `KnowledgeReviewPrompt[]`
- `NextActionPolicy[]`

Code locations:

- [packages/core/src/types.ts](../packages/core/src/types.ts)
- [packages/core/src/agents/backgroundCuration.ts](../packages/core/src/agents/backgroundCuration.ts)
- [packages/core/src/harness/systemPrompt.ts](../packages/core/src/harness/systemPrompt.ts)
- [packages/core/src/harness/expansionPolicy.ts](../packages/core/src/harness/expansionPolicy.ts)
- [packages/core/src/harness/postHarness.ts](../packages/core/src/harness/postHarness.ts)
- [packages/core/src/harness/groundingGate.ts](../packages/core/src/harness/groundingGate.ts)
- [packages/core/src/harness/modelRunner.ts](../packages/core/src/harness/modelRunner.ts)
- [packages/core/src/harness/schema.ts](../packages/core/src/harness/schema.ts)
- [packages/core/src/harness/runner.ts](../packages/core/src/harness/runner.ts)
- [packages/core/src/harness/feedbackPolicy.ts](../packages/core/src/harness/feedbackPolicy.ts)
- [packages/core/src/model/openaiCompatibleClient.ts](../packages/core/src/model/openaiCompatibleClient.ts)
- [packages/core/src/source/sourceImportWorker.ts](../packages/core/src/source/sourceImportWorker.ts)
- [packages/core/src/source/sourceRegistry.ts](../packages/core/src/source/sourceRegistry.ts)

## Harness Run Architecture

The harness is now structured around a run contract instead of a single post factory.

```mermaid
flowchart TD
  Source["Source"] --> Registry["SourceRegistry\nsnapshots + hashes"]
  Registry --> Chunks["KnowledgeChunk[]"]
  Chunks --> Runner["KnowledgePostAgentRunner"]
  Runner --> Posts["KnowledgePost[]"]
  Posts --> Validator["Schema + Policy Validation"]
  Validator --> Grounding["Grounding Gate"]
  Grounding --> Run["AgentHarnessRun"]
  Run --> Timeline["Timeline"]
  Timeline --> Signals["InteractionSignal[]"]
  Signals --> Feedback["LearningFeedback[]"]
  Feedback --> Expansion["Expansion Policy"]
  Expansion --> Queue["AgentExpansionPlan"]
  Queue --> Run
  Run --> Graph["Graph / Review / Feedback"]
```

Main contracts:

- `AgentHarnessConfig`: version, objective, runner kind, and policy limits.
- `AgentHarnessRunInput`: source, chunks, user context, and recommendation reason.
- `KnowledgePostAgentRunner`: shared interface for deterministic and future model-backed runners.
- `AgentHarnessRunResult`: generated posts plus validation metadata.
- `HarnessValidationResult`: schema and policy issues before posts enter timeline, graph, or review.
- `SourceRegistry`: immutable-ish source snapshots, content hashes, chunks, and chunk versions.
- `GroundingCheck`: citation and source-fact evidence checks before accepting a post.
- `AgentExpansionPlan`: follow-up jobs, suppressions, and cooled topics after interaction feedback.
- `BackgroundCurationPlan`: background jobs that decide whether to generate follow-ups, discover sources, import source candidates, schedule review, or cool down.
- `SourceImportWorker`: server-side import orchestrator that creates source registries, runs the selected harness runner, and returns a `SourceImport` status artifact.

Current exported runners:

- `deterministicKnowledgePostRunner`
- `createModelKnowledgePostRunner`
- `runDeterministicAgentHarness`
- `runModelAgentHarness`
- `runAgentHarness`

This means model-backed generation implements `KnowledgePostAgentRunner` rather than bypassing the harness. The model runner treats generated content as untrusted JSON until it passes schema, policy, citation, and grounding checks.

The first real adapter is `createOpenAICompatibleModelClient`, which targets OpenAI-style `/v1/chat/completions` endpoints. It requests JSON mode when the runner asks for `responseFormat: "json_object"`, but [JSON mode only guarantees parseable JSON, not schema adherence](https://developers.openai.com/api/docs/guides/structured-outputs#json-mode), so the AITimeline harness still validates and repairs every candidate post.

## Knowledge Post

A knowledge post is not a summary. It is a feed-native learning unit.

Required fields:

- `title`: concise and high-signal
- `hook`: the media-native reason to keep reading
- `thesis`: the one idea being taught
- `shortBody`: short timeline body
- `keyTakeaway`: one sentence worth remembering
- `sources` and `citations`: provenance
- `concepts`: stable graph node names
- `difficulty`: beginner / intermediate / advanced
- `confidence`: low / medium / high
- `thread`: expansion blocks
- `graphEdges`: concept relationships
- `reviewPrompts`: recall prompts
- `nextActions`: what the agent should do next

## Source Registry

Source management is separated from post generation.

The registry stores:

- `Source`: metadata such as URL, type, title, author, and publish time
- `SourceAsset`: raw transcript, text, or metadata payload
- `SourceSnapshot`: asset version, content hash, and content length
- `KnowledgeChunk`: timestamped or ranged evidence units
- `SourceChunkVersion`: chunk hash, source link, optional snapshot link, and version

The product rule is that generated knowledge cannot be treated as durable unless it can trace back to this registry.

## Grounding Gate

The grounding gate does not make an LLM truthful. It prevents ungrounded output from being accepted.

Current checks:

- every post must include citations
- citation `sourceId` must exist in `SourceRegistry`
- citation `chunkId` must exist in `SourceRegistry`
- source-fact fields must overlap with cited evidence
- weakly grounded interpretations produce warnings
- failed source facts make the harness validation fail

Claim kinds:

- `source_fact`: hard factual content that must pass evidence overlap
- `interpretation`: source-backed interpretation; weak overlap is a warning
- `example`: illustrative content
- `question`: quiz or review prompt

This is the first acceptance gate. The model-backed runner now uses grounding failures as repair instructions: if a generated post fails grounding, the runner asks the model for a complete replacement JSON object before accepting any posts.

## Thread Blocks

Thread is not a comment section. Thread is the learning interaction layer.

Thread block kinds:

- `explain`: what this means
- `example`: concrete example
- `contrast`: how this differs from nearby ideas
- `extension`: where to go next
- `quiz`: quick recall check

## Feedback Policy

The recommender must interpret interaction, not just count it.

Signals:

- impression
- dwell time
- quick skip
- thread open
- like
- save
- ask question
- review completion

Inferred states:

- `interested`
- `confused`
- `fatigued`
- `not_relevant`
- `needs_review`

Next actions:

- `continue_deeper`
- `expand_broader`
- `reframe_simpler`
- `cooldown_topic`
- `schedule_review`
- `ask_clarifying_question`

## No-Interaction Rule

No interaction does not always mean no interest.

The harness should distinguish:

- quick skip: likely not relevant or fatigued
- long dwell without action: maybe useful but not emotionally strong
- thread open without ask/save: interest without explicit signal
- repeated skip in same topic: cool down
- prior interest in related concepts: reframe before dropping

The current expansion policy makes this explicit:

- cold impression with short dwell: suppress the series
- passive dwell below the soft-interest threshold: suppress the series
- long dwell without explicit action: queue a low-confidence deeper follow-up
- quick skip or high fatigue: queue topic cooldown
- topic already cooling down: suppress passive impressions

## Positive-Interaction Rule

Positive interaction decides expansion direction:

- Like: expand broader into adjacent concepts.
- Save: schedule review and strengthen graph memory.
- Ask: continue deeper or reframe simpler depending on the question.
- Thread dwell: continue the series, but vary depth and examples.
- Review completion: increase mastery and introduce the next concept.

The expansion job kinds are:

- `generate_followup`
- `schedule_review`
- `cooldown_topic`
- `ask_clarifying_question`

## Background Curation Rule

When the user keeps browsing, the agent should prepare useful material in the background instead of waiting for manual imports.

The background curation plan turns expansion jobs plus external source candidates into:

- `generate_followup`: keep the current learning path moving.
- `discover_sources`: ask a search/research agent to find sources for concepts the user is pulling on.
- `import_source`: send a selected external source into the source import worker so it can be packaged into timeline posts.
- `schedule_review`: convert saved/reviewed interest into retention.
- `cooldown_topic`: stop producing when the user skips quickly or topic fatigue is high.

Strong interest can produce both a follow-up and an external source import. Weak or negative signals suppress source imports.

## Current Implementation

The current MVP uses a deterministic runner and a provider-agnostic model runner behind the same harness interface:

1. A YouTube URL creates a mocked source and transcript.
2. Transcript segments become `KnowledgeChunk`s.
3. `runDeterministicAgentHarness` creates an `AgentHarnessRun`.
4. Each chunk becomes a validated `KnowledgePost`.
5. The transform creates a `SourceRegistry` with source snapshots, hashes, chunks, and chunk versions.
6. Each post includes hook, thread blocks, graph edges, review prompts, and next actions.
7. Schema, policy, and grounding validation run before a post is accepted.
8. The transform result returns `cards`, `sourceRegistry`, `harnessRun`, and `validation`.
9. The Web app displays the post fields in the timeline and source detail drawer.
10. The Web app records lightweight interaction signals: impression, thread open, like, save, ask, and skip.
11. Signals are evaluated with `evaluateInteraction` and shown as feedback state plus next action.
12. `createExpansionPlan` turns recent signals and feedback into follow-up jobs, review jobs, suppressions, and topic cooldowns.
13. `createModelKnowledgePostRunner` can call any `ModelClient` that returns JSON, then validates and repairs the output before accepting posts.
14. `createOpenAICompatibleModelClient` provides a server-side adapter for OpenAI-compatible model providers.
15. `createSourceImportWorker` and `createOpenAICompatibleSourceImportWorker` compose registry creation, runner execution, validation results, and import status.
16. `createBackgroundCurationPlan` decides which follow-up, source discovery, source import, review, and cooldown jobs should run while the user keeps browsing.

The deterministic path keeps the prototype stable. The model runner lets us connect real LLM providers without weakening the acceptance gate.

## Build Next

1. Add dwell-time and viewport-based impression tracking instead of only action-based signals.
2. Persist source registries and source import runs outside local storage.
3. Persist background curation jobs and execute source discovery/import jobs.
4. Persist topic cooldowns and expansion queue state.
