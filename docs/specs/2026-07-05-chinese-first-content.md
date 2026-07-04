# 中文为主的知识卡内容(并让模型管线真正生效)

## 背景

用户反馈:生成的内容全是英文,「看的很费劲」;要求**中文为主,专业术语保留英文**。排查发现两个根因:

1. `apps/api` 的 dev 脚本是裸 `node src/server.mjs`,`.env` 从未被加载 → 模型管线从未启用,72+ 次 harness 运行全部 `runnerKind: deterministic`(逐句抽取英文原文)。用户实际配置了 DeepSeek(已验证端点 200 可用)。
2. 三个生成用系统提示词(卡片/跟进/问答)没有任何输出语言方针。

## 目标

1. **加载 .env**:`apps/api` 的 `dev` 脚本改为 `node --env-file-if-exists=../../.env src/server.mjs`(本机 Node v26,支持该 flag;文件不存在时静默跳过,CI/smoke 不受影响)。
2. **语言方针**:在以下三处系统提示词中加入一致的语言规则:
   - `packages/core/src/harness/systemPrompt.ts`(agentHarnessSystemPrompt)
   - `packages/core/src/harness/followupHarness.ts`(followupHarnessSystemPrompt)
   - `packages/core/src/harness/askGrounded.ts`(askSystemPrompt)

   规则内容(英文写入提示词,语义如下):
   - 所有面向用户的文字用简体中文;
   - 技术术语、专有名词、概念名保留英文原文(如 AI Agent、RAG、LLM),不翻译;
   - 引用来源原文(citations/quote)必须保持原语言逐字不动;
   - 数字必须与被引用的出处完全一致;
   - `concepts` 与 `graphEdges` 的概念名保持英文(图谱节点的连续性,和既有 #AIAgent 等节点对齐);
   - 每个 source_fact 字段(summary/thesis/shortBody/graphEdges.evidence)必须保留至少一个来自出处的英文关键术语或数字——这是 grounding gate 的词元锚点(gate 按拉丁词元算重叠,纯中文句会拿 0 分触发修复循环)。
3. **smoke 覆盖**:在 `scripts/smoke-model.mjs`(或最合适的 smoke)中断言三个系统提示词包含语言方针关键句(如 "Simplified Chinese"),防止将来被误删。

## 明确不做

- 不改确定性回退路径的行为(无模型时内容仍是来源语言,回退无法翻译)。
- 不重新生成已有的英文卡(可作为后续「重新生成」功能)。
- 不做多模型注册表/切换 UI(另行讨论)。
- 不动 grounding gate 的阈值和算法。
- 不动 apps/web、apps/mobile。

## 验收清单

- [ ] `npm run dev:api` 启动日志出现 `source import using model runner (deepseek-chat)`(在配置了 .env 的机器上)
- [ ] 三个系统提示词含语言方针;smoke 断言通过
- [ ] `npm run typecheck && npm run build && npm test` 全绿(网络隔离下,即回退路径不回归)
- [ ] 真机验证(验收人做):重启 API 后导入 fixture 或触发 curation,新卡 body 中文为主、术语英文、citations 原文逐字、grounding valid、runnerKind 不再是 deterministic

## 假设(用户可推翻)

- 简体中文为默认输出语言,暂不做语言偏好配置项(将来可挂到用户 memory/设置)。
- 概念名(#标签、图谱节点)保持英文。
