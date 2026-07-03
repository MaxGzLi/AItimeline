# Knowledge Loops: 供给闭环与掌握闭环

本文回答三个问题：新知识如何源源不断地供给；用户感兴趣的知识如何细化、保留、复习到真正学会；在这两条闭环之上还值得加什么功能。方案全部落在现有模块上，标注了每一步复用什么、缺什么。

## 现状盘点（哪些环节已经存在）

| 环节 | 模块 | 状态 |
| --- | --- | --- |
| 手动导入（文章/YouTube） | `transform/articleImport`、`transform/youtubeImport` | 可用 |
| 兴趣信号 → 扩展任务 | `harness/expansionPolicy`、`harness/feedbackPolicy` | 可用 |
| 追问式跟进帖生成 | `harness/followupHarness` | 可用（但只复用已有 chunk） |
| 源候选池 + 状态机 | `SourceCandidateRecord`（pending → queued → imported → dismissed） | 可用 |
| 兴趣触发候选导入 | `/api/signals` 匹配候选并排队 | 可用 |
| 后台任务队列 | `agents/backgroundCurationQueue` | 可用 |
| **源发现（discover_sources）** | `researchAgent.buildResearchBrief` 只产查询计划；API 的 `discoverSources: () => []` | **空缺** |
| 发布节流、疲劳冷却 | `ranking/postReleasePlan`、topicState cooldown | 可用 |
| 复习提示物 | 卡片自带 `reviewPrompts`（recall/compare/apply/explain）、quiz thread block | 有数据无消费 |
| **间隔复习调度** | `review/spacedReview` | **桩**（固定间隔、强度不更新、结果不回流） |
| 概念图谱 | `graph/knowledgeGraph`、`graph/cardConnections` | 可用（共现图） |
| 用户记忆 | `memory/userMemoryControls`（known/weak/saved concepts, goals） | 可用（二值，无掌握度） |

结论：两条闭环各缺一环——供给缺「发现」，学习缺「掌握度模型」。补上这两环，其余环节即可串成自增强循环。

## 一、供给闭环：知识如何源源不断

四层供给漏斗，越往下越自动：

```text
L1 用户显式导入        贴 URL / 分享进来（已有）
L2 兴趣驱动跟进        followupHarness 从已有 chunk 深挖（已有，会枯竭）
L3 兴趣驱动发现        discovery provider 拉新来源 → 候选池（本方案核心）
L4 订阅源包            topic 源包（RSS/频道/newsletter）定时产候选（商业化的默认源包）
```

### L3 源发现（优先建设）

新增 `packages/core/src/discovery/`：

1. **`SearchProvider` 接口**：`search(query, options) => DiscoveredSource[]`。开源侧 BYO key（Tavily/Brave/SearXNG/RSS 均可实现该接口）；无 provider 时回退为空结果，保持 network-free 冒烟测试不变。
2. **`planDiscoveryQueries(input)`**：合并三类查询意图——
   - 兴趣延伸：`expansionPolicy` 产出的 topic + nextAction（continue_deeper → "X advanced/internals"，expand_broader → "X vs / X applications"）；
   - 图谱边界（frontier）：`knowledgeGraph` 中与高权重节点相邻但 registry 尚未覆盖的概念；
   - 用户目标：`memory.profile.goals` 与 `agent.preferredSourceTypes`。
   `researchAgent.buildResearchBrief` 的查询计划并入此处，researchAgent 升级为「配置 + 计划」层。
3. **候选净化门**（进候选池之前）：
   - 去重：URL 规范化比对 + registry 内容 hash 比对（snapshot hash 已存在）；
   - 新颖度：候选摘要 token 与已覆盖概念/chunk 的重叠度过高则降分（复用 grounding 的 overlap 思路）；
   - 质量启发式：域名信誉表、正文长度、发布时间。
   评分沿用 `BackgroundSourceCandidate` 的 relevance/novelty/quality 三元组，不改 schema。
4. **接线**：API 的 `discoverSources` handler 从 `() => []` 换成真实现（读 env 配置 provider）；`discover_sources` job 的产出写入候选池——后续「用户对该主题表现兴趣 → 自动排队导入」这条路已经通了。
5. **调度**：沿用现有 auto scout（页面可见时跑到期任务）；roadmap 中"搬到托管 worker"后此处零改动（只依赖 job store 接口）。

抑制过载（全部已有，只需保持）：发布节流防止单源刷屏；topic cooldown 与 fatigue 防止同主题轰炸；`maxJobsPerTopic`/`maxSourceImportsPerTopic` 限额。

### L4 订阅源包

`SourcePack = { topicId, feeds: FeedRef[], cadence }`，定时任务展开为候选（intakeKind 已有 `agent_discovery`）。商业侧卖"高质量默认源包"，开源侧允许自配 RSS。此层可后置，等 L3 验证后再做。

## 二、掌握闭环：细化、保留、复习到真正学会

### 1. 概念掌握度模型（核心缺环）

新增 `ConceptMasteryRecord`（持久化进 snapshot，新增一个数组字段即可）：

```ts
{
  conceptId: string;          // slugConcept 规范化
  strength: number;           // 0-1
  stage: "seen" | "learning" | "reviewing" | "mastered";
  intervalDays: number;       // 当前复习间隔
  easeFactor: number;         // SM-2 风格
  dueAt?: string;
  evidence: { cardIds: string[]; lastOutcome?: "passed" | "failed" };
  updatedAt: string;
}
```

更新规则（事件驱动，挂在现有 signal 管道上）：

