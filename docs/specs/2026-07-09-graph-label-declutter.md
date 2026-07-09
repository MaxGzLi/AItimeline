# 图谱标签防叠印:让图谱 tab 可读

## 问题

用户反馈图谱 tab「非常模糊并且不可读」。诊断(读 `apps/web/src/components/LinkedGraphCanvas.tsx`):

- **不是 DPR 渲染问题**:画布 backing store × devicePixelRatio、CSS 100% 都正确(draw() 352-355 行)。
- 真因:draw() 第 426 行,**概念/ghost/idea 节点的标签无条件常亮**;真实库已有 190+ 概念,fit-to-view 又把全图塞进 70vh 面板(scale<1),标签互相叠印——截图里「糊掉的字」实际是多串文字打在同一位置;灰色边线再从文字底下穿过,进一步压低可读性。
- 标签固定 11px、无避让、无随缩放分级;放大(wheel zoom 已有)后标签也不会变多变少,始终全量叠印。

## 方案

全部改动收在 `LinkedGraphCanvas.tsx` 的 draw() 里,零新依赖,不动力导引布局与交互:

1. **标签碰撞剔除(核心)**:节点绘制循环里不再直接画标签,收集「应显标签」的候选后按优先级排序——hover 节点及其直接邻居(经 graphRef 的边)最高,其余按 weight 降序、id 升序兜底;逐个用 `ctx.measureText` 算屏幕包围盒(含 halo 余量),与已放置盒相交的**跳过不画**。缩放放大后节点散开、碰撞减少,可见标签自然渐进变多——LOD 免费获得。
2. **文字 halo**:每个标签 `fillText` 前先用背景色 `strokeText`(lineWidth≈3),边线不再穿字。
3. **像素对齐**:标签坐标 `Math.round`,消半像素发虚。
4. hover 节点标签保持必显(现状),其邻居标签提到最高优先级一档。
5. 字号维持 11px 不随缩放变(X 风格小字,避免缩放时文字跳动)。

card/note 节点标签仍仅 hover 显示(现状不变)。

## 明确不做

- 不改力导引布局算法、不做节点过滤/聚类面板、不加缩放控件。
- 不动 `packages/core`、`apps/api`;无 smoke 变化(纯 canvas 绘制逻辑)。
- 不加依赖;不改 xshell.css(halo 用画布内背景色,不需要样式)。
- 详情页局部小图(`.x-localgraph` 复用同组件)行为随之受益,不单独定制。

## 验证标准

1. `npm run typecheck` / `npm run build` / `npm test` 全绿。
2. 沙盒真实数据(190+ 概念)截图对比,放 `docs/e2e/runs/2026-07-09-graph-label-declutter/`:
   - fit 初始视图:无任何两个标签叠印;可见标签为高权重子集;
   - 滚轮放大一档后:可见标签数量明显增多;
   - hover 某节点:该节点及邻居标签必显且高亮;
   - 暗色主题一张(halo 用的是主题背景色,两种主题都不能有「白边」感)。
3. 设计语法审:X 风格扁平,不引入卡片/阴影/图例框。
