# 2026-07-09 graph-label-declutter 验收记录

用户反馈图谱 tab「非常模糊并且不可读」。诊断:非 DPR 渲染问题,而是 190+ 概念标签无条件常亮 + fit 缩放全图挤进 70vh,标签互相叠印、边线穿字。规格:`docs/specs/2026-07-09-graph-label-declutter.md`。

## 实测(真实快照 190+ 概念,沙盒 8798/5198)

- **fit 初始视图**:只显示高权重概念标签(约 50 个),零叠印;文字 halo 挡住穿字边线。对照「修复前」即用户 2026-07-09 反馈原图(全量标签叠印成糊)。
- **滚轮放大**:节点散开后低权重标签(Configuration/BEAM/FMOps/overfitting…)自动浮现,仍零叠印——碰撞剔除天然形成 LOD。
- **hover**:节点蓝圈 + 邻接边全部高亮,自身标签必显、邻居标签进最高优先档。
- **双主题**:halo 取主题背景色,暗色无白边、浅色无黑边。
- 设计语法:纯扁平,无新增控件/图例/阴影。

## 截图

- `gld-graph-fit-dark.png` — 暗色 fit 初始视图(修复后)。
- `gld-graph-fit-light.png` — 浅色 fit 初始视图。
- `gld-graph-zoom-dark.png` — 放大一段后,低权重标签渐进浮现。
- `gld-graph-hover-dark.png` — hover Mixture-of-Experts,邻域高亮。

## 已知边界(不阻塞)

- `graphSignature` 只含节点 id 串+边数:极端情形(节点集与边数都不变、仅边指向变,如笔记 wikilink 改指向)邻接表短暂过期,只影响 hover 邻居标签优先级,任一节点增删即自愈。
- `fitToView` 的包围盒仍按「全部标签显示」估算,剔除后 fit 视图右侧可能略留白,视觉可接受。