| 事件 | 效果 |
| --- | --- |
| 读卡（足够 dwell） | seen；strength 微增 |
| 点赞/收藏 | 进入 learning，建立复习排期（首个间隔 1 天） |
| 追问 | strength 微降 + 标记 weak（`memory.knowledge.weakConcepts` 已有），触发 `reframe_simpler` 跟进（expansionPolicy 已支持） |
| 复习通过 | `interval *= easeFactor`，strength 增 |
| 复习失败 | interval 重置为 1 天，ease 降，strength 降 |
| **毕业判定** | strength ≥ 0.8 且 interval ≥ 21 天且至少一次 apply 类 prompt 通过 → mastered，并写入 `memory.knowledge.knownConcepts` |

毕业的直接效果：ranker 降权该概念的重复内容、图谱 frontier 把它相邻的未学概念升为发现目标——**掌握闭环反哺供给闭环**。

`spacedReview.createReviewQueue` 重写为从 mastery records 取到期项，输出复习卡；复习卡的内容直接用卡片自带的 `reviewPrompts`（数据已生成，一直没消费）。

### 2. 复习面（不做独立复习 App，混入 timeline）

- 到期复习项包装成 ReviewCard 插入 timeline（ranker 已有 review urgency 信号位）；正面是 prompt，交互揭示 answerHint，用户自评「记得 / 模糊 / 忘了」三档 → 映射 passed/failed 回流 mastery。
- 新信号：`InteractionSignal` 增加 `reviewOutcome?: "passed" | "failed"`（`reviewed: boolean` 已存在，只加结果维度）。
- 每周一张「周度回顾卡」：本周学了什么、哪些概念在巩固、哪些到期（agent-harness 文档已列，缺实现）。

### 3. 细化：从单卡到系列（TopicSeries）

现状：兴趣强 → 生成一张 followup 卡，无进度概念，深挖不成体系。

新增 `TopicSeriesState = { topicId, stage: number, targetDifficulty, completedCardIds, nextIntent }`：

- 用户对某 topic 连续正反馈 → 开启 series：按 `difficulty`（beginner → intermediate → advanced，字段已有）规划阶梯；
- 每级的卡优先从候选池/发现结果里找对应难度的来源，找不到再用 followupHarness 从已有 chunk 生成；
- series 有终点：走完阶梯 + 相关概念 mastered → series 完结，产出一张「你已掌握 X」总结卡（成就感 + 显式毕业）。

### 4. 保留

- 跨卡连接（`cardConnections`）已把碎片织成网；
- 加「回链推送」：新卡若与用户已 mastered/learning 概念强关联，推荐理由显式写"和你已掌握的 X 相关"（`scoreReasons` 已有机制，加一条 reason 类型）；
- 收藏夹按图谱聚簇自动成集（不做手动整理负担）。

## 三、还能加什么功能（按杠杆排序）

**P0（直接强化两条闭环）**
1. **Discovery provider + 真实 `discoverSources`**（上文 L3）——没有它，"源源不断"不成立。
2. **概念掌握度 + 真实 SRS + timeline 复习卡**——没有它，"真正学会"不成立。

**P1（放大闭环价值）**
3. **学习目标 → 大纲**：用户写下 "我想搞懂 X"（`profile.goals` 已有字段），agent 生成 syllabus 并转成 TopicSeries + 发现查询——把"刷到什么学什么"升级为"想学什么就供给什么"。
4. **记忆与图谱面板**：可视化 known/weak/learning 概念和图谱，可编辑（`applyUserMemoryEdits` API 已就绪，缺 UI）；每张卡的"为什么推荐"点开可解释——透明记忆是 docs 承诺的差异化。
5. **PWA share-target / 浏览器分享**：随手把链接丢进候选池（`intakeKind: "browser_share"` 类型已预留；roadmap 已列）。
6. **知识缺口卡**：图谱检测"你学了 A 和 B，但它们共同依赖的 C 未覆盖" → 自动发现 C 的来源 → 出一张补缺卡。差异化强，纯图谱规则即可实现。

**P2（体验与商业化）**
7. **观点对照卡**：同一概念多来源观点冲突时（`trustState: "contested"` 字段已有），生成"A 说 / B 说 / 分歧在哪"对照卡——建立"这不是复读机，是有判断的情报台"的信任感。
8. **每日/每周学习摘要**（可入 Deep Research 计费点）：今天值得看的 5 张 + 你的复习债 + 图谱变化。
9. **导出/同步**：概念图与卡片导出 Markdown/Obsidian——取悦开源侧自托管用户，制造口碑。
10. **每日测验模式**：把到期复习打包成 3 分钟 quiz session，作为 timeline 之外的第二入口。

（刻意不做：公开社交/关注/UGC——mvp-spec 已明确 out of scope；大画布图谱编辑器——docs 已判定"好看但没用"。）

## 建设顺序建议

1. **Sprint 1**：`discovery/` 模块 + provider 接口 + `discoverSources` 接线 + 候选净化门（冒烟：假 provider 注入，验证 job → 候选 → 兴趣触发导入全链路）。
2. **Sprint 2**：ConceptMastery + SRS 更新规则 + spacedReview 重写 + `reviewOutcome` 信号（冒烟：模拟 通过/失败 序列，断言间隔与毕业判定）。
3. **Sprint 3**：timeline 复习卡 UI + TopicSeries + 周度回顾卡。
4. **Sprint 4**：学习目标大纲、记忆面板、share-target，之后按数据决定 P2。
