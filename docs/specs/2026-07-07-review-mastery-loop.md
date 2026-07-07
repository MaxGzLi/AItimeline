# 复习闭环修复:存量回填 + 掌握自动晋升

## 背景与目标

功能缺口第三单,技能树/学习目标的地基。实测数据:学习区 124 概念、已掌握 0、reviewStates 0 条。诊断出两个断点:

1. **数据债**:「点赞/收藏→创建复习状态」是 #94(2026-07-06 03:44)才有的,而用户全部 22 次点赞发生在此之前,没有回填——存量复习债是死的。
2. **机制缺失**:「已掌握」=`memory.knowledge.knownConcepts`,唯一写入路是用户手动编辑记忆(`/api/memory` edits)。复习完成(`/api/review/:id/complete`)只推进间隔和 comprehension 分,**没有自动晋升机制**。侧栏文案「复习过、互动多的概念」与实现不符。

目标:复习闭环端到端打通——点赞→复习状态→到期→复习→概念晋升「已掌握」→边界面板变化。

## 设计

### 1. 存量回填(api,惰性幂等)

- 挂在 `GET /api/review/due` 开头:扫快照里 liked/saved 的信号,postId 无对应 reviewState 且卡存在且非 connection_note 的,补建初始复习状态(`createInitialReviewState`,时间用信号的 createdAt——早该到期的立即到期);单次请求最多补 50 条防爆;幂等(有状态的跳过)。
- 不做一次性迁移脚本——惰性回填对任何旧数据用户都生效。

### 2. 掌握自动晋升(core + api)

- 新函数(core,建议 `packages/core/src/review/masteryPromotion.ts`):`evaluateMasteryPromotions(input)` 确定性规则,概念晋升条件(**全部满足**):
  - 该概念关联卡片中 ≥2 张的 reviewState `intervalDays ≥ 7`(即各通过了至少两轮复习);概念只有 1 张卡时放宽为该卡 `intervalDays ≥ 14`;
  - 该概念对应 topicState `comprehensionScore ≥ 0.7`;
  - 不在 knownConcepts 中,且不在**晋升黑名单**里(见下)。
- 接线:`POST /api/review/:id/complete` 成功后跑一次晋升检查(只查本次复习涉及的概念,不全库扫);晋升写入 `memory.knowledge.knownConcepts` + memoryEvent(kind 标注自动晋升,记录依据:N 张卡、间隔、分数)。
- **降级与黑名单**:用户在记忆页手动删掉某个自动晋升的概念 = 降级,同时记入黑名单(快照字段或 memoryEvent 推导),此后不再自动晋升该概念(用户说了算);手动添加不受影响。
- **晋升播报**:晋升时产生一条通知(现有 notifications 通道):「#概念 已进入已掌握:你复习了 N 次、跨 M 天」,纯模板 zh/en。不做新 UI。

### 3. 文案对齐(web,极小)

- 侧栏「已掌握」描述改为与机制一致的表述(i18n 双语),如「复习巩固后自动点亮,也可在记忆里手动管理」。

## 明确不做

- 不改复习间隔算法(`advanceReviewState` 维持翻倍节奏)。
- 不做「答错」路径(现在复习完成=通过;错题降级另立项)。
- 不做掌握度分级(只有 in/out,无青铜白银)。
- 不动时间线生命周期、推荐排序、预算。
- 不引入新依赖、无模型调用(全确定性)。

## 验证标准

1. `npm run typecheck` / `npm run build` / `npm test` 全绿。
2. smoke 扩展(smoke-api 为主):
   - 回填:构造带存量 liked 信号无 reviewState 的快照,请求 `/api/review/due` 后状态补齐且到期正确;二次请求不重复建(幂等);上限 50 生效;
   - 晋升:构造满足条件的复习历史,complete 后概念进 knownConcepts 且有 memoryEvent;不满足(间隔不够/分不够)不晋升;
   - 降级:手动删除后再次满足条件不回晋升(黑名单生效);
   - 旧快照无新字段兼容。
3. 验收人在沙盒(拷贝真实数据)端到端走一遍:回填 22 条 → 复习几张 → 概念晋升 → 边界面板「已掌握」数字变化 + 通知出现。
