# 信息流知识图 P1:概念关系图主视觉(2026-08-02)

Spec: `docs/specs/2026-08-02-feed-knowledge-diagrams.md`(方案段 = 已批准设计)

## 这一版改了什么

- 没有原文图的卡,媒体位改画卡片自己的概念关系图:中心 = 卡片主概念,
  周围 = graphEdges 连出的概念,边上标关系词并带箭头(关系是有方向的)。
- 没有可用 graphEdges 的卡退化成 concepts 放射脑图(无关系词、无箭头);
  凑不满两个节点的卡不画图,保持纯文字。
- 布局是 core 里的纯函数 `layoutConceptMap`,以 postId 做种子,刷新不跳动;
  标签按字宽估算做包围盒碰撞剔除,撞了就剔掉 weight 低的节点。
- 图框与原文图框同宽同圆角同边框,但底色用 `--x-module` 跟主题走
  (原文图那块是强制白底,概念图不能强制)。

## 截图

| 文件 | 状态 |
| --- | --- |
| `card-dense-dark.png` | 边多的卡(8 条边、6 种关系),暗色 |
| `card-dense-light.png` | 同一张卡,亮色 |
| `card-sparse-dark.png` | 边少的卡(2 条边,中文概念),暗色 |
| `card-pair-light.png` | 只有一条关系的卡:横排成一句话,亮色 |
| `card-radial-dark.png` | 退化脑图卡(无 graphEdges,只有 concepts),暗色 |
| `feed-mixed-dark.png` | 混排:原文图卡 → 纯文字卡 → 概念图卡 → 纯文字卡,暗色 |
| `feed-mixed-light.png` | 同一段混排,亮色 |

亮/暗两组是真的两套主题,不是同一张图换名字:图框底色亮色 `rgb(247,249,249)`
(`--x-module` 亮)、暗色 `rgb(22,24,28)`(`--x-module` 暗);页面底色亮色纯白、
暗色纯黑。

## 复现步骤

全程零外网。端口用 8788(API)/ 8901(夹具站)/ 5174(Vite),不碰 8787/5173 和
`apps/api/data/`。

```bash
npm install
npm run build -w @aitimeline/core

# 1. 起本地夹具站
node docs/e2e/media-fixture-host.mjs 8901

# 2. 起独立数据目录的 API(worker 关掉)
DATA=$(mktemp -d)
PORT=8788 AITIMELINE_WORKER=0 AITIMELINE_ALLOW_PRIVATE_FETCH=true \
AITIMELINE_CORS_ORIGINS=http://127.0.0.1:5174 \
AITIMELINE_DATA_PATH=$DATA/aitimeline.json \
AITIMELINE_CURATION_DATA_PATH=$DATA/curation-jobs.json \
AITIMELINE_MEDIA_ROOT=$DATA/media \
node apps/api/src/server.mjs

# 3. 导入六篇夹具文章
for p in plain-3 plain-2 plain-1 figure portrait hero; do
  curl -s -X POST http://127.0.0.1:8788/api/import/article \
    -H 'content-type: application/json' \
    -d "{\"url\":\"http://127.0.0.1:8901/article/$p\"}" > /dev/null
done

# 4. 关掉 API,给快照里的卡手工补 concepts/graphEdges,再起 API
#    (无模型的确定性导入每张卡只出 1 个概念,概念图会全部退化;
#     真实卡片带的是多概念 + 多条边,所以截图前要把夹具补成那个形状)
# 5. 起 Vite
VITE_AITIMELINE_API_URL=http://127.0.0.1:8788 npx vite apps/web --port 5174 --strictPort

# 6. 截图(LIGHT=1 / DARK=1 决定主题,VIEWPORT=1 只截可视区)
VIEWPORT=1 DARK=1 node docs/e2e/cdp-shot.mjs card-dense-dark.png \
  'http://127.0.0.1:5174/?e2eScroll=find:Alias%20handling' 1000 700 \
  docs/e2e/interactions/feed-scroll.js
```

第 4 步的补丁脚本没进仓库(一次性夹具数据),形状照 `packages/core/src/types.ts`
里的 `KnowledgeGraphEdge`:`sourceConcept -relation-> targetConcept` + evidence + weight。

## 本轮给 docs/e2e 加的东西

- `interactions/feed-scroll.js` 多了两种目标:`diagram[:n]`(概念图卡)与
  `find:<文本>`(滚到第一张含该文本的卡)。#146 之后每次页面加载都会在分数窗口内
  轮换卡片顺序,按序号定位不再稳,`find:` 才是可复现的定位方式。
