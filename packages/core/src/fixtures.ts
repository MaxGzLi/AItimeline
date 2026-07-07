import { createExpansionPlan } from "./harness/expansionPolicy.js";
import { evaluateInteraction } from "./harness/feedbackPolicy.js";
import type { InteractionSignal, KnowledgeCard, TopicState, UserProfile, UserSignal } from "./types.js";

export const demoProfile: UserProfile = {
  interests: ["智能体", "RAG", "产品策略"],
  knownConcepts: ["LLM", "提示工程", "向量检索"],
  savedConcepts: ["智能体", "知识图谱"],
  weakConcepts: ["评估", "RAG"]
};

export const seoWaterSourceFixture = {
  title: "Grok Advanced Guide: Unlock AI Success",
  body: [
    "Welcome to the ultimate guide for Grok success. In today's fast-moving world, businesses need innovative AI solutions to transform productivity and unlock growth.",
    "This comprehensive advanced guide helps teams leverage cutting-edge technology, boost workflows, empower stakeholders, and revolutionize domain knowledge with seamless intelligence.",
    "Whether you are a beginner or expert, mastering AI will skyrocket outcomes. Start your journey, embrace the future, and discover game-changing strategies for every industry."
  ].join("\n\n")
};

export const technicalSourceFixture = {
  title: "Speculative decoding reduces LLM serving latency",
  body: [
    "Speculative decoding uses a small draft model to propose several tokens, then asks the target model to verify the proposed block in one forward pass. The mechanism preserves exact target-model sampling when rejected tokens are resampled from the target distribution.",
    "In a serving benchmark with batch size 8, a 1.3B draft model paired with a 13B target model reduced median latency from 186 ms/token to 91 ms/token when the draft acceptance rate stayed above 0.62. The throughput gain disappeared when prompts caused long rejection runs.",
    "The practical trade-off is memory pressure: the draft model adds parameters and KV-cache traffic, so deployments need admission control and per-route evaluation before enabling the method globally."
  ].join("\n\n")
};

