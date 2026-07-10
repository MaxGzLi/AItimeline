# Bug 修复战役:批次划分与派工顺序

来源:2026-07-10 全项目体检报告(P0 5 / P1 27 / P2 14,worktree `review+full-audit/codex-review-report.md`)+ UX 体验审查报告(P0 2 / P1 21 / P2 9,scratchpad `ux-review/ux-review-report.md`,已分诊并入,见文末)。

## 划批原则

1. **同文件必串行**:`server.mjs` 和 `App.tsx` 是巨石文件,凡触碰同一文件的批次排成前后波次,后波从最新 main 拉分支。
2. **共享语汇先行**:统一口径(concept key、dwell 合并、day-key)先落地,再修消费它们的路由与前端。
3. **同一段代码的 bug 合并成一单**:P0-04(并发回复覆盖)与 P1-11(回复引用丢失)同改回复持久化路径;P1-19 按 api/web/mobile 三端拆进各自批次。
4. **每单必须锁死对应的测试盲区**:体检报告 3.1 节证明的变异(删引用选择逻辑、清空深读引用等)在对应批次里必须变成"删掉就红"。
5. **生产数据安全**:凡动持久化 schema 的批次(E、D),任务书强制要求向后兼容加载 + 旧格式 fixture 测试;验收人在合并前用生产数据副本实测加载。

## 波次与内容

### W1-C:Grounding 内核封闭(core-only)
P1-01 askGrounded 禁止自动补引用(fail-closed,无证据返回统一"不足以回答");P1-02 citation 校验 (sourceId, chunkId) 所属关系;P1-03 数值/否定/方向/单位确定性检查(词汇重叠只作召回);P1-04 example/question/review/concepts/recommendedBecause/caption 进硬校验;P1-05 分词支持 CJK(Intl.Segmenter + 规范化子串快路径);P1-06 校验失败的 run 不返回/不持久化 posts;P1-16 强制 maxPostsPerRun + post ID 唯一性;P1-08 conceptBrief 逐句支持性校验(失败退确定性 brief);P1-09 deepread judge fail-closed——**注意语义**:未配模型时走确定性保守检查(不算 judge 通过),配了模型但 judge 异常/超时/结构非法才算 gate error。
文件:`packages/core/src/harness/*`、`agents/conceptBrief.ts`、`deepread/index.ts`、smoke-core/smoke-model。
测试锁:变异 #1(删 citation 选择逻辑)必须变红;补 source/chunk 错配、纯中文、否定反转、字段幻觉负样本。
风险声明:门禁收紧后模型生成的拒绝率会上升(供给下降),这是产品承诺的代价,验收时观察拒绝率。

### W1-H:core 包可安装(与 C 并行,文件不相交)
P1-27 exports 指向 dist(types/import),files 只含 dist,prepack 构建;CI 增加 pack→临时安装→node import 冒烟。
**硬性验证**:apps/api 现在按 `packages/core/dist/` 路径 import,apps/web 走 Vite 解析——exports map 收紧后两个消费端必须仍然可解析(typecheck+build+三 smoke 全绿)。

### W2-F:统一口径(core+api,C 与 A 都合并后)
P1-23 全仓只留 `graph/conceptAliases.ts` 导出的 normalizeConceptKey,删 4 处私版(weeklyRecap/conceptBrief/persistenceStore/server.mjs),alias 解析 user>auto;P1-20 core 导出 coalesceInteractionSignals(按 postId+日 dwell 取 max、离散动作按 id 去重),lifecycle/ranker/recap/server.mjs topic feedback 全部改走它;P2-01 day/week-key helper 支持 IANA 时区(AITIMELINE_TIMEZONE,默认系统时区;smoke 固定时区保证确定性);P2-09 core 侧 expansionPolicy 排除 connection_note/系统派生卡;P2-14 auto_mastery_blacklist 要么实现 add/remove(canonical key)要么移出公开 edit union(先 grep 调用方再定)。
测试锁:dwell 生产者跨日 + 12→15→18 累计序列断言;全角ＲＡＧ与 RAG 同 key 断言。

