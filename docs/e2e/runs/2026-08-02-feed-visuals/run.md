# 信息流配图与首屏视觉 P1(2026-08-02)

Spec: `docs/specs/2026-08-02-feed-visuals.md`(方案段 = 已批准设计)

## 这一版改了什么

- 文章导入抽首图(og:image → twitter:image → 正文首个 `<img>`)、YouTube 导入抽封面,
  缓存成本地 `image-lead` 资产,只挂在导入产出的第一张卡上。
- 时间线卡片的媒体位:`object-fit` 由 `contain` 改 `cover`,最大高度由 510px 收到 440px。
  竖图不再在暗色信息流里留两条白边,而是干净裁切;宽图仍按原比例占满卡宽,不裁。
- 有图卡收紧标题/正文的下边距,无图卡多一档行距与段后空,形成有图/无图交错的节奏。

## 截图

| 文件 | 状态 |
| --- | --- |
| `before-feed-mixed.png` | 改版前 · 混排首屏 |
| `after-feed-mixed.png` | 改版后 · 混排首屏(同一份数据、同一滚动位置) |
| `before-card-tall-image.png` | 改版前 · 竖图卡:`contain` 封顶后左右两条白边,占 512px 高 |
| `after-card-tall-image.png` | 改版后 · 竖图卡:`cover` 干净裁切,封顶 440px |
| `after-card-tall-image-light.png` | 改版后 · 竖图卡(亮色主题) |
| `after-card-with-media.png` | 改版后 · 有图卡(宽图,按原比例完整展示不裁) |
| `after-card-text-only.png` | 改版后 · 无图卡连排 |

前后对比的关键在 `*-card-tall-image.png` 这一对:首屏那一对用的是 16:9 宽图,
改动只体现在间距上,竖图才吃到 `contain → cover` 的差别。

## 复现步骤

全程零外网。端口用 8788(API)/ 8899(夹具站)/ 5174(Vite),不碰 8787/5173 和
`apps/api/data/`。

```bash
npm install
npm run build -w @aitimeline/core

# 1. 起本地夹具站(自带生成的 PNG,不落任何二进制到仓库)
node docs/e2e/media-fixture-host.mjs 8899

# 2. 起独立数据目录的 API(worker 关掉,保证信息流可复现)
DATA=$(mktemp -d)
PORT=8788 AITIMELINE_WORKER=0 AITIMELINE_ALLOW_PRIVATE_FETCH=true \
AITIMELINE_CORS_ORIGINS=http://127.0.0.1:5174 \
AITIMELINE_DATA_PATH=$DATA/aitimeline.json \
AITIMELINE_CURATION_DATA_PATH=$DATA/curation-jobs.json \
AITIMELINE_MEDIA_ROOT=$DATA/media \
node apps/api/src/server.mjs

# 3. 导入六篇夹具文章(按时间从旧到新,图片文章排最新)
for p in plain-3 plain-2 plain-1 figure portrait hero; do
  curl -s -X POST http://127.0.0.1:8788/api/import/article \
    -H 'content-type: application/json' \
    -d "{\"url\":\"http://127.0.0.1:8899/article/$p\"}" > /dev/null
done

# 4. 起 Vite
VITE_AITIMELINE_API_URL=http://127.0.0.1:8788 npx vite apps/web --port 5174 --strictPort

# 5. 截图
node docs/e2e/screenshot.mjs out-feed.png http://127.0.0.1:5174 1440 1600
VIEWPORT=1 node docs/e2e/cdp-shot.mjs out-tall.png \
  'http://127.0.0.1:5174/?e2eScroll=media:2' 1440 1050 docs/e2e/interactions/feed-scroll.js
```

注意:每次页面加载都会写曝光信号,排序会跟着变。要做严格的前后对比,得在每次截图前
把数据目录恢复成同一份快照再重启 API,否则两张图里的卡片顺序对不上。

## 本轮给 docs/e2e 加的东西

- `media-fixture-host.mjs`:离线夹具站(文章页 + 现生成的 PNG)。
- `interactions/feed-scroll.js`:按 `?e2eScroll=media|text[:n]` 滚到指定卡片。
- `cdp-shot.mjs` 加了 `VIEWPORT=1`:只截可视区,配合滚动交互框住单张卡片;
  不设时行为不变(仍是整页)。
