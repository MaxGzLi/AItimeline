# 2026-07-04 — X 式主栏帖子详情页

分支 `feat/post-detail-view`。本次把右侧来源详情抽屉改为主栏帖子详情页,并给时间线长正文加 4 行折叠与「显示更多」入口。

## 交互脚本

- `docs/e2e/interactions/post-detail-view.js`
- `#feed-light` / `#feed-dark`:保留时间线,定位含 `.x-showmore` 的折叠帖。
- `#detail-light` / `#detail-dark`:打开一张来源帖,在详情页提交评论,再提交问 AI,等待评论线程和 AI 对话渲染。

## 种子步骤

建议用隔离数据文件启动 API:

```bash
AITIMELINE_ENABLE_FIXTURES=1 \
AITIMELINE_DATA_PATH=/private/tmp/aitimeline-post-detail-view-api.json \
AITIMELINE_CURATION_DATA_PATH=/private/tmp/aitimeline-post-detail-view-curation.json \
PORT=8792 node apps/api/src/server.mjs
```

导入 fixture 文章并发布一条长笔记:

```bash
curl -sS -X POST http://127.0.0.1:8792/api/import/article \
  -H 'content-type: application/json' \
  -d '{"url":"http://127.0.0.1:8792/fixtures/article","createdAt":"2026-07-04T01:00:00.000Z","recommendedBecause":"post detail view visual seed"}'

curl -sS -X POST http://127.0.0.1:8792/api/notes \
  -H 'content-type: application/json' \
  -d '{"text":"[[Memory]] 是这条长笔记要覆盖的核心概念。为了验证时间线正文折叠,这里刻意写成多段长正文:第一段说明用户笔记会进入同一条时间线;第二段说明显示更多应该直接进入主栏详情页;第三段说明返回后滚动位置要保持;第四段补充一个 [[不存在的东西]] 作为幽灵双链。\\n\\n这段继续拉长内容,让 600px 主栏中至少超过四行,从而稳定触发 CSS line-clamp 和蓝色「显示更多」入口。"}'
```

启动 Web:

```bash
VITE_AITIMELINE_API_URL=http://127.0.0.1:8792 npx vite --host 127.0.0.1 --port 5182
```

## 预期截图

```bash
LIGHT=1 node docs/e2e/cdp-shot.mjs docs/e2e/runs/2026-07-04-post-detail-view/01-detail-light.png http://127.0.0.1:5182/#detail-light 1440 2200 docs/e2e/interactions/post-detail-view.js
DARK=1 node docs/e2e/cdp-shot.mjs docs/e2e/runs/2026-07-04-post-detail-view/02-detail-dark.png http://127.0.0.1:5182/#detail-dark 1440 2200 docs/e2e/interactions/post-detail-view.js
LIGHT=1 node docs/e2e/cdp-shot.mjs docs/e2e/runs/2026-07-04-post-detail-view/03-feed-fold-light.png http://127.0.0.1:5182/#feed-light 1440 1800 docs/e2e/interactions/post-detail-view.js
DARK=1 node docs/e2e/cdp-shot.mjs docs/e2e/runs/2026-07-04-post-detail-view/04-feed-fold-dark.png http://127.0.0.1:5182/#feed-dark 1440 1800 docs/e2e/interactions/post-detail-view.js
```

## 本机执行结果

当前 Codex 沙箱禁止本地监听端口,所以未能生成 PNG:

- API: `PORT=8792 node apps/api/src/server.mjs` 失败,`listen EPERM 127.0.0.1:8792`。
- Vite: `npx vite --host 127.0.0.1 --port 5182` 失败,`listen EPERM 127.0.0.1:5182`。
- cdp-shot:在没有可访问页面的情况下执行失败,`Error: no CDP page target`。

没有启动成功的长驻服务,因此无需清理进程。验收人可在允许本地监听和 Chrome CDP 的环境中按上面的命令补拍。
