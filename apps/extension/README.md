# AITimeline Clipper(Chrome 插件)

两条通路:

- **剪藏**:在 x.com / twitter.com 的每条推文操作栏里加一个「保存」按钮,点击后把推文
  (正文、作者、永久链接、发布时间)送进本机 AITimeline API,登记成待转化的来源。
- **注入**:从本机 API 拉「该回来找用户」的知识卡(复习到期优先),以 X 原生帖的
  外观插进时间线;拉不到卡就完全不注入。文件:`inject.js` + `lib/injectCore.js`
  (纯逻辑,有 Vitest 单测)+ `inject.css`。

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

## 人工验收步骤(注入)

x.com 上的 DOM 行为没法无头验证,以下步骤必须真人过一遍:

1. 起本机 API(`npm run dev:api`)和网页应用(`npm run dev`,127.0.0.1:5173)。
   确认知识库里已有卡:`curl -s "http://127.0.0.1:8787/api/inject/cards" | python3 -m json.tool`
   应返回 1-3 张卡(复习到期的优先);返回空数组则先导入几篇文章再验。
2. 重新加载扩展(`chrome://extensions` → 刷新按钮),打开 https://x.com 并登录。
3. 滚动信息流几屏,应看到一张「你的知识库 · N 天前存的」卡混在推文之间:
   40px 圆形头像位、标题加粗、摘要、来源标题、蓝色「在知识库中打开」。
   外观应与前后推文融为一体(分隔线、字体、内边距一致),不重叠不破版。
4. 频率克制:同屏不应出现两张注入卡(间隔约 8 条推文);整个页面生命周期
   最多 3 张;刷新页面后重新计数。
5. 滚动存活:把注入卡滚出视口很远(1-2 万像素)再滚回来,卡应还在原来那条
   推文上方、且只有一份(锚点稳定 + 查重)。
6. 点击注入卡:新标签页打开 http://127.0.0.1:5173(网页应用没有单卡路由,
   开首页是预期行为)。
7. 信号回传:注入卡进视口停留几秒后,查
   `curl -s http://127.0.0.1:8787/api/snapshot | python3 -c "import json,sys; d=json.load(sys.stdin); print([ (r['signal']['postId'], r['signal']['dwellTimeMs'], r['signal']['openedThread']) for r in d['interactionSignals'][-5:] ])"`
   应看到该卡的纯曝光记录(dwell 0)、随停留追加的累计 dwell 记录,以及
   点开后 openedThread=true 的记录。
8. 断连演练:停掉 API 再刷新 x.com,不应有任何注入卡出现(不造假卡),
   页面无报错弹窗;重启 API 后刷新恢复。

## 已知限制

- 太短的推文可能被来源质量检查拒收(判据要求正文有足够词量与实质内容),
  候选会落为 `rejected_source`。长推文/长帖(Article)通过率高。
- 只在推文操作栏注入;X 的 DOM 结构(`article[data-testid="tweet"]`、
  `[data-testid="tweetText"]` 等)若改版,选择器需要跟进。
- 注入依赖 X 虚拟列表的格子结构(`div[data-testid="cellInnerDiv"]`)和推文
  `/status/` 永久链接;X 改版需跟进。注入卡的会话计数在页面刷新后归零。
- API 地址按 `127.0.0.1:8787` → `127.0.0.1:8788` 顺序探测,取先应答的那个:8787 是从仓库起的 API(`npm run dev:api`),桌面版占不到 8787 时会退到 8788。两个端口都写在 manifest 的 host_permissions 里,不支持配置成别的端口。
