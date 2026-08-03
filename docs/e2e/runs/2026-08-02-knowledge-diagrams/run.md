# 信息流知识图 P1:概念图主视觉(2026-08-02,2026-08-03 硬化重拍)

Spec: `docs/specs/2026-08-02-feed-knowledge-diagrams.md`(方案段 + 《2026-08-03 硬化修订》= 已批准设计)

## 这一版改了什么

- 没有原文图的卡,媒体位画卡片自己的**概念放射图**:中心 = 卡片主概念,
  周围 = 该卡其余 `concepts`,线只是中心到周边的放射线。
- **不画关系词、不画箭头**(硬化第一刀):`graphEdges` 的关系端点不过接地门禁,
  全库 78% 的关系边两端概念不同时出现在自己的 evidence 里,extends/requires 有 92%
  的证据里找不到任何关系线索词,所以这层断言从主视觉上撤掉,理由见 spec 修订段。
- **周边概念不足 3 个的卡不画图**(硬化第二刀):一两个周边节点画出来是「一条横线
  加一个点」,标签和卡片正下方的概念标签一字不差,零信息增量却要吃掉卡片约 30% 的
  高度。真实快照 105 张非播报卡实测:门槛取 ≥3 时 85 张(81%)仍能画图、20 张退为
  纯文字;取 ≥2 只挡掉 5 张,挡不住这个毛病。碰撞剔除之后跌破 3 个的也一样退纯文字。
- 布局是 core 里的纯函数 `layoutConceptMap`,以 postId 做种子,刷新不跳动;
  标签按字宽估算做包围盒碰撞剔除,撞了就剔掉 weight 低的节点。
- 图框与原文图框同宽同圆角同边框,但底色用 `--x-module` 跟主题走
  (原文图那块是强制白底,概念图不能强制)。

## 截图

| 文件 | 证明什么 |
| --- | --- |
| `card-dense-dark.png` | 概念多的卡(9 概念 = 中心 + 8 周边)画出来什么样,暗色 |
| `card-dense-light.png` | 同一张卡,亮色 |
| `card-radial-dark.png` | 中等密度卡(6 概念)画出来什么样,暗色 |
| `card-floor-light.png` | **新的稀疏下限**:周边正好 3 个的卡(4 概念),亮色 |
| `card-sparse-dark.png` | **闸门生效**:3 概念(周边 2 个)的中文卡现在是纯文字,暗色 |
| `card-pair-light.png` | **闸门生效**:2 概念(周边 1 个)的卡现在是纯文字,亮色 |
| `feed-mixed-dark.png` | 混排:原文图卡 → 密集概念图卡 → 下限概念图卡 → 纯文字卡,暗色 |
| `feed-mixed-light.png` | 同一段混排,亮色 |

`card-sparse-dark.png` / `card-pair-light.png` 是同两张卡的「之前有图、现在没图」对照位:
上一版这两张拍的就是它们的稀疏图,这一版拍的是它们退成纯文字的样子。
`card-radial-dark.png` 更早的说明是「退化脑图卡(无 graphEdges,只有 concepts)」;
硬化之后没有「关系图 / 退化脑图」两种模式了,所有概念图都是同一种放射图,所以这张
改代表中等密度(6 概念、200px 档的图框高度)。

亮/暗两组是真的两套主题(逐像素比对过):页面底色亮色 `rgb(255,255,255)`、
暗色 `rgb(0,0,0)`;图框底色亮色 `rgb(247,249,249)`(`--x-module` 亮)、
暗色 `rgb(22,24,28)`(`--x-module` 暗)。

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

# 4. 关掉 API,给快照里的四张卡手工补 concepts,再起 API
#    (无模型的确定性导入每张卡只出 1 个概念,概念图会全部退化;
#     真实卡片带的是多概念,所以截图前要把夹具补成那个形状)
#      article-a8b9ba08-post-3 → 9 个概念(密集)
#      article-03ec9123-post-2 → 6 个概念(中等)
#      article-a8b9ba08-post-4 → 4 个概念(正好卡在下限:周边 3 个)
#      article-a9b9bb9b-post-2 → 3 个中文概念(周边 2 个,应当退纯文字)
#      article-b422c800-post-2 本来就带 2 个概念(周边 1 个,应当退纯文字),不用补
# 5. 起 Vite
VITE_AITIMELINE_API_URL=http://127.0.0.1:8788 npx vite apps/web --port 5174 --strictPort

# 6. 截图(LIGHT=1 / DARK=1 决定主题,VIEWPORT=1 只截可视区)
VIEWPORT=1 DARK=1 node docs/e2e/cdp-shot.mjs card-dense-dark.png \
  'http://127.0.0.1:5174/?e2eScroll=find:Alias%20handling' 1000 700 \
  docs/e2e/interactions/feed-scroll.js
VIEWPORT=1 LIGHT=1 node docs/e2e/cdp-shot.mjs card-floor-light.png \
  'http://127.0.0.1:5174/?e2eScroll=find:Once%20edges%20are%20cited' 1000 660 \
  docs/e2e/interactions/feed-scroll.js
VIEWPORT=1 DARK=1 node docs/e2e/cdp-shot.mjs feed-mixed-dark.png \
  'http://127.0.0.1:5174/?e2eScroll=find:An%20AI%20Agent%20that%20answers' 1440 2400 \
  docs/e2e/interactions/feed-scroll.js
```

第 4 步的补丁脚本没进仓库(一次性夹具数据),只改 `posts[].concepts` —— 硬化之后
概念图只读 `concepts`,`graphEdges` 一个字段都不看,夹具里那几条边原样留着,
正好也证明了图不再从关系边取数。

`find:` 的关键词要挑卡片独有的:连接播报卡会原样引用别的卡的标题,拿标题当关键词
会滚到播报卡上(第一次拍 `card-pair-light` 就踩了这个,改用正文里独有的
`buckets as Memory updates` 才对)。另外每次页面加载卡片顺序会在分数窗口内轮换,
混排首屏那张要先探一次当次顺序(用一个返回「卡片种类序列」的 eval 脚本跑一遍),
再挑一张后面正好跟着概念图卡的原文图卡当锚点。

## 本轮给 docs/e2e 加的东西

- `interactions/feed-scroll.js` 多了两种目标:`diagram[:n]`(概念图卡)与
  `find:<文本>`(滚到第一张含该文本的卡)。#146 之后每次页面加载都会在分数窗口内
  轮换卡片顺序,按序号定位不再稳,`find:` 才是可复现的定位方式。
