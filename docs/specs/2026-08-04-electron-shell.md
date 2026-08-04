# Electron 壳(桌面形态第一期)

## 背景

2026-08-04 拍板:AITimeline 的下一形态是 Electron 桌面知识应用(工作台为主 + 观察员常驻侧栏,分期到达)。第一期只做「壳」:把现有产品原样装进桌面应用——双击即开、数据在本地用户目录、worker 常驻后台。从合并那天起,日常使用就切到桌面版,后续每一期(观察员侧栏、系统级收集、计划学习)都长在真产品上。

桌面形态同时让已定的上线路径(先私测再开源自托管)更顺:私测从「帮朋友托管」变成「发个安装包」。

## 目标

做完后,下面这些行为成立:

1. **双击即开**:不开终端、不跑 npm 命令,双击应用图标出现窗口,里面是现有完整界面,所有现有功能(导入、信息流、图谱、复习、深读、通知、设置)照常可用。
2. **agent 常驻**:应用运行期间,后台 worker 持续干活(策展、导入、跟进);关掉窗口(macOS 惯例)应用留在 Dock,worker 继续;Cmd+Q 才真正退出。
3. **数据在本地用户目录**:打包版的数据(快照、策展队列、媒体)放在系统用户数据目录,不依赖 repo;删掉 repo,打包版照常运行。
4. **干净退出**:正常退出后锁文件全部释放,下次启动不需要人工清锁。
5. **配置不靠终端**:模型/搜索等配置从用户数据目录下的配置文件读取(格式与 `.env` 相同),双击启动也能用上模型;完全不配置时,全部功能走现有确定性回退,照常能用。
6. **老数据能搬家**:有一条写在文档里、验证过的搬家路径,把现在 `apps/api/data/` 的服务端数据和浏览器里的 localStorage 状态搬进桌面版;搬完后信息流、复习进度、图谱在桌面版里完整可见。
7. **现有开发流程零变化**:`npm run dev` / `dev:api` / 浏览器访问方式全部照旧;桌面壳只是多出来的一个 workspace。

## 不做(本期明确排除)

- 观察员常驻侧栏、左侧新导航结构(第二期)。
- 系统级收集:全局快捷键、剪贴板监听、拖文件进窗口、剪藏(后续期)。
- 「计划学习」新功能(做之前要单独定义)。
- 自动更新机制。
- 应用签名与公证(私测阶段用「右键打开」绕过 Gatekeeper;公开发布前再解决)。
- Windows / Linux 安装包(架构上不排斥,本期只出 macOS)。
- 菜单栏托盘图标、开机自启(mac 的 Dock 常驻已够第一期用)。
- 对现有 web 界面的任何改动。

## 验收清单

功能行为:
- [ ] 打包产物(dmg 或 zip)在一台没开终端的 Mac 上双击可用:导入一篇文章 → 生成带引用的卡片 → 信息流可见。
- [ ] 应用挂机一段时间后,能看到 worker 干活的痕迹(导入记录/通知里出现新的后台活动)。
- [ ] 打包版数据落在用户数据目录(如 `~/Library/Application Support/AITimeline/`),文件结构与现有快照格式一致(`AITimelinePersistenceSnapshot` 不变)。
- [ ] Cmd+Q 退出后,数据目录下无残留 `.lock` 文件;重新启动直接可用。
- [ ] 关窗不退出:窗口关闭后从 Dock 点回来,状态还在,worker 没停过。
- [ ] 配置文件生效:在用户数据目录放一份含模型配置的文件,重启应用后导入走模型路径(卡片质量/日志可辨);删掉配置文件,重启后走确定性回退,功能不缺。
- [ ] 搬家路径验证:按文档把现有真实数据搬进桌面版,信息流卡片数、复习队列、图谱概念数与搬家前一致。

反例(坏路径的表现):
- [ ] 端口被占(比如 dev API 正在跑):应用照常启动可用,不白屏、不要求用户杀进程(端口不写死)。
- [ ] 数据文件被另一个活进程锁着(比如 dev API 开着且指向同一份数据):应用给出一句人话提示后退出或引导,不崩溃、不白屏、不抢写。
- [ ] 断网启动:浏览、翻卡复习、图谱照常;需要网络的动作(导入新 URL、发现)给出可理解的失败信息,不崩。
- [ ] 二次启动:再双击一次应用图标,聚焦已有窗口,不出现第二个实例、不报锁冲突错误。
- [ ] 卡片里的原文外链在系统默认浏览器打开,应用窗口不跳走。

测试与工程:
- [ ] 新 workspace 进入 `typecheck` / `build` 编排(root scripts 是 `--workspaces --if-present`,自带脚本即可)。
- [ ] 壳的纯逻辑(数据目录解析、配置文件加载合并、启动参数装配)有 Vitest 单测(记得把测试 glob 登记进根 `vitest.config.ts` 的 include 白名单——它不会自动收集)。
- [ ] 一条桌面壳 smoke:不开 GUI,以库方式验证「配置文件 → env 合并 → createApiServer(带 options)→ 起服务 → 关闭释放锁」全链路;登记进根 `test` script 和 CI。
- [ ] CI 保持全绿;桌面 workspace 的 typecheck/build 进 CI。
- [ ] UI 截图:桌面窗口运行截图存入 `docs/e2e/runs/2026-08-XX-electron-shell/`(界面本身无变化,截的是「装进窗口」这件事)。

## 假设与开放问题

起草时的假设(用户可推翻):
- **平台**:第一期只出 macOS(Apple Silicon);私测对象如果有 Windows 用户,再提期。
- **不签名**:私测阶段接受「右键打开」;Apple 开发者账号的事放到公开发布前。
- **数据目录**:打包版用系统用户数据目录;开发模式(从 repo 起桌面壳调试)沿用 repo 里的 `apps/api/data`,和现有 dev 流程共享。
- **技术选型**:Electron(用户点名);它内嵌 Node,正好把现有纯 JS 的 API+worker 以库方式跑在主进程侧,这是相对 Tauri 的实质优势,不只是惯性。

