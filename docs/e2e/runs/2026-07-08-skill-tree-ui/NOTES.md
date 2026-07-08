# 2026-07-08 技能树视图返工:分层格子 → 缩进列表树

验收返工单(#111 的 UI 形态被用户否决:概念名去空格粘连、断词乱换行、卡片格子不像树、层标题工程味)。

- `before-grid-light.png`:改前——「第 N 层」标题 + 卡片格子,`#Multi-headLatentAttention` 式粘连概念名。
- `after-tree-light.png` / `after-tree-dark.png`:改后——目标在顶,先决按真实依赖逐层缩进(竖向引导线),概念名保留空格,右侧「目标/必修/选修」小字标注。
- `after-tree-gaps-mastered.png`:缺口=黄色虚线下划线 + ⚠缺口;已掌握=灰名 + 绿勾;菱形依赖重复出现的节点降透明度不再展开。
