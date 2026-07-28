# 时间线与深读视图拆分验收记录

## 本次运行结果

- API 使用 `127.0.0.1:43193`，Web 使用 `127.0.0.1:43194`；未占用 8787、5173、5198。
- API 数据、策展队列与媒体目录全部指向 `/private/tmp/aitimeline-tlview.EAC7zq/`，未读写 `apps/api/data/`。
- `GET /health` 返回 `ok: true`。
- 通过本机 article fixture 导入 1 个来源，生成 4 张时间线卡。
- Web 首页返回 AITimeline 的 Vite 页面，API 与 Web 验证后均已关闭。

## 截图状态

当前执行环境无法自动访问本地测试页面：

- 仓库的 `docs/e2e/screenshot.mjs` 启动 Chrome 时以 `SIGABRT` 退出。
- `docs/e2e/cdp-shot.mjs` 未能建立 Chrome 调试端点。
- 内置浏览器的安全策略拒绝访问本地 `127.0.0.1` 地址。

截图由验收人按下述步骤补拍（43193/43194 临时端口，fixture 4 卡）：

- `timeline-light.png`：时间线有卡状态——顶部 tab、话题筛选、提问框、状态条、话题块、卡片（含超出来源徽章与原文出处）、右栏三卡全部在位。
- `deepread-light.png`：从技能树立目标「AI Agent」生成并自动打开的深读文章——拼装稿徽章、单源警示、概念双链、事实来源、结论、来源清单全部在位。

验收人另做了交互全链路检查：卡片详情开合、返回时间线、图谱→技能树→立目标→生成深读→自动进入→返回技能树，全部正常（85 个 props 无接线错位）。

## 精确复现步骤

1. 在仓库根目录执行：

   ```bash
   npm ci
   npm run build -w @aitimeline/core
   ```

2. 在终端 A 启动完全隔离数据的 API：

   ```bash
   timeline_view_dir="$(mktemp -d /private/tmp/aitimeline-timeline-view.XXXXXX)"
   mkdir -p "$timeline_view_dir/media"
   env \
     PORT=43193 \
     AITIMELINE_HOST=127.0.0.1 \
     AITIMELINE_ENABLE_FIXTURES=1 \
     AITIMELINE_ALLOW_PRIVATE_FETCH=true \
     AITIMELINE_CORS_ORIGINS=http://127.0.0.1:43194 \
     AITIMELINE_WORKER=0 \
     AITIMELINE_DATA_PATH="$timeline_view_dir/aitimeline.json" \
     AITIMELINE_CURATION_DATA_PATH="$timeline_view_dir/curation-jobs.json" \
     AITIMELINE_MEDIA_ROOT="$timeline_view_dir/media" \
     node apps/api/src/server.mjs
   ```

3. 在终端 B 启动 Web：

   ```bash
   env VITE_AITIMELINE_API_URL=http://127.0.0.1:43193 \
     npm run dev -w @aitimeline/web -- \
       --host 127.0.0.1 \
       --port 43194 \
       --strictPort
   ```

4. 在终端 C 导入有卡 fixture：

   ```bash
   curl --fail --silent --show-error \
     -X POST http://127.0.0.1:43193/api/import/article \
     -H 'Content-Type: application/json' \
     --data '{"url":"http://127.0.0.1:43193/fixtures/article","createdAt":"2026-07-28T05:00:00.000Z"}' \
     --output /private/tmp/aitimeline-timeline-view-import.json
   ```

5. 用 1440px 宽视口打开 `http://127.0.0.1:43194/`，确认时间线显示 4 张卡，并依次核对：

   - 顶部「为你 / 最新 / 已收藏」切换；
   - 话题筛选、提问框、新卡/供给状态区域；
   - 卡片列表、卡片详情返回与右侧上下文栏；
   - 自动生产开关和账单展开按钮在时间线及其他视图都仍可见。

   在浅色主题下保存 `timeline-light.png` 到本目录。

6. 在左侧进入「知识图谱」，切到「技能树」，在「输入一个图谱概念」中填入 `AI Agent`，点击「立目标」。目标行出现后点击书本按钮「生成深读文章」。

7. 等待页面自动进入深读视图，确认标题、章节、来源、概念链接及返回按钮正常；点击返回应回到「知识图谱 > 技能树」。回到深读文章后，在浅色主题下保存 `deepread-light.png` 到本目录。

8. 验收结束后在终端 A/B 按 `Ctrl-C` 关闭服务；临时数据只位于第 2 步打印的 `/private/tmp/aitimeline-timeline-view.*` 目录。
