# 来源质量门禁 + 消费节流 + 真深挖

## 背景与目标

真模型跑通后暴露的第一优先级问题(用户拍板为主项):

1. **垃圾进,带引用的垃圾出**。Tavily 搜回的 SEO 水文(例:「Grok Advanced Guide」空洞营销文)被完整做成引用规范、账本全过的知识卡;grounding 门禁只保证「说的话有出处」,不保证「出处值得学」。垃圾卡的空洞概念(Mindtagger、Domain Knowledge)又成为下轮 discovery 搜索词,垃圾复利。
2. **看内容本身就在花钱且无上限**。停留+展开卡=兴趣信号→当场派 discover/import/followup 任务(实测看一张卡派生 6 个任务);正常阅读=持续消费,没有预算节流。
3. **「深入」按钮承诺深化,兑现复读**。continue_deeper 跟进卡从同一来源的切片再榨一张,材料早已用尽,产出注水,还挤占消费预算。
4. 不同搜索词捞回同一批内容各自成卡(「DeepSeek-V3 以 2.788M H800 GPU 小时…」同句出现在三张卡),没有内容级去重。

## 设计

### 1. 来源质量门禁(core + api)

- 新模块 `packages/core/src/source/sourceQualityGate.ts`:对「已抓取正文、尚未生成卡片」的来源做评估,输出 `{score: 0-1, verdict: "accept"|"reject", reasons: string[]}`。
- **模型路径**:一次轻量调用,输入 = 来源标题 + 正文抽样(首/中/尾各一段)+ 用户当前概念列表(memory/topicStates),让模型按三维打分:内容密度(有无具体机制/数据/可验证主张)、与用户知识图谱的相关性、来源类型可信度(论文/官方文档/技术博客 > 营销页/SEO 列表文)。提示词里给「reject 示例」(通篇口号、无具体主张、关键词堆砌)。
- **确定性 fallback(无模型时,smoke 必须走通)**:启发式打分——正文长度、链接/正文比、标题党特征(如 "Ultimate Guide"、"Mastering")、与用户概念的词面重叠。阈值宽松(只拦明显垃圾),不误伤。
- 接入点:`sourceImportWorker` 生成卡片**之前**;reject 的来源记录为 `rejected_source` 候选(带 reasons,可在智能体页看到「为什么没成卡」),不产卡、不入图谱、不派后续任务。
- reject 不重试;同 URL 二次导入直接复用上次 verdict(按 URL 缓存在快照里)。
- **用户手动导入的 URL 不走门禁**(用户明确要的就给做,最多在卡上带低分提示);门禁只管 discovery/自动 import 路径。

### 2. 近重复内容去重(core)

- 生成卡片后、入库前:新卡 summary/keyTakeaway 与库内已有卡做词面相似度(现有 normalized-title 去重的延伸,不引入 embedding 依赖);超阈值(如 0.8)判定近重复。
- 近重复处理:不另立新卡,把新来源追加到已有卡的 sources/citations(内容合并不改已有正文),时间线不新增条目;记录 `merged_into` 供排查。
- 现有 followup 的 normalized-title 去重保留不动。

### 3. 消费预算节流(api + 少量 web)

- 兴趣信号派生的自动任务(discover_sources / import_source / generate_followup)记入**每日预算**(快照里按日计数);默认上限:每日 20 个自动任务(env 可调 `AITIMELINE_DAILY_AUTO_JOB_BUDGET`)。超限后信号照记、任务不再入队(丢弃并计数,不积压债务)。
- **显式动作不占预算**:用户手动导入、手动跑一批、提问闭环、想法研究、以及本 spec 第 4 条的「深挖」——用户自己点的按钮,花钱知情。
- discovery 搜索词收紧:只使用用户交互确认过的概念(点赞/收藏/提问涉及的概念,或 topicStates 里的既有话题),**不使用新导入卡自带的未验证概念**——切断垃圾复利链。
- web:顶栏药丸的排队数旁加「今日已用 N/M」小字(现成 i18n 双语)。

### 4. 「深入」升级为真深挖(core + api)

- continue_deeper 意图不再从同一来源切片榨跟进卡,改派**深挖任务**:以该卡核心概念为搜索词 discover 新来源 → 走第 1 条门禁择优(优先论文/官方文档)→ import 成卡;卡的 recommendedBecause 明确写「你在《旧卡标题》点了深入」;hook 第一句接住已知(「你已经知道 X,这张讲 X 底下的 Y」——提示词要求,确定性 fallback 用模板)。
- 找不到合格新来源时:退回旧行为(同来源跟进卡)并在 recommendedBecause 说明「没找到更好的来源」。
- 深挖任务显式触发、不占每日预算(见第 3 条)。

## 明确不做

- 不引入 embedding/向量库等新依赖;相似度全用词面方法。
- 不做域名黑白名单的管理界面(启发式里可以硬编码少量明显信号,但不做配置系统)。
- 不动 grounding 门禁本身(引用校验、数字红线维持现状)。
- 不动 web 时间线渲染与生命周期逻辑;web 改动仅限顶栏预算小字与智能体页 rejected 来源列表。
- 不做回溯清理(已入库的垃圾卡不删,用户自己 ✕ 掉;本 spec 只管增量)。

## 验证标准

1. `npm run typecheck` / `npm run build` / `npm test` 全绿。
2. smoke 扩展(硬要求,加在 `scripts/smoke-core.mjs` / `smoke-api.mjs`):
   - 门禁确定性路径:一篇构造的 SEO 水文 fixture 被 reject(带 reasons);一篇正常技术文 fixture 通过。
   - 近重复:同一 fixture 两次导入只产一张卡,第二次来源并入。
   - 预算:把上限调成 1,连发两个兴趣信号,只入队一个任务。
   - 深挖:continue_deeper 意图产生 discover 任务而非同源跟进卡;无候选时退回同源路径。
3. 模型路径在汇报里给出真实调用一次的实录(输入摘要 + verdict),验收人在沙盒复验。
