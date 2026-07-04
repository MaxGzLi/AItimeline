# 「为这个问题找来源」可点击(知识拓展闭环)

## 背景

问知识库之外的问题时,观察员回复「建议先去找相关来源」并展示「为这个问题找来源」chip——但该 chip 是纯展示的 span,点不了;且未配置搜索服务时整条链路静默失败。用户反馈:知识不拓展,闭环断了。

## 目标

1. 回复里 `discover_sources` 动作 chip 变为可点按钮:点击 → 调用新端点 POST `/api/discovery/run`(body: queries/concepts,来自动作本身)。
2. 端点行为:未配置搜索服务 → `{configured:false}`;已配置 → 跑 runSourceDiscovery,候选持久化(与既有 executeDiscoveryAction 同一套),返回候选。
3. UI 状态闭环(chip 下方一行反馈):
   - 搜索中:chip 显示「正在找来源…」并禁用;
   - 找到 N 条:「找到 N 个候选来源 · 去「发现」整理」(点击切到发现页;snapshot 已刷新,候选可见);
   - 没找到:「没有找到新的来源,换个问法试试」;
   - 未配置:「还没配置搜索服务(.env 的 AITIMELINE_SEARCH_API_KEY),先手动导入来源」+「去导入」按钮(切到智能体页);
   - 出错:显示错误信息。
4. 其他动作 chip(开学习系列等)保持现状(v2 再接)。

## 不做

- 不改 conversationAgent 的动作生成逻辑;不改问答本身。
- 不动 packages/core、apps/mobile。
- 不做搜索服务的 UI 配置界面(key 仍走 .env)。

## 验收清单

- [ ] 未配置 key:点 chip → 提示未配置 + 「去导入」按钮可跳智能体页;不报错
- [ ] 已配置 key(smoke 用假 provider):POST /api/discovery/run 返回候选并持久化,发现页可见
- [ ] 空 queries+concepts → 400
- [ ] smoke-api 覆盖:未配置分支 + 注入 stub provider 的已配置分支
- [ ] `npm run typecheck && npm run build && npm test` 全绿
- [ ] 截图:chip 可点态 + 未配置提示态(明色即可)

## 假设

- 假设:每次点击重新搜索(不去重节流),候选持久化层自会按 URL 去重(用户可推翻)。
