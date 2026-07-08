# 2026-07-08 topic-blocks UI 验收记录

真实数据沙盒验收(快照复制自 `apps/api/data/`,API :8798 + Vite :5198,截图后已关停)。

## 截图

- `tb-dark.png` — 深色主题时间线:95 张卡组成 48 块,块首轻分隔行(主题名贴左,与连接播报同等克制度),相邻块主题交替;顶部 pill 行「全部 / DeepSeek-v3 / Meta-Pi Network / HPC Co-Design / 其他」。
- `tb-light.png` — 浅色主题同视图(keydown "t" 切换)。
- `tb-pill-filtered.png` — 点选「DeepSeek-v3」pill 后前端过滤:95 → 24 张,不打 API。

## 停留上报实测

真实浏览两张卡后抓 `/api/signals` payload:`dwellTimeMs` 分别为 11923ms / 13541ms(非零,120s 截断内);当日聚合注入后块序响应(dwellBoost 字段非零)。

## 已知说明

- dwell 信号为**每卡累计值多次重发**,服务端聚合按 postId 取当日最大再按主题求和(见 `aggregateTodayDwellMsByBlockTopic`),smoke-api 有双记录断言覆盖。
- impression 一次性信号恒 `dwellTimeMs: 0`(纯曝光契约,#94);真实 dwell 走 onDwell → 信号同步循环路径。
