# 每周长势回顾:时间线特殊卡 + 概念趋势图 + 可分享

## 背景与目标

用户确认的功能缺口第一单。定案:**不做新入口**,周报以时间线特殊卡的形式送上门(类比 X 的年度回顾帖);核心传播点是一张**概念累积趋势图**;**零模型成本**,纯快照统计,确定性生成。

## 设计

### 1. 周报数据(core:新模块 `packages/core/src/recap/weeklyRecap.ts`)

- `buildWeeklyRecap(input, weekStart)` 纯函数,输入 = 快照里的 posts/reviewStates/interactionSignals/topicStates(裁剪后的最小形状),输出:
  - `stats`:本周新卡数、新概念数(首次出现于本周的概念)、复习完成/到期数、互动最多的 top 3 概念;
  - `conceptTrend`:按天的**概念累积总数序列**(从库里最早一天到本周末,每天一个点),外加 `weekStartIndex` 标记本周段起点(前端高亮用);
  - `narrative`:2-3 句确定性模板叙述(zh/en 双语,由 contentLanguage 决定),如「本周 +12 个概念,复习完成 8/10,最活跃的是 #RAG」;数据为空/第一周时有合理的空态文案;
  - `id` 按 ISO 周编号(`weekly-recap-2026-W28`),幂等。
- 周定义:ISO 周(周一起算);「本周报」指**最近一个已结束的完整周**;库里数据不足一周时不生成。

### 2. 持久化与 API(storage + api)

- 快照新增 `weeklyRecaps: WeeklyRecapRecord[]`(含 `seenAt?`/`dismissedAt?`),normalize 向后兼容旧快照按空数组。
- `GET /api/recap/weekly?now=`:返回最近完整周的周报;快照里没有该周记录时现算并持久化(幂等,同周不重算);数据不足一周返回 `{recap: null}`。
- `POST /api/recap/weekly/seen`:标记已读(卡片折叠用)。

### 3. 时间线特殊卡(web)

- 时间线顶部(新内容药丸之下、第一张普通卡之上)渲染周报卡,条件:存在未 dismiss 的最近完整周周报。
- 卡内:标题「本周长势」+ narrative + **趋势图 canvas**(概念累积曲线,本周段高亮色,其余灰;x 轴只标周一日期,极简 X 风格,复用 `--x-*` 变量,浅深色主题都要对)+ 底部数字行(新卡/新概念/复习完成)。
- 关闭(✕)= dismiss 持久化,本周不再出现;下周新周报照常出。
- **分享**:复用 #103 分享出图管线的模式导出 PNG(**纯 canvas 2D 绘制,严禁 SVG foreignObject**——Chrome 会判 canvas 污染,这是踩过的坑);导出图 = 趋势图 + 数字行 + 品牌小字。
- i18n 双语齐全;组件内不得出现中文硬编码(只允许 i18n.ts)。

### 4. 不做模型路径

- 本单**没有模型调用**,narrative 全模板。这是有意为之:统计事实不需要生成,也不给幻觉留门。

## 明确不做

- 不做邮件/推送/定时器(服务端无定时器是既有架构,靠打开页面触发惰性生成)。
- 不做历史周报列表页(快照里留着记录,UI 只出最近一期;列表页等有需求再说)。
- 不做月报/年报。
- 不引入新 npm 依赖(图表手绘 canvas,不上图表库)。
- 不动推荐排序、生命周期、预算。

## 验证标准

1. `npm run typecheck` / `npm run build` / `npm test` 全绿。
2. smoke 扩展(smoke-core + smoke-api):
   - 构造跨两周的 fixture 数据,`buildWeeklyRecap` 统计数正确(新卡/新概念/复习数),`conceptTrend` 单调不减且 `weekStartIndex` 指向正确的天;
   - 同周二次调用 API 不产生重复记录(幂等);
   - 数据不足一周返回 null 不崩;旧快照无 `weeklyRecaps` 字段兼容。
3. UI 截图(验收人):时间线顶部周报卡(浅色)、趋势图本周段高亮可辨、分享导出的 PNG 打开核对。