export const demoCards: KnowledgeCard[] = [
  {
    id: "agent-memory-layers",
    title: "智能体的记忆拆成任务、用户、世界三层之后,效果更好",
    hook: "大多数智能体的记忆问题,不是因为忘了,而是因为把不该放一起的记忆混在了一起。",
    thesis:
      "一个耐用的智能体应该把任务记忆、用户记忆和世界记忆分开,这样检索才能保持精准,而不是每次运行都把过时的上下文一股脑塞进去。",
    shortBody:
      "耐用的智能体不该把所有交互都堆进同一个记忆桶里。把任务记忆、用户偏好和外部世界事实分开,检索会更干净,也能减少过时的上下文。",
    summary:
      "耐用的智能体不该把所有交互都堆进同一个记忆桶里。把任务记忆、用户偏好和外部世界事实分开,检索会更干净,也能减少过时的上下文。",
    keyTakeaway: "记忆的质量比记忆的数量更重要。",
    concepts: ["智能体", "记忆", "评估"],
    sources: [
      {
        id: "source-agent-memory",
        title: "智能体记忆架构笔记",
        url: "https://example.com/agent-memory",
        type: "blog",
        author: "研究笔记"
      }
    ],
    recommendedBecause: "你收藏过智能体工作流相关的内容,而且在评估这块还比较薄弱。",
    trustState: "supported",
    createdAt: "2026-06-08T01:00:00.000Z",
    estimatedReadMinutes: 4,
    difficulty: "intermediate",
    confidence: "medium",
    harnessVersion: "harness-v0",
    thread: [
      {
        id: "agent-memory-layers-thread-example",
        kind: "example",
        title: "例子",
        body: "购物助手应该把你的尺码记成用户记忆,把当前这单结账记成任务记忆,把配送政策记成世界记忆。"
      },
      {
        id: "agent-memory-layers-thread-contrast",
        kind: "contrast",
        title: "哪里会出错",
        body: "如果所有记忆一起被检索出来,智能体可能把一条旧的任务笔记当成你当前的偏好。"
      },
      {
        id: "agent-memory-layers-thread-extension",
        kind: "extension",
        title: "接下来往哪走",
        body: "下一层是评估:检验记忆是真的改善了结果,还是只是把上下文撑得更长。"
      }
    ],
    graphEdges: [
      {
        id: "agent-memory-layers-edge",
        sourceConcept: "智能体",
        relation: "requires",
        targetConcept: "记忆",
        evidence: "耐用的智能体需要分层的记忆。",
        weight: 0.84
      }
    ],
    reviewPrompts: [
      {
        id: "agent-memory-layers-review",
        kind: "compare",
        prompt: "任务记忆和用户记忆有什么区别?",
        answerHint: "任务记忆关心当前这件事;用户记忆关心持久的偏好。",
        dueInDays: 2
      }
    ],
    nextActions: ["continue_deeper", "schedule_review"]
  },
  {
    id: "rag-evaluation-loop",
    title: "RAG 系统需要的是评测集,而不是又一个检索小技巧",
    hook: "想让 RAG 变好,最快的办法往往不是更好的分块,而是先搞清楚失败长什么样。",
    thesis:
      "一个 RAG 系统应该先准备好有代表性的问题、期望引用的出处和失败标注,再去优化检索手法。",
    shortBody:
      "RAG 的失败大多源于缺少度量。一小批有代表性的问题、期望引用的出处和失败标注,对迭代速度的提升,往往比再调一次分块更大。",
    summary:
      "RAG 的失败大多源于缺少度量。一小批有代表性的问题、期望引用的出处和失败标注,对迭代速度的提升,往往比再调一次分块更大。",
    keyTakeaway: "先把评测闭环搭起来,再去优化检索。",
    concepts: ["RAG", "评估", "向量检索"],
    sources: [
      {
        id: "source-rag-evals",
        title: "RAG 评测实战指南",
        url: "https://example.com/rag-evals",
        type: "paper"
      }
    ],
    recommendedBecause: "RAG 在你的兴趣里,而评估目前是你的薄弱概念。",
    trustState: "supported",
    createdAt: "2026-06-08T02:30:00.000Z",
    estimatedReadMinutes: 5,
    difficulty: "intermediate",
    confidence: "medium",
    harnessVersion: "harness-v0",
    thread: [
      {
        id: "rag-evaluation-loop-thread-example",
        kind: "example",
        title: "例子",
        body: "准备 30 个真实问题,列出期望命中的出处段落,再追踪回答有没有引用对证据。"
      },
      {
        id: "rag-evaluation-loop-thread-contrast",
        kind: "contrast",
        title: "常见的坑",
        body: "团队常常在还不知道哪些用户问题在失败之前,就先去调向量、分块大小和重排。"
      },
      {
        id: "rag-evaluation-loop-thread-extension",
        kind: "extension",
        title: "接下来往哪走",
        body: "有了评测之后,排序就能优先推那些讲清楚用户反复踩坑类别的卡片。"
      }
    ],
    graphEdges: [
      {
        id: "rag-evaluation-loop-edge",
        sourceConcept: "RAG",
        relation: "evaluates",
        targetConcept: "评估",
        evidence: "RAG 的改进依赖有代表性的评测集。",
        weight: 0.9
      }
    ],
    reviewPrompts: [
      {
        id: "rag-evaluation-loop-review",
        kind: "apply",
        prompt: "为一个 RAG 系统设计一个评测问题,并说出它期望命中的出处。",
        answerHint: "这个问题应该能对应到一段已知的出处,以及一个可衡量的答案。",
        dueInDays: 1
      }
    ],
    nextActions: ["continue_deeper", "schedule_review"]
  },
  {
    id: "knowledge-feed-product-loop",
    title: "当每一次互动都让下一张卡更好,知识流才有护城河",
    hook: "护城河不是这条流,而是这条流从每一次有用的互动里学到了什么。",
    thesis:
      "当点赞、收藏、追问、划走和复习真的会改变智能体接下来生成什么,知识时间线才具备护城河。",
    shortBody:
      "产品闭环不是刷流本身,而是信号沉淀:点赞、收藏、追问和复习汇成用户的学习图谱,再反过来改变排序和讲解方式。",
    summary:
      "产品闭环不是刷流本身,而是信号沉淀:点赞、收藏、追问和复习汇成用户的学习图谱,再反过来改变排序和讲解方式。",
    keyTakeaway: "护城河是用户日积月累的学习图谱。",
    concepts: ["产品策略", "知识图谱", "个性化"],
    sources: [
      {
        id: "source-product-loop",
        title: "个人知识产品备忘",
        url: "https://example.com/knowledge-loop",
        type: "manual"
      }
    ],
    recommendedBecause: "你在做一个 open-core 知识产品,需要一个紧凑的留存闭环。",
    trustState: "emerging",
    createdAt: "2026-06-08T03:15:00.000Z",
    estimatedReadMinutes: 3,
    difficulty: "beginner",
    confidence: "medium",
    harnessVersion: "harness-v0",
    thread: [
      {
        id: "knowledge-feed-product-loop-thread-example",
        kind: "example",
        title: "例子",
        body: "如果用户收藏了《智能体记忆》又划走了三张 RAG 卡,下一次智能体运行就该把记忆讲深、把 RAG 降温。"
      },
      {
        id: "knowledge-feed-product-loop-thread-contrast",
        kind: "contrast",
        title: "不是普通的信息流",
        body: "普通信息流优化的是注意力;学习流优化的是有产出的注意力,再加上记得更牢。"
      },
      {
        id: "knowledge-feed-product-loop-thread-extension",
        kind: "extension",
        title: "接下来往哪走",
        body: "把每个信号变成一条下一步策略:更深、更广、更简单、复习,或者降温。"
      }
    ],
    graphEdges: [
      {
        id: "knowledge-feed-product-loop-edge",
        sourceConcept: "产品策略",
        relation: "applies",
        targetConcept: "知识图谱",
        evidence: "用户互动会变成图谱和排序信号。",
        weight: 0.78
      }
    ],
    reviewPrompts: [
      {
        id: "knowledge-feed-product-loop-review",
        kind: "explain",
        prompt: "为什么互动反馈比静态摘要更有护城河?",
        answerHint: "因为每一次互动都会更新未来的生成、排序、图谱和复习。",
        dueInDays: 2
      }
    ],
    nextActions: ["expand_broader", "schedule_review"]
  }
];

