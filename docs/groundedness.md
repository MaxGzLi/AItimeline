# Groundedness: 正确性保障体系

前提要诚实：**"绝对正确、零幻觉"不是可实现的工程承诺**。错误有三个来源——模型生成幻觉、来源本身错误、转换时断章取义。系统能承诺的是：每句话可溯源、可核对；高风险声明强校验；错误能被发现并纠正；错误率可度量。产品对外也按此表述，这是信任层面的差异化，不是妥协。

## 已有防线

1. 模型输出一律当不可信 JSON：schema 校验 + 完整重写修复循环（`harness/modelRunner`）。
2. 引用必须真实：citation 的 sourceId/chunkId 必须能在 SourceRegistry 解析（chunkId 已收紧为必填）。
3. Grounding gate：`source_fact` 声明与被引 chunk 的词面重叠不达标则整帖拒绝（`harness/groundingGate`）。
4. 数字硬校验（L1，已实现）：`source_fact` 里的数字/百分比/年份必须逐字出现在被引证据中，否则 fail——词面重叠抓不住"改数字"这类最恶性幻觉，此门专治它。
5. 证据台账：每条声明对应的原文证据可展示（`harness/evidenceLedger`）。
6. 问答限定被引 chunk（`harness/askGrounded`），无模型时回退纯抽取式——确定性路径构造上不产生幻觉。

## 已知局限（未设防处）

- 词面重叠 ≠ 语义蕴含：换否定词、调换主客体等改写可保持高重叠。→ L2 蕴含校验
- `interpretation` 类只警告不拦截。
- 来源本身的错误不设防（忠实转述错误）。→ L4 多源互证
- 专有名词（人名/机构名）尚无类似数字的硬校验。

## 分层加固路线

| 层 | 内容 | 状态 |
| --- | --- | --- |
| L1 | 高风险 token 硬校验：数字/百分比/年份逐字比对证据，不匹配即拒 | **已实现**（groundingGate + 冒烟覆盖） |
| L2 | 蕴含校验：第二个模型当审稿人，对每条 `source_fact` 判 support/contradict/neutral，contradict 即拒；走 ModelClient 接口，无模型时跳过 | 规划（下个 Sprint） |
| L3 | 先摘录后转述：生成协议要求先给逐字 quote（substring 可验真），再基于 quote 改写，改写与 quote 做 grounding | 规划 |
| L4 | 来源层信任：域名/作者信誉分；同一 fact ≥2 独立来源 → `supported`，单源 → `emerging`，冲突 → `contested` + 观点对照卡；trustState 由规则计算而非模型自报 | 随多源功能 |
| L5 | UI 诚实：每句可点开看原文证据（ledger 数据现成）、confidence 可视、"AI 转述，点此核对原文"明示、时间戳直跳原片 | 部分已有 |
| L6 | 用户纠错回路：卡片"报错"→ 标记 claim → 复核 job → 下架/修正 + 来源信誉降分；"每百卡报错数"为核心质量指标 | 规划 |
| L7 | 评测基线：人工核对的 golden set，改 prompt/换模型/调阈值必跑回归（grounding 通过率、L2 拒绝率、抽检错误率） | 规划 |

## 原则

- 验收门只增不减：任何新生成路径（skill、chat、深研）都必须过同一套 harness 验收门，没有旁路。
- 无模型可运行：每层校验在无模型配置时要么确定性执行（L1/L4/L5），要么显式跳过（L2/L3），不得静默降级已有保障。
- 呈现即保障的一半：不装作绝对正确；让用户一键核对，偶发错误才是可原谅的。
