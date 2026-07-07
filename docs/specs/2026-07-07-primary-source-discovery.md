# 搜索去 GEO 化 + 主源优先 + 门禁识别二手复述

## 背景与目标

GEO 治理二期。#105 的门禁能拦空洞营销文,但用户实测反馈「搜索总能搜到 GEO 内容,DeepSeek 的文章也像 GEO」。排查确认三层原因:

1. **搜索词模板本身是 GEO 钓饵**(主因)。`planDiscoveryQueries` 写死 `"${concept} advanced deep dive"` / `"${concept} applications and comparisons"` / `"${concept} explained analysis"`——这些短语正是 GEO 农场的标题公式。铁证:库里被搜进过「Deep Dive - International Seabed Authority」(国际海底管理局)和斯坦福 DeepDive 项目页,纯词面撞车。
2. **门禁拦不住「合格的二手复述」**。「DeepSeek-V3 Explained」类文章是 LLM 复述官方技术报告,数字全对、机制词齐全,确定性门禁(密度)和模型门禁(具体主张)都放行。
3. **普通 discovery 没有主源偏好**。#105 只给深挖候选加了论文/官方文档加权(`scoreDeepDiveCandidate`),普通 discovery 的 `screenDiscoveredSources` 打分没有;库里外部域名主源占比不足 1/3。

## 设计

### 1. 搜索词去 GEO 化(core:`packages/core/src/discovery/sourceDiscovery.ts`)

- `planDiscoveryQueries` 模板替换:
  - `continue_deeper` → `${concept} paper`、`${concept} technical report`(每概念两条,总数上限不变);
  - `expand_broader` → `${concept} survey`、`${concept} applications`;
  - 默认 → 裸 `${concept}` + `${concept} benchmark`;
  - goal 查询(`${goal} ${concept}`)保留不动。
- **禁词清单**(写进代码注释与 smoke 断言):模板不得含 deep dive / advanced / explained / analysis / guide / mastering / ultimate。

### 2. discovery 筛选主源加权(core:同文件 `screenDiscoveredSources` 打分)

- 把 #105 深挖的 sourceTypeBoost + officialBoost 推广到 screening 的 qualityScore:arxiv.org / 官方 docs(docs.*、developer.*)/ github.com 加分;
- 已知聚合/农场域名减分(硬编码少量,沿用 #105「不做配置系统」约定):medium 系(towardsdatascience.com、pub.towardsai.net、ai.plainenglish.io、ai.gopubby.com、*.medium.com)、emergentmind.com、findskill.ai;
- URL→type 推断:arxiv/doi 链接标为 paper(若已有则复核)。

### 3. 门禁识别二手复述(core:`packages/core/src/source/sourceQualityGate.ts`)

- **确定性路径**:titleBait 词表补 "deep dive"、"explained"、"guide to" 及系列文模式(`Part N` / `第N部分` / `(2/5)` 类),命中减分,不单独毙——阈值 0.45 不动。
- **模型路径**:提示词加第四维「一手 vs 二手」——一手 = 论文/官方博客/作者本人/第一方实现;二手 = 转述他人成果。判定标准写清:**有原创分析、实验或综合的解读可以过**(如 Cameron Wolfe 的技术长文),纯复述且无增量信息的倾向 reject,理由须写明「二手复述」。
- reject 缓存、rejected_source 记录等机制复用 #105,不新增。

### 4. Tavily 域名排除(api:`apps/api/src/server.mjs` 的 search provider)

- Tavily 请求加 `exclude_domains`:上面第 2 条的聚合域名清单(同一份常量,core 导出 api 复用);
- provider 接口若不便传参,允许在 api 层包装;确定性 fake provider(smoke 用)不受影响。

## 明确不做

- 不做黑白名单管理界面/配置系统(硬编码少量域名,#105 同款约定)。
- 不引入新 npm 依赖。
- 不回溯清理存量卡(#105 同款)。
- 不动 grounding 门禁的引用校验与数字红线。
- 不动预算、深挖、近重复合并的现有行为(候选打分变化除外)。
- 不把「二手」做成一刀切毙——高质量解读必须能活。

## 验证标准

1. `npm run typecheck` / `npm run build` / `npm test` 全绿。
2. smoke 扩展(加在 smoke-core):
   - `planDiscoveryQueries` 三种意图的输出均不含禁词清单中的短语;
   - 同标题同正文下,arxiv URL 候选的 qualityScore 高于聚合域名候选;
   - 确定性门禁对 "X Explained Part 2" 式标题的 score 低于中性标题(减分可见),但单靠标题不触发 reject;
   - 网络隔离下全部通过。
3. 模型路径:汇报写清接线点;验收人真实调用复验一次「纯复述 reject / 原创解读 accept」。
4. 验收人用真实 Tavily 对比新旧搜索词各搜一次,定性记录返回质量差异(进 PR 描述)。
