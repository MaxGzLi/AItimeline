# AITimeline Roadmap

## Core Thesis

AITimeline 的核心不是“刷内容”，而是“把外部信息转化成用户自己的长期知识”。timeline 只是入口，真正的系统由五块组成：

1. 知识库：存储来源、切片、摘要、概念、引用和知识卡。
2. 记忆：记录用户兴趣、已掌握概念、薄弱概念、点赞收藏、提问历史。
3. 推荐系统：决定什么知识现在应该出现在 timeline。
4. Agent 转化系统：把 YouTube、文章、论文、播客、网页转成可学习的知识卡。
5. 交互与复习：通过评论问答、图谱和复习队列让知识留下来。

## Phase 0: Repo And Prototype

Status: started.

- Local git repo and initial open-core structure.
- Web timeline prototype.
- Core package for card types, ranking, graph and review primitives.
- Product, monetization and architecture docs.

## Phase 1: Knowledge Object Model

Goal: define what enters the system and how it becomes reusable knowledge.

Build:

- `Source`: 原始来源，比如 YouTube URL、文章 URL、PDF、手动笔记。
- `SourceAsset`: 视频字幕、网页正文、PDF 文本、图片 OCR、元数据。
- `KnowledgeChunk`: 可检索的知识切片。
- `KnowledgeCard`: timeline 里展示的知识卡。
- `Concept`: 图谱节点。
- `Citation`: 卡片和回答的来源引用。

Backend tasks:

- Add schema types in `packages/core`.
- Add a small local persistence layer for MVP.
- Create fixture-driven tests for source to card conversion.

Frontend tasks:

- Add source import entry.
- Add source status states: queued, extracting, summarized, ready, failed.
- Add card detail view with citations.

## Phase 2: Agent Knowledge Transformation

Goal: user can paste a source, and the agent turns it into timeline-ready knowledge.

First source type: YouTube.

Flow:

1. User pastes YouTube URL.
2. System fetches metadata and transcript when available.
3. Agent extracts chapters, key claims, concepts and questions.
4. Agent creates one or more knowledge cards.
5. Cards enter timeline with citations back to timestamps.
6. User can ask questions grounded in that source.

Outputs:

- timeline card
- concept nodes
- suggested review items
- grounded AI comment thread

Principle:

- Similar to NotebookLM in source grounding, but presented as an ongoing personal knowledge feed instead of a document workspace.

## Phase 3: Personal Memory

Goal: every user action improves future recommendations and explanations.

Memory layers:

- Profile memory: interests, goals, preferred explanation style.
- Knowledge memory: known concepts, weak concepts, saved concepts.
- Interaction memory: likes, saves, questions, confusing moments.
- Agent memory: configured topics, source preferences, recurring jobs.

Rules:

- User should be able to inspect and edit important memory.
- Memory should explain recommendations, not become a black box.
- Sensitive memory and source content need clear privacy boundaries.

## Phase 4: Recommendation System

Goal: timeline ordering should feel personal, useful and review-aware.

Ranking signals:

- User interests.
- Weak concepts.
- Saved concepts.
- Source quality.
- Freshness.
- Novelty.
- Relationship to recently viewed cards.
- Review due dates.
- User fatigue with repeated topics.

MVP ranker:

- Rules-based scoring in `packages/core`.
- Transparent score reasons.
- No opaque model ranking at the start.

Later ranker:

- Embedding similarity.
- Graph distance.
- Behavioral feedback.
- Multi-objective balancing: novelty, mastery, utility, recency.

## Phase 5: Knowledge Graph And Review

Goal: likes and questions become durable knowledge structure.

Build:

- Concept graph by saved cards.
- Card to concept backlinks.
- Related-card discovery.
- Review queue based on weak concepts and due dates.
- Weekly knowledge recap.

Avoid early:

- Huge graph canvas.
- Manual graph editing.
- Pretty but unusable visualization.

## Phase 6: Commercial Hosted App

Goal: charge for convenience, hosted agents and AI usage.

Paid features:

- Cloud agent runs.
- More AI questions.
- More source imports.
- Sync.
- Weekly briefings.
- Deep research jobs.
- Higher quality default source packs.

Open-core boundary:

- Open source the portable runtime and schemas.
- Charge for hosted automation, sync, AI quota and polished product experience.

## Immediate Next Milestones

1. Add dwell-time and viewport-based impression tracking.
2. Add a model-backed `KnowledgePostAgentRunner` behind the harness interface.
3. Use validation failures to repair model output before accepting posts.
4. Persist `AgentExpansionPlan` jobs and execute follow-up generation.
5. Add real YouTube transcript extraction behind the existing mock interface.
6. Add article URL import.
7. Add better post clustering so one long source does not flood the feed.
8. Add user-editable memory controls.
9. Add a lightweight backend persistence layer.
