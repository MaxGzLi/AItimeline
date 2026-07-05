# 内容语言门禁:中文占比不达标进修复循环

## 背景

语言方针只写在提示词里,DeepSeek 会按次漂移:同一套提示词,一篇论文导入产出中文卡,另一篇全英文照抄。产品要求「中文为主、术语保留英文」必须像 grounding 一样是**硬性校验**,不是建议。

## 目标

1. **CJK 占比检查(纯函数)**:对一段文本统计 CJK 字符占「CJK+拉丁字母」的比例(忽略数字、标点、空白)。中文为主+英文术语的句子实测比例 ≥0.5,全英文为 0。阈值取 0.3。
2. **模型产出的语言校验**(只作用于模型路径,确定性回退不受影响):
   - 检查字段(用户阅读面):title、hook、thesis、shortBody、keyTakeaway、summary、thread[].body、reviewPrompts[].prompt、recommendedBecause;
   - 不检查:citations(引用原文)、concepts、graphEdges(概念名/证据按方针保留英文);
   - 违规 → 校验 issue(severity: error,message 说明「必须以简体中文为主重写,保留英文术语」)→ 走既有修复循环让模型重写。
3. **配置开关**:`AITIMELINE_CONTENT_LANGUAGE` 环境变量,`zh`(默认)| `none`(关闭);core 侧是显式 option(如 `contentLanguage?: "zh"`),默认关闭以保 smoke 网络隔离与回退路径不变;apps/api 从 env 读并传入,默认 `zh`。
4. **覆盖范围**:知识卡生成(modelRunner)与模型路径的跟进卡生成;askGrounded 若有同构的重试机制则一并接,没有就不做(在偏离清单说明)。
5. **兜底行为不变**:修复循环耗尽仍不达标 → 维持现状(按既有失败路径回退/记录),不新增行为。

## 明确不做

- 不改确定性回退;不改 grounding gate;不改 schema;不动 UI/mobile。
- 不做多语言偏好设置界面(env 足够,将来再挂设置页)。

## 验收清单

- [ ] CJK 占比纯函数的边界断言(全英文 0、中英混合、纯中文、空串/纯数字)
- [ ] smoke:stub 模型先吐英文卡 → 断言修复提示要求中文重写 → stub 再吐中文卡 → 最终通过
- [ ] 默认(不传 option)行为与现在完全一致,既有 smoke 全部不回归
- [ ] `npm run typecheck && npm run build && npm test` 全绿
- [ ] 真机(验收人):重导两篇 arXiv 论文各 2 次,产出全部中文为主(含标题)

## 假设

- 阈值 0.3 起步,后续可调;标题也在检查范围(此前标题常保持英文)。