### W1-A:API 边界——校验与幂等(server.mjs 重区;与 C/H 文件不相交,提前并入 W1)
P0-03 signal 完整 runtime 校验(非法 ISO/非有限 dwell/坏布尔/未知 post 一律 400 不落盘)+ 加载时隔离历史坏记录(单条坏 signal 不得拖垮 timeline);P1-17 processed-event 台账幂等(重复 signal 返回首次结果,不重复扣预算/推主题);P1-19 api 侧 review 事件加 reviewEventId + grade(remembered|fuzzy|forgot,grade 可选默认 remembered 保持向后兼容),幂等,forgot 重置短间隔不晋级;**UX-P0-1 api 侧**:/api/review/due 每项携带到期的那道 reviewPrompt(id/prompt/answerHint),前端不再自行猜 prompts[0];P1-22 candidate intake 限到 worker 支持的类型 + 终态失败回写 candidate 状态;P1-25 memory 端点只允许基于持久化基线的 edits(忽略客户端全量 memory);P2-02 requireObjectBody;P2-03 Content-Length 早拒 + 先写 413 再排干;P2-04 错误脱敏(客户端只见稳定 code,细节进服务端日志);P2-05 firstNonBlankEnv 处理空串 env。
测试锁:同一 signal/review 重发两次断言副作用只发生一次;invalid date 400 断言;深读事实段 citations 非空断言(杀变异 #2);grade=forgot 断言间隔重置。
注:本批只动 server.mjs + smoke-api,不碰 core src / smoke-core / smoke-model / package.json,与 W1-C、W1-H 无文件交集。

### W4-E:持久化与队列状态机(F 合并后)
P0-04+P1-11 合单:KnowledgeThreadBlock 增加 citations/grounded/runnerKind 字段,持久层提供原子 appendThreadBlocks(CAS/重读重试),回复路由改走它并原样持久化 turn.answer 的引用;P0-05 单写者锁(lockfile,二写者启动即拒)+ 进程唯一 temp + snapshot revision/CAS + 滚动备份;P1-24 snapshot 加载时完整 runtime decoder(嵌套坏字段启动即报,隔离单条坏记录);P1-21 队列 lease(claimedAt/leaseUntil/workerId + 启动回收过期 running)+ terminal 与业务结果物化的崩溃补偿(启动时补物化未应用的 succeeded 结果)+ retry 以 originalJobId+attempt 表达(兼容加载历史 retry-N id)。
**迁移敏感**:必须能无损加载现网 `apps/api/data/*.json` 与 `curation-jobs.json`;旧格式 fixture 进 smoke;验收人合并前拿生产数据副本实测。
测试锁:并发 reply 4 blocks 断言;双 Store 同路径二写者被拒断言;claim 后崩溃重启回收断言。

### W5-B:安全边界(E 合并后;也是上线硬门槛)
P0-01 非 loopback 绑定强制 AITIMELINE_AUTH_TOKEN;CORS 从 * 改显式 allowlist(默认放行 127.0.0.1/localhost 的 5173/5198 dev 端口,可 env 覆盖)——**不得破坏用户日常 5173→8787 使用**;/api/snapshot 收权;P0-02 全部导入路径(文章/订阅/候选/后台)共用 guardedFetch:逐跳 DNS 解析拒私网/loopback/link-local(IPv4+IPv6)、redirect 上限、连接+总超时、响应字节上限、content-type 白名单;config-gated(AITIMELINE_ALLOW_PRIVATE_FETCH=true 供本地 fixture/smoke,按 CLAUDE.md 约定)。
测试锁:私网 URL 被拒断言;超大响应截断断言;smoke 显式开 allow-private 跑 loopback fixture。

### W6-D:来源版本与溯源链(E 合并后,迁移敏感)
P1-07 chunk 带 content-hash 版本,citation 绑定不可变版本 id,同 URL 重导内容变化产生新版本(新卡引新版,旧卡证据不漂移);P1-10 followup 携带原 registry/chunks + derivedFromPostId + 根 source/chunk id,溯源 DAG 可递归回到外部原文(同源跟进绕门禁的既有设计不变,只修链路)。
测试锁:同 URL 两版内容断言当前卡证据来自对应版本;followup citation 能解析回根文章断言。

### W7-G:Web 状态与信任面逻辑(App.tsx 重区,A/E 合并后;可与 W8-M 并行)
信任面:P1-13 demo 卡只在显式 fixture 开关下出现(connected+空库走真空态,绝不给 demo id 发 signal);P1-14 生产路径删 YouTube mock 兜底(导入失败明确报错);P1-15 徽章条件收紧(grounded && citations>0 才认证,系统/派生内容用区分标签);P1-11 web 渲染持久化后的回复引用(复用现有引用 UI 形态)。
状态机:P1-18 按 post 串行的持久化 outbox+退避重试+ack 版本;P1-19 web 三档 grade 接 api + 失败回滚 tombstone;P1-26 libraryCards(snapshot.posts)与 feedCards(timeline.posts)分离,图谱/反链/技能树/复习/通知详情走 library;P2-06 证据缓存分 loading/error/not-found+重连重试;P2-07 图谱签名含边 id/指向/权重;P2-08 草稿与在途请求按 cardId 隔离;P2-09 web 侧 connection_note 不上报生产型 dwell;P2-10 轮询 AbortController+超时;P2-11 4xx 不算离线+YouTube host 精确匹配;P2-12 notes 空串 fallback;P2-13 可见性恢复重启计时。
体量大,派工时视情况拆 G1(信任面)/G2(状态机)两单串行。UX 报告的代码级发现分诊后并入本批。

### W8-M:mobile 三件套(A 合并后,文件不相交,可与 G 并行)
P1-18 store updater 外部变量赋值 bug;P1-19 mobile 接 review complete + grade;P1-15 keyTakeaway 不得标"原文出处"。

### 主会话亲自做(不派工)
**复习前端闭环(W1-A 合并后立即做,用户每天在用)**:UX-P0-1 web 侧答案绑定到期 prompt 的 answerHint;UX-P0-2 三档按钮接 grade 参数 + 每档显示"下次复习时间+原因";UX-P1-1 保存确认后才完成、失败可重试不假报;UX-P2-5 完成页给题数/评分分布/下次时间。
P1-12 深读段落引用锚点 UI(新界面,设计语法敏感);UX 报告的视觉/设计类发现(清单见下);每波验收、合并、生产部署(E/D 波合并前备份 `apps/api/data/`)。

## UX 报告分诊(P0 2 / P1 21 / P2 9 → 四个去向)

**并入修复批次**:UX-P0-1(答案错配)→ W1-A(api)+主会话(web);UX-P0-2(忘了延长间隔)= P1-19 → W1-A+主会话;UX-P1-1(假报完成)→ 主会话复习闭环;UX-P1-7/8(兜底伪装回答、想法关联跑偏)→ W1-C(fail-closed 拒绝文案须面向用户可读)+ W7-G(前端"未启用模型"标注);UX-P1-6(原文不能外开+示例卡穿帮)→ W7-G;UX-P1-10(整理失败无原因)最小修 → W7-G;UX-P1-11(4xx 全局离线+英文穿帮)= P2-11 → W7-G(补订阅表单预校验);UX-P1-16(回放空白期起播)→ W7-G;UX-P2-7 系统错误本地化 → W7-G。

**主会话 UI 队列**(视觉/设计/文案,按用户反馈随时插队):UX-P1-4 推荐理由文案降监控感;UX-P1-5 发帖/想法入口与隐私说明;UX-P1-14 主题分块组级标识;UX-P1-15 图谱图例+hover tooltip(最小版);UX-P1-18 技能树语义(0/6 vs 缺口)与下一步动作;UX-P1-19 深读显式按钮;UX-P1-20 兜底深读预期管理与折叠;UX-P1-21 1024 宽度断点;UX-P2-1 新卡"刚加入"标记;UX-P2-2 通知空态 CTA;UX-P2-3 图标 coachmark;UX-P2-4 详情长标题碰撞;UX-P2-6 暗色次级文字对比度;UX-P2-8 深读生成/阅读打磨;UX-P2-9 右栏数字单位。

**上线批次(等用户发令,与冷启动引导合流)**:UX-P1-2 首屏价值主张与三步闭环;UX-P1-3 自动生产首次 opt-in 与额度说明;UX-P1-9 发现页订阅 0 CTA 与"一次搜源 vs 持续订阅"。

**产品 backlog(超出 bug 战役,另立单)**:UX-P1-9 候选队列可管理化(筛选/去重/批量);UX-P1-12 智能体/设置信息架构重组;UX-P1-13 视图/详情/概念路由化(URL/历史);UX-P1-15/17 图谱与边界的搜索、筛选、Top N。

## 明确不在本战役(记录在案)
- 架构项:SQLite 迁移、server.mjs/App.tsx 拆分、node:test 基座、前端 lazy-load——体检报告 §4 建议 8-12,等本战役收尾后另立。
- 上线批次(等用户发令):LICENSE(要用户拍板)、README 重写、gitleaks 全历史、一键起步、冷启动引导、i18n 审计、.env.example 补全(含 W5 新增的 auth/CORS/fetch 配置,W5 顺手补)。
- docs/e2e/runs 约 128MB 仓库瘦身——housekeeping,择机单做。
- web/mobile 行为级变异(#3 handleDwell、#4 markReviewed)在无前端测试基座前无法根治,随架构项解决。

## Bug → 批次对照表(46 条,每条恰好一处)

| 批次 | 条目 |
|---|---|
| W1-C | P1-01 02 03 04 05 06 08 09 16,UX-P1-7/8(core 侧) |
| W1-H | P1-27 |
| W1-A | P0-03,P1-17 19(api) 22 25,P2-02 03 04 05,UX-P0-1(api) |
| W2-F | P1-20 23,P2-01 09(core) 14 |
| W4-E | P0-04 05,P1-11(存取) 21 24 |
| W5-B | P0-01 02 |
| W6-D | P1-07 10 |
| W7-G | P1-11(渲染) 13 14 15(web) 18(web) 19(web) 26,P2-06 07 08 10 11 12 13,P2-09(web) |
| W8-M | P1-15 18 19(mobile) |
| 主会话 | P1-12,复习前端闭环(UX-P0-1/P0-2/P1-1/P2-5 web 侧),UX 视觉队列 |

## 执行约定

执行者 Codex CLI(gpt-5.6-sol ultra),每波独立 worktree+分支,六段任务书引用本 spec 对应小节;波内验收流程照旧(CI 绿→精读 diff→对抗审查→沙盒实测→请示合并);每波合并后同步 main、重建、按需重启 8787,再发下一波。