开放问题:
- CI 要不要加真开 GUI 的冒烟(xvfb 起 Electron):第一期只冒烟无头链路,GUI 冒烟另评。
- MCP 等外部消费者怎么拿到桌面版的实际端口(第一期不解,API 保持真 HTTP 监听已留好口子)。
- (已决,见「方案」段:网页供给走 `app://` 静态 + API 跨源直连、preload 注入端口;localStorage 搬家走首启检测注入;端口 8791 默认+随机退避。)

## 方案

(2026-08-04 设计门禁通过,要点如下;file:line 依据见当日勘察记录。)

**进程结构**
- 新 workspace `apps/desktop`(`@aitimeline/desktop`),主进程纯 `.mjs` + `@ts-check`,与 apps/api 同风格,无构建步骤。
- 主进程以库方式调用 `createApiServer(options)`(apps/api/src/server.mjs 导出,options 支持 dataPath / curationDataPath / mediaRootDir / worker / workerIntervalMs;库模式 worker 默认关,需显式 `worker: true`)。HTTP 只监听 127.0.0.1;默认端口 8791(避开 dev 的 8787),被占则退到随机端口(listen 0)。
- 渲染进程 = 现有 web 应用的**标准构建产物**(不需要构建变体):真实 API 端口在运行时经最小 preload(contextBridge 暴露 `apiOrigin`)注入,`api.ts` 的 `apiBaseUrl` 优先取注入值,无注入(浏览器)行为不变。这是 apps/web 唯一改动。

**稳定 origin:`app://` 只供静态,API 跨源直连(关键取舍,2026-08-04 修订)**
- localStorage 按 origin 隔离(aitl-theme / aitl-language / aitimeline.mvp.v3 / synced-signals 都在里面),窗口若直接加载 `http://127.0.0.1:<port>`,端口一变这些状态全部"消失"。因此窗口加载 `app://` 固定 origin,主进程注册 privileged scheme(standard/secure/supportFetchAPI)用 `protocol.handle` 供给 web dist 静态文件,未命中回落 index.html。
- API 调用不走代理,渲染进程直接打 `http://127.0.0.1:<实际端口>`,desktop 启动时把 `app://aitimeline` 加进 CORS 白名单(`AITIMELINE_CORS_ORIGINS` 本就支持)——与现有 dev 形态(5173 跨源访问 8787)完全同构。
- 首版方案(`VITE_AITIMELINE_API_URL=""` + 全量代理)被否,原因是执行时发现的真冲突:样例导入地址(`/fixtures/article`)不只用于发请求,还作为**数据**进请求体由服务端抓取,相对地址过不了 core 的绝对 URL 校验(articleImport.ts 校验 http/https)。运行时注入让它天然是绝对地址,同时代理层从「转发一切」缩成「只供静态」。
- 弃选项「固定端口保 origin」:端口冲突时要么启动失败要么 origin 漂移,数据完整性不可保,弃。
- API 保持真 HTTP 监听而非纯进程内分发:MCP(`AITIMELINE_API_URL`)等外部消费者未来仍可接入。

**配置与数据目录**
- 打包版数据目录 = `app.getPath("userData")`(快照/队列/media 三件);开发模式(`app.isPackaged === false`)沿用 repo `apps/api/data`。
- 配置文件 `<userData>/config.env`(`.env` 同格式),启动时加载进 `process.env`(不覆盖已有变量);api/core 全部配置本来就走 `process.env` 且仅在 `createApiServer` 构造时读一次,时序天然成立。开发模式沿用 repo `.env`。
- 桌面开启 fixtures(与 dev 一致),首启样例导入可用。

**生命周期与安全**
- `requestSingleInstanceLock`,二开聚焦已有窗口。
- macOS 惯例:关窗不退(`window-all-closed` 在 darwin 不 quit),Cmd+Q → `server.close()` → 既有 `closeStores` 停 worker、释放两把写锁。启动时撞 `AITIMELINE_WRITER_LOCKED` → 人话对话框 → 退出。
- 渲染进程 contextIsolation 开、nodeIntegration 关、sandbox 开;preload 只做一件事:contextBridge 暴露 `{ apiOrigin }`,不暴露任何 Node 能力;`setWindowOpenHandler` + `will-navigate` 守卫,非 `app://` 一律 `shell.openExternal`。

**打包**
- apps/api 与 packages/core 均零运行时依赖(2026-08-04 核实),electron-builder 直接把 `apps/api/src`、`packages/core/dist`、web dist 作为文件收进包,不引打包器;macOS arm64,dmg+zip,不签名(`identity: null`)。

**搬家**
- 服务端数据:应用未运行时 `cp apps/api/data/{aitimeline.json,curation-jobs.json,media} → userData`,写进文档。
- localStorage:首启检测 `<userData>/import-localstorage.json`(按文档从浏览器 console 导出),注入渲染进程后改名 `.done`。

**测试与编排**
- Vitest(根 vitest.config.ts include 白名单手动加 `apps/desktop/test/**/*.test.mjs`):配置加载合并、数据目录解析、app:// 路由映射(纯函数)。
- `scripts/smoke-desktop.mjs`:无 GUI,纯 node 验证「配置文件 → env 合并 → createApiServer(options) → HTTP 一轮 → close → 无 .lock 残留」;登记进根 `test` script 与 ci.yml(均为硬编码清单,不会自动收集)。
- typecheck/build 走根 `--workspaces --if-present`,desktop 自带脚本即可。