export const demoSignals: UserSignal[] = [
  {
    id: "signal-1",
    cardId: "agent-memory-layers",
    type: "like",
    createdAt: "2026-06-08T04:00:00.000Z"
  },
  {
    id: "signal-2",
    cardId: "knowledge-feed-product-loop",
    type: "ask",
    prompt: "这怎么变成一个付费 App?",
    createdAt: "2026-06-08T04:05:00.000Z"
  },
  {
    id: "signal-3",
    cardId: "rag-evaluation-loop",
    type: "save",
    createdAt: "2026-06-08T04:10:00.000Z"
  }
];

export const demoInteractionSignals: InteractionSignal[] = [
  {
    postId: "agent-memory-layers",
    topicId: "智能体",
    conceptIds: ["智能体", "记忆", "评估"],
    impression: true,
    dwellTimeMs: 11800,
    openedThread: true,
    liked: false,
    saved: true,
    askedQuestion: false,
    reviewed: false,
    skippedQuickly: false,
    createdAt: "2026-06-08T05:00:00.000Z"
  },
  {
    postId: "rag-evaluation-loop",
    topicId: "rag",
    conceptIds: ["RAG", "评估", "向量检索"],
    impression: true,
    dwellTimeMs: 14200,
    openedThread: true,
    liked: true,
    saved: false,
    askedQuestion: false,
    reviewed: false,
    skippedQuickly: false,
    createdAt: "2026-06-08T05:05:00.000Z"
  },
  {
    postId: "knowledge-feed-product-loop",
    topicId: "产品策略",
    conceptIds: ["产品策略", "知识图谱", "个性化"],
    impression: true,
    dwellTimeMs: 700,
    openedThread: false,
    liked: false,
    saved: false,
    askedQuestion: false,
    reviewed: false,
    skippedQuickly: true,
    createdAt: "2026-06-08T05:10:00.000Z"
  }
];

export const demoTopicStates: TopicState[] = [
  {
    topicId: "智能体",
    interestScore: 0.78,
    fatigueScore: 0.08,
    comprehensionScore: 0.58
  },
  {
    topicId: "rag",
    interestScore: 0.86,
    fatigueScore: 0.05,
    comprehensionScore: 0.76
  },
  {
    topicId: "产品策略",
    interestScore: 0.42,
    fatigueScore: 0.82,
    comprehensionScore: 0.64
  }
];

export const demoLearningFeedback = demoInteractionSignals.map((signal) =>
  evaluateInteraction(
    signal,
    demoTopicStates.find((topicState) => topicState.topicId === signal.topicId) ?? {
      topicId: signal.topicId,
      interestScore: 0,
      fatigueScore: 0,
      comprehensionScore: 0
    }
  )
);

export const demoExpansionPlan = createExpansionPlan({
  signals: demoInteractionSignals,
  feedback: demoLearningFeedback,
  topicStates: demoTopicStates,
  generatedAt: "2026-06-08T06:00:00.000Z"
});
