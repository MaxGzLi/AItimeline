# 卡片编号撞车导致静默覆盖

## 背景

卡片的 `id` 由模型在生成时自行给出，没有任何命名空间约束。模型高频复用泛化编号
（`post-001`、`post-002`、`rag-intro-001`……），不同来源的卡因此撞上同一个 id。

持久化层按 id 整张替换，撞车的卡既不进近重复合并逻辑，也不留任何记录。

### 真实数据实测（`apps/api/data/aitimeline.json`，2026-08-03 只读统计）

- 223 个曾产出过的 postId 中，**17 个被多次产出**。
- 被后来者顶掉的卡片版本合计 **34 个**。
- 库内现存 100 张卡中，**11 张的内容被替换过至少一次**。

最严重的样本：

| postId | 产出次数 | 来源情况 |
| --- | --- | --- |
| `post-ai-agent-durable-knowledge-001` | 11 | 11 个各不相同的 `followup-*` sourceId |
| `post-001` / `post-002` | 各 4 | 4 篇互不相关的文章（含 fc6dbbdd、ai-plainenglish、crusoe、PMC4852148） |
| `post-003` / `post-004` | 各 3 | 同上 |
| `rag-intro-001` | 2 | aws.amazon.com 与 promptingguide.ai 两篇不同文章 |
| `aux-loss-free-balancing-001` | 2 | swiftscholar.net 与 themoonlight.io，相隔 6 小时 |

所有撞车样本的 `runnerKind` 均为 `model`——**这不是无模型兜底路径的问题**，是模型正常产出时的编号复用。

现状后果举例：`post-001` ~ `post-004` 四张卡当前全部挂在 `pmc.ncbi.nlm.nih.gov/articles/PMC4852148`
一篇文章上，另外三篇文章导入时生成的卡已不可恢复。

### 代码根因（`packages/core/src/storage/persistenceStore.ts`）

1. `:1587` 每张待存卡先走 `findNearDuplicatePost` 找近重复。
2. `:1712` 该函数第一步就是 `.filter((candidate) => candidate.id !== post.id)`
   ——本意是"不跟自己比"，实际效果是**编号相同的卡永远不进合并逻辑**。
3. 于是撞车的卡直落 `:1608` `postsById.set(post.id, post)`，
   再经 `:1549` `upsertManyById` 写回，旧卡整张消失。
4. `upsertManyById`（`:1812`）是裸的 `byId.set(item.id, item)`：不合并、不告警、不留痕。

写卡入口共两条，本单覆盖第一条为主：

- **主路径**：`saveSourceImportResult` / `previewSourceImportApplications`
  → `applySourceImportResultToSnapshot` → `prepareSourceImportResultForPersistence`。
  文章导入、YouTube 导入、笔记、抓取、跟进生成全走这里。
- **旁路**：`persistenceStore.savePosts`，仅用于连接播报卡与 `extraPosts`
  （`apps/api/src/domains/importPipeline.mjs:196-197`、`domains/shared.mjs:288`）。

## 目标

同一个编号、不同来源的两张卡进来时，**后来者不再抹掉先到者**，且撞车这件事在数据里留得下痕迹。

具体行为：

1. **不同来源撞车 → 给后来者换号，两张卡都留下。**
   新编号必须是 `(原编号, sourceId)` 的确定性函数——同一次导入重跑要得到同一个新编号，
   否则重试会不断增殖卡片。
2. **换号后仍要走近重复合并。** 换完号，`findNearDuplicatePost` 就能正常比对内容了：
   内容确实重复的会被合并（现在这条路是断的），内容不同的作为独立卡保留。
3. **同来源撞车 → 维持现有替换行为。** 同一个 sourceId 重新生成属于正常再导入，
   替换是对的（例：`post-*-article-ad446c87` 同源相隔 15 分钟重跑）。
   "同来源"的判据用 `post.sources[].id` 集合比对，不用 URL。
4. **撞车要留得下痕迹。** ~~另立一份记录~~ ——**实现时改了做法，见下方「实现偏离」。**
5. **换号必须同步改掉本次结果内部对旧编号的引用**：
   `preparedResult.posts[].id`、`harnessRun.outputPostIds`、`validation[].postId`，
   以及卡内任何自引字段（自己 grep 确认有没有，例如 `graphEdges` 端点、`releasePlan`）。
   漏改会造成"卡在库里但校验记录指向不存在的编号"。

## 不做

- **不动任何存量数据**：34 个被顶掉的版本已不可恢复，不回填、不重建、不下架现有卡。
  用户数据的任何改动都要用户单独拍板。
- **不改模型侧的编号生成**（不去 prompt 里要求模型带来源前缀）——那是另一个决策，
  且对已经跑起来的模型不可靠。防线放在持久化层。
- 不改 `upsertManyById` 的通用行为（它还被 curationJobs、interactionSignals 等十几处用，
  那些场景按 id 替换是对的）。只在卡片这条路上加判断。
