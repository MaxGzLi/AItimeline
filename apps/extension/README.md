# AITimeline Clipper(Chrome 插件)

在 x.com / twitter.com 的每条推文操作栏里加一个「保存」按钮,点击后把推文
(正文、作者、永久链接、发布时间)送进本机 AITimeline API,登记成待转化的来源。

通路:content script 抓取推文 → `chrome.runtime.sendMessage` → background
service worker → `POST http://127.0.0.1:8787/api/captures/source`。
走 service worker 是为了绕开页面源的 CORS 限制;推文正文随请求一起提交
(`capturedText`),因为服务器抓 x.com 只能拿到登录墙,剪藏就是正文的唯一来源。

纯 JS,无构建步骤,无第三方依赖。

## 人工验收步骤

1. 起本机 API:仓库根目录执行 `npm run dev:api`(监听 127.0.0.1:8787)。
2. 打开 Chrome,进入 `chrome://extensions`,右上角打开「开发者模式」。
3. 点「加载已解压的扩展程序」,选择本目录(`apps/extension`)。
4. 打开 https://x.com 并登录,滚动信息流,确认每条推文的操作栏
   (回复/转发/喜欢那一排)末尾出现灰色「保存」按钮;继续滚动,新加载的
   推文也要有按钮。
5. 点某条推文的「保存」:按钮先变「保存中…」,成功后变绿色「已保存」。
6. 验证来源已登记:

   ```bash
   curl -s http://127.0.0.1:8787/api/source-candidates | python3 -m json.tool | grep -A3 browser_share
   ```

   应能看到 `intakeKind: "browser_share"`、推文的 x.com URL,状态为
   `queued`(当日预算内)或 `pending`(预算用尽,之后的策展轮会补排)。
7. 对同一条推文再点一次「保存」,按钮应变「已存过」,候选池里不新增记录。
8. 等后台 worker 跑一轮(默认 60 秒),或手动触发:

   ```bash
   curl -s -X POST http://127.0.0.1:8787/api/curation/run -H 'content-type: application/json' -d '{}'
   ```

   然后在网页端信息流(`npm run dev`)里确认出了带出处的知识卡,卡上的
   来源链接指向该推文。
9. 断连演练:停掉 API 再点「保存」,按钮应变红色「重试」,悬停可见错误
   提示;重启 API 后点击可恢复。

## 已知限制

- 太短的推文可能被来源质量检查拒收(判据要求正文有足够词量与实质内容),
  候选会落为 `rejected_source`。长推文/长帖(Article)通过率高。
- 只在推文操作栏注入;X 的 DOM 结构(`article[data-testid="tweet"]`、
  `[data-testid="tweetText"]` 等)若改版,选择器需要跟进。
- API 地址写死 `127.0.0.1:8787`,与本机默认一致;不支持配置。
