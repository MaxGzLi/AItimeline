# ✕ 退场生命周期修缮:软硬分层 + 撤销 + 退场列表

## 背景与问题

现状(已核实):`POST /api/posts/:id/dismiss`(apps/api/src/server.mjs:146-149)把 postId 加进快照的 `dismissedPostIds` 字符串数组,**永久生效**;时间线组装(packages/core/src/ranking/lifecycle.ts:31)和复习到期(server.mjs:155-157)都会过滤它。没有撤销、没有可见的退场列表、没有恢复路径。用户按 ✕ 想表达的往往只是「现在别烦我」,系统理解成「此生不见,连复习也取消」,且误操作不可恢复。

## 设计

### 1. 数据模型:dismissedPostIds 升级为带元数据的记录

快照字段 `dismissedPostIds: string[]` 替换为:

```ts
dismissedPosts: Array<{
  postId: string;
  dismissedAt: string;      // ISO
  mode: "soft" | "hard";
}>
```

- **旧快照迁移**:persistenceStore 加载时把旧 `dismissedPostIds` 数组转成 `mode: "hard"`、`dismissedAt = 快照 savedAt` 的记录(保持旧数据现有语义不变);写盘只写新字段。schema 在 `packages/core/src/storage/persistenceStore.ts`。
- 同一 postId 重复 dismiss 时更新记录(升 hard 或刷新时间),不追加。

### 2. 语义分层

- **soft(默认,✕ 按钮触发)**:退出时间线 **30 天**(`dismissedAt + 30d` 后自动恢复参与排序);**复习不受影响**(复习到期过滤只排除 hard)。
- **hard(仅退场列表里可执行)**:等同现状——时间线与复习永久排除。
- lifecycle.ts 的过滤逻辑接收新结构:soft 且未过期 → 滤;soft 过期 → 不滤;hard → 滤。复习过滤(server.mjs:155-157)只对 hard 生效。

### 3. 撤销与恢复

- 新端点 `DELETE /api/posts/:id/dismiss`(或 `POST /api/posts/:id/undismiss`,二选一,风格与现有路由一致):移除记录,立即恢复。
- 新端点 `GET /api/dismissed`:返回退场记录列表(含卡片摘要:id/title/mode/dismissedAt),给退场列表页用。

### 4. Web

- ✕ 点击后:卡片立即离场(沿用现有 locallyRemovedIds 机制),同时出现 **toast「已退场 · 撤销」,停留 8 秒**;点撤销调恢复端点并把卡放回原位。toast 样式贴 X 的底部黑条风格(见 docs/ 设计语法:扁平、贴左)。
- 设置页新增「已退场卡片」区块(SettingsView):列表显示 title/退场时间/mode,每行「恢复」按钮;soft 行显示「N 天后自动回归」;行内可「永久退场」(hard 化,唯一入口)。
- i18n:所有新文案进 `apps/web/src/lib/i18n.ts`,zh/en 成对(英语模式已上线,缺一即门禁)。

### 5. 给后续任务留的数据面(只留接口,不做行为)

- 退场记录(含 dismissedAt/mode)可被查询——后续「连接播报」要用它做「唤醒退场卡」。本任务不实现任何唤醒逻辑。

## 明确不做

- 不做任何「唤醒/复活播报」行为(spec ② 的事)。
- 不改排序算法、复习调度算法本身,只改过滤条件。
- 不动通知系统(尚不存在,spec ① 的事)。
- 不迁移/清洗现有用户数据文件(apps/api/data/ 是 gitignored 本地数据,迁移逻辑在加载路径里自动兼容即可)。

## 验证标准

1. `npm run typecheck` / `npm run build` / `npm test` 全绿。
2. smoke-api 扩展断言(硬要求):dismiss 默认 soft 且时间线消失;复习到期仍含 soft 卡、不含 hard 卡;undismiss 后时间线恢复;`GET /api/dismissed` 返回记录;**旧格式快照(dismissedPostIds 数组)加载后行为等同 hard**;soft 过期(用注入的 now 模拟 31 天后)自动回归时间线。
3. UI 截图(验收人负责拍,执行者留好可复现的操作路径说明):✕ → toast 撤销;设置页退场列表 + 恢复。
