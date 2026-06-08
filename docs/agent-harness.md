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
- [packages/core/src/harness/systemPrompt.ts](../packages/core/src/harness/systemPrompt.ts)
- [packages/core/src/harness/postHarness.ts](../packages/core/src/harness/postHarness.ts)
- [packages/core/src/harness/feedbackPolicy.ts](../packages/core/src/harness/feedbackPolicy.ts)

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

## Positive-Interaction Rule

Positive interaction decides expansion direction:

- Like: expand broader into adjacent concepts.
- Save: schedule review and strengthen graph memory.
- Ask: continue deeper or reframe simpler depending on the question.
- Thread dwell: continue the series, but vary depth and examples.
- Review completion: increase mastery and introduce the next concept.

## Current Implementation

The current MVP uses a deterministic mock harness:

1. A YouTube URL creates a mocked source and transcript.
2. Transcript segments become `KnowledgeChunk`s.
3. Each chunk becomes a `KnowledgePost`.
4. Each post includes hook, thread blocks, graph edges, review prompts, and next actions.
5. The Web app displays those fields in the timeline and source detail drawer.

This is intentionally deterministic. The next step is to replace mock generation with model-backed generation while keeping the same schema.

## Build Next

1. Add JSON schema validation for harness outputs.
2. Add an agent prompt runner that takes source chunks and returns `KnowledgePost`.
3. Add interaction event capture in the Web app.
4. Feed captured signals through `evaluateInteraction`.
5. Use the resulting `nextAction` to generate follow-up posts.

