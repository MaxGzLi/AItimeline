# 服务端 worker UI 验收记录

## 本次真服务结果

- API 使用 `127.0.0.1:43191`，Web 使用 `127.0.0.1:43192`；未占用 8787、5173、5198。
- API 从 `apps/api/src/server.mjs` 主入口启动，`AITIMELINE_WORKER=1`、`AITIMELINE_WORKER_INTERVAL_MS=5000`，数据与媒体目录均为临时目录，未读写 `apps/api/data/`。
- 启动前种入到期任务 `server-worker-ui-job`，全程未调用 `POST /api/curation/run`；worker 自动将任务推进到 `succeeded`。
- `GET /api/timeline` 返回完整 `workerStatus`：`enabled=true`、`running=false`、`intervalMs=5000`，并含 `lastRunAt` 与三个数值型 summary 字段。
- `POST /api/worker {"enabled":false}` 后，接口响应与 timeline 均显示 `enabled=false`；恢复后两处均显示 `enabled=true`。
- 验收结束后已关闭两个服务并确认端口释放，临时数据已清理。

## 截图状态

已尝试使用连接的浏览器打开 `http://127.0.0.1:43192/`，但浏览器安全策略拒绝访问该本地测试地址，并明确禁止换浏览器或绕过策略。因此本次没有生成 PNG；以下步骤可在本机浏览器精确补拍。

## 精确复现步骤

1. 在仓库根目录执行 `npm ci && npm run build -w @aitimeline/core`。
2. 在终端 A 启动使用临时数据的 API：

   ```bash
   worker_ui_dir="$(mktemp -d /private/tmp/aitimeline-worker-ui.XXXXXX)"
   mkdir -p "$worker_ui_dir/media"
   env \
     PORT=43191 \
     AITIMELINE_HOST=127.0.0.1 \
     AITIMELINE_ENABLE_FIXTURES=1 \
     AITIMELINE_ALLOW_PRIVATE_FETCH=true \
     AITIMELINE_CORS_ORIGINS=http://127.0.0.1:43192 \
     AITIMELINE_WORKER=1 \
     AITIMELINE_WORKER_INTERVAL_MS=5000 \
     AITIMELINE_DATA_PATH="$worker_ui_dir/aitimeline.json" \
     AITIMELINE_CURATION_DATA_PATH="$worker_ui_dir/curation-jobs.json" \
     AITIMELINE_MEDIA_ROOT="$worker_ui_dir/media" \
     node apps/api/src/server.mjs
   ```

3. 在终端 B 启动 Web：

   ```bash
   env VITE_AITIMELINE_API_URL=http://127.0.0.1:43191 \
     npm run dev -w @aitimeline/web -- \
       --host 127.0.0.1 \
       --port 43192 \
       --strictPort
   ```

4. 等待至少 6 秒后打开 `http://127.0.0.1:43192/`。顶部开关应显示“自动生产”，进入左侧“智能体”后，观察员状态行应显示“刚刚运行 · 处理 0 项”（或下一次刷新后的相对时间）。
5. 点击顶部“自动生产”开关，确认变为“生产已暂停”；再次点击，确认恢复“自动生产”。观察员区的同名复选开关应同步变化。
6. 截取包含顶部开关和“观察员”区状态行的页面，保存到本目录。
