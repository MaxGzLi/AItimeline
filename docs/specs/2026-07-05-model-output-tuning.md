# 模型输出调参:修截断与英文漂移

## 背景

导入论文摘要(密集内容)时暴露两个问题:

1. **截断**:客户端不传 `max_tokens`(可选项从未设置),提示词又允许一次最多 `maxPostsPerRun: 12` 张卡 → DeepSeek 生成的 JSON 在 ~28k 字符处被输出上限截断 → 解析失败,修复重试同样截断 → 整次导入 0 张卡(真实发生:arxiv 2603.07670)。
2. **英文漂移**:另一次导入(arxiv 2512.13564)产出 8 张卡全为英文近逐字抄写——在「必须过 grounding 重叠」与「输出预算紧张」双重压力下,模型放弃中文改抄原文最安全。

## 目标

1. **max_tokens 可配置且有默认**:`createOpenAICompatibleModelClientFromEnv` 读 `AITIMELINE_MODEL_MAX_TOKENS`(正整数,非法值忽略),默认 8192;`.env.example` 补该变量注释。
2. **降低单次产卡上限**:`maxPostsPerRun` 默认 12 → 4(runner 与 modelRunner 的默认配置同步);提示词里 "Produce at most N posts" 跟随配置,无需另改。
3. **语言方针强化**(三处系统提示词同步):在既有 Language policy 中增加一条——除引用字段(citations 的 quote)外,禁止逐字照抄出处句子;解释性文字必须用自己的话以中文表达,同时保留关键英文术语。
4. **截断的修复提示**:modelRunner 的修复循环里,当失败原因是 JSON 解析错误时,修复消息追加指示:输出被截断了,请减少卡片数量、缩短每张卡,确保 JSON 完整闭合。

## 明确不做

- 不改 grounding gate;不改 schema;不动 UI/mobile;不碰 `.env` 真实文件。
- 不做流式输出、不做分批生成(未来优化)。

## 验收清单

- [ ] `AITIMELINE_MODEL_MAX_TOKENS` 生效(smoke:注入假 fetch 断言请求 body 含 max_tokens;未设 env 时默认 8192)
- [ ] `maxPostsPerRun` 默认 4;既有 smoke 不回归
- [ ] 三处提示词含「禁止逐字照抄」条款;smoke-model 既有语言断言仍过
- [ ] `npm run typecheck && npm run build && npm test` 全绿
- [ ] 真机(验收人):重导两篇 arXiv 论文,均产出中文为主的卡,无 0 卡、无整卡英文照抄

## 假设

- 默认 8192 对 DeepSeek 当前模型安全(超过其上限时服务端会自行钳制)。
- 每来源 4 张卡足够(质量优先于数量)。
