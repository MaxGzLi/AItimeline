# Spec: 单测捞出的五个真 bug 一次清掉（2026-07-28）

## 背景

#140 落地 vitest 基座时锁现状测出五个真 bug（PR 描述与 docs/specs/2026-07-28-vitest-base.md 单列）。本单逐个修掉，让钉在测试集里的 expected-fail 翻绿。这批全是「门禁不够狠 / 白名单漏登记 / 文案匹配不上」型，与 bug 考古里 core「零算错」的结论一致。

## 设计

### 1. 门禁校验回帖引文真伪（groundingGate.ts）

- 现状：`validateGrounding` 完全不看 `thread[].citations[].quote`，伪造引文判 valid（groundingGate.test.ts 里 `it.fails` 钉着）。
- 修法：新增对每条 `post.thread[i].citations[j]` 的校验——凡带 `quote` 的引文，解析其 chunk（用第 5 条的版本感知解析），断言 quote 出现在 chunk 内容里。失败记 issue：path `$.thread[i].citations[j].quote`，severity error（拉 valid=false）。
- **容差规则（照合法生产方设计，不许拍脑袋）**：`askGrounded.ts` 的 `trimQuote` 会把空白折叠成单空格、超过 maxQuoteLength 时截断加 `...`。因此匹配前双方都做空白折叠；quote 若以 `...`/`…` 结尾先剥掉再做包含判断；比较不区分大小写。中英混排不做分词（是子串包含，不受词边界教训影响）。
- quote 缺失或 chunkId 解析不到 chunk 时的行为维持现状（本单只加「quote 存在且 chunk 可解析」时的真伪校验，不扩大立面）。
- 测试：把 `it.fails` 翻成 `it`；补一条合法路径——quote 取自 chunk 内容的截断+省略号形态，必须通过。

### 2. schema 白名单补 `conversation`（harness/schema.ts）

- `sourceTypes` 数组加 `"conversation"`（`transform/conversationImport.ts:79` 在产这个类型，types.ts 的 `SourceType` 联合里早有）。
- 测试：schema.test.ts 加一例——来源 type 为 `conversation` 的合法卡通过校验。

### 3. DNS 失败该退预算名额（apps/api/src/server.mjs）

- 现状：`guardedFetch.mjs:212` 抛「Fetch target could not be resolved.」（及 219 行「did not resolve to an IP address.」），`isNetworkFailureMessage` 的正则匹配不上 → 结算成不退名额的 `skipped`，违反 #136「没进模型的抓取失败退名额」的语义。
- 修法：正则加 `could not be resolved|did not resolve|dns` 三个候选（保持既有风格，加进现有 alternation）。
- 测试：`apps/api/test/classifyTerminalImportSource.test.mjs` 加两例——lastError 分别为上述两条 DNS 文案，断言 settlement `import_failed_refundable`、candidateStatus `unreachable`。

### 4. 复习排期去掉本地时区依赖（review/reviewState.ts）

- 现状：加间隔用本地 `getDate/setDate`，跨 DST 时区下同一 ISO 输入产生 ±1 小时漂移。
- 修法：改为纯毫秒运算 `dueAt = reviewedAt + intervalDays * 86_400_000`，与时区、DST 完全无关。
- 既有 ladder 测试（精确 ISO 断言、全是 24h 整数倍）在 UTC 下对新旧实现同值，天然锁住新行为；不必新增 DST 专项测试（vitest 全局 TZ=UTC 无法区分），实现以代码评审为准。

### 5. 出处校验尊重 chunk 版本固定（groundingGate.ts）

- 现状：gate 里两处 `getRegistryChunk(registry, citation.chunkId)`（约 170、395 行）直接读 live chunk，忽略 `citation.chunkVersionId`，与 `sourceRegistry.ts` 的 `resolveCitedChunk` 版本固定语义脱节（溯源链 W6-D 族）。
- 修法：两处换成 `resolveCitedChunk(registry, citation)`（已在同模块导出）。第 1 条的新校验同样用它。
- 测试：groundingGate.test.ts 加一例——registry 里 live chunk 内容已漂移，`chunkVersions` 存有旧版内容，citation 钉住旧版本 id：claim 在旧版内容里 → valid；再断言同一 claim 若只有 live chunk（不钉版本）→ invalid。两个方向都要，杀「换了函数但没生效」的变异。

## 明确不做

- 不动 `validateGrounding` 之外的门禁立面（卡片主体 claims 的校验逻辑本身不改，只换 chunk 解析函数）。
- 不改任何 smoke 脚本。**若门禁硬化导致既有 smoke 翻红，说明产线在产伪造引文——不许改 smoke 迁就，也不许回退硬化，停下来如实上报，由验收人裁决。**
- 不动 web、mobile。
- 不清洗存量数据（旧卡不回溯重验）。
- 不重构 guardedFetch 的错误分类为结构化传递（文案正则续命即可，结构化留给第三刀拆模块）。

## 验证标准

- `npm run typecheck` / `npm run build` / `npm test` 全绿。
- `npm run test:unit`：0 个 expected fail（原 `it.fails` 已翻正），新增测试全过。
- 四个 smoke 零 diff 且全过。

## 风险声明

- 门禁硬化后，今后凡产伪造回帖引文的路径会被当场拒——这是目的。合法生产方（askGrounded 从 chunk 内容截取）按容差规则不受影响。
- reviewState 改毫秒运算后，非 UTC 部署下 dueAt 与旧实现相差最多 1 小时（DST 交界），存量数据无需迁移。