- 不动 `apps/web`。
- 不动接地门禁（`groundingGate.ts`）。
- **旁路 `savePosts` 本单不改**，但要在汇报里写清它有没有同样的洞、影响面多大，
  作为下一单的输入。

## 验收清单

- [ ] **复现测试先红**：写一个测试，模拟"两个不同 sourceId 的导入结果先后产出同一个 postId"，
      断言两张卡都在、内容各是各的。在修复前跑，确认它是**红**的（把实际输出贴进汇报）。
- [ ] 修复后该测试变绿。
- [ ] 同来源重复产出同一个 postId 时，仍然是替换（1 张卡，不是 2 张），有断言覆盖。
- [ ] 换号确定性：同一份导入结果连续应用两次，第二次不新增卡片，有断言覆盖。
- [ ] 换号后的近重复合并能生效：构造两张"不同来源、同编号、内容高度相似（相似度 ≥ 0.8）"的卡，
      断言它们被合并成一张并留下 `mergedSources` 记录。
- [ ] 换号后 `harnessRun.outputPostIds` 与 `validation[].postId` 指向新编号，
      不残留旧编号，有断言覆盖。
- [ ] 撞车记录可查：有断言检查记录里能读出原编号、新编号、来源。
- [ ] `npm run typecheck`、`npm run build`、`npm test` 全绿（零网络）。
- [ ] **只读回放**：用真实快照的副本（`/tmp` 下自己拷一份，**原文件一个字节都不许写**）
      模拟那 17 组撞车，报告修复后会多保住几张卡。数字写进 PR 描述。

## 实现偏离（2026-08-03 落地后回填）

### 1. 没有新增独立的撞车记录表

原计划另立一份撞车台账。实现时发现**做不得**：`decodeAITimelinePersistenceSnapshot`
对 version 2 快照的规则是"缺任何一个集合就抛错拒绝加载"（`persistenceStore.ts:516-518`），
而用户现有数据正是 version 2（revision 406）。新增一个集合会让现有 100 张卡的库直接开不起来。

改用不动 schema 的做法，痕迹同样留得住：

- 新编号是 `<原编号>-<来源哈希>`，**原编号原样保留在前缀里**，一眼看得出撞过谁。
- `harnessRun.outputPostIds` 和校验记录都指向新编号，能回溯到是哪次导入、哪个来源产生的。
- 旧卡原地不动，两张卡都在库里，撞车本身不再造成任何丢失。

复用 `mergedSources` 也被否掉了：那张表的字段是 `mergedIntoPostId`（"被并进了谁"），
换号不是合并，塞进去等于给记录写假语义。

### 2. 顺带打通了一条本来就断的路

`findNearDuplicatePost` 原先第一步就把"编号相同的候选"排除掉，
导致**撞车的卡从来没机会走内容查重**。修复里去掉了这个排除（同源重导入已在更前面提前返回，
不会误伤）。效果是：撞车且内容确实重复的两张卡现在会正常合并成一张，而不是变成两张近重复卡。

### 3. 发布计划会漏掉换号后的卡（已确认无害，不修）

`importPipeline.mjs:113` 用的是原始 `importResult.posts` 而不是落库后的卡，
所以换号后的卡不会出现在发布计划里。查过 `responses.mjs:210` 的过滤规则：
**不在任何发布计划里的卡是直接放行显示的**，所以换号的卡会立刻出现在信息流里，
只是少了分批放出的延迟。这是既有行为（校验拒收、近重复合并同样会造成计划与实际不一致），
不在本单范围内。

### 4. 旁路 `savePosts` 的调查结论：没有同样的洞

- 连接播报卡的编号是 `connection-note-<hash(旧卡+新卡+证据+理由+生成时间)>`
  （`connectionNotes.ts:390-394`），带时间戳，撞不上。
- 笔记卡编号是 `<导入记录号>-<类型>`（`shared.mjs:236`），导入记录号本身唯一。
- 真实数据实测：库内 100 张卡编号零重复，8 张旁路卡无一撞车。

**结论：不需要跟进单。**

### 实测效果（真实快照只读回放）

历史上 34 个卡片版本被顶掉，按来源拆分：

- **30 个来自不同来源 → 修复后会被保住**（含 `post-ai-agent-durable-knowledge-001` 一个编号保住 10 张）。
- 4 个来自同一来源的重新生成 → 仍然替换，这是对的。

## 假设与开放问题

- **假设**（用户可推翻）：换号策略优于拒收。理由是拒收会丢掉真实内容，
  换号则把"是否重复"的判断交还给已有的近重复合并逻辑。
- **假设**：同来源替换是正确行为。若发现同来源替换也在丢内容，停下来在汇报里说明，不要顺手改。
- **开放**：旁路 `savePosts` 是否有同样的洞——本单只调查不修。
