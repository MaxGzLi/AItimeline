# 跟进卡不得泄漏内部指令

## 背景

后台策展生成「跟进卡」时,`followupHarness.ts` 的 `createFollowupChunks` 把给模型的内部指令(learning goal、"Seed grounding: …"、"User signal reason: …"、"The generated post must cite this chunk…")拼成合成来源块;该块同时是卡片的落地来源,确定性降级路径直接把指令文本变成了用户可见的正文。用户已在真实使用中看到提示词原文,体验不可接受。

## 目标

用户在任何界面看到的跟进卡正文(title/hook/thesis/shortBody/summary/keyTakeaway/thread 各块),只包含**面向学习者的内容**,永不出现指令性/元数据文本。

行为规则(用户已拍板):

1. **找得到种子帖**:跟进卡的落地来源块只由种子帖的真实内容构成(其标题、要点、正文文本);内部指令(意图、学习目标)不进入来源块,只作为运行参数传给 runner(模型路径进提示词,确定性路径进代码逻辑)。
2. **找不到种子帖**:不生成跟进卡。改为产出一条来源发现候选(复用既有 sourceDiscovery 提案机制),说明「为概念 X 需要新来源」;发现机制不可用时,该 job 以明确状态结束(不产卡、不报错崩溃)。

## 不做

- 不改跟进卡的触发策略(何时生成、频率、冷却)。
- 不改模型 runner 的调用协议。
- 不动 apps/web / apps/mobile(另一任务在改 web,严禁触碰)。
- 不改落地校验(grounding gate)本身的算法。

## 验收清单

- [ ] 有种子帖时:生成的跟进卡各文本字段不含 "Seed grounding" / "User signal reason" / "must cite this chunk" / "Deeper angle" 等指令句式;来源块内容全部可溯源到种子帖文本
- [ ] 无种子帖时:不产卡;产出一条发现候选(或明确的跳过状态),job 正常完结
- [ ] 落地校验仍通过:跟进卡 citations 指向其来源块,grounding 校验为 valid
- [ ] smoke 断言覆盖上述三条(含反向断言:正文 grep 不到指令片段)
- [ ] `npm run typecheck && npm run build && npm test` 全绿
- [ ] diff 限于 packages/core + scripts/(smoke)+ 本 spec 所在 docs/

## 假设与开放问题

- 假设:确定性路径下,种子帖内容足以拼出合格的跟进卡(hook/thesis 等由种子文本变换而来);拼不出合格卡时按「无种子」分支处理(用户可推翻)。
- 开放:历史已生成的脏卡是否清洗?本任务不处理,交由用户决定(数据在本地 JSON,可手动删)。
