# 英语模式(界面切英语 + 新内容产英语,老内容不变)

## 背景

用户要在 X 上推广,需要一键把产品切成英语:界面文案变英语,**新产出**的内容(导入卡、跟进卡、观察员回帖、Q&A)用英语生成;**已有内容一律不动、不翻译**。默认语言仍是中文。

现状事实(2026-07-06 排查):

- **无任何 i18n 基础设施**:web 没有 locale 状态、无翻译字典;唯一持久化偏好是主题(`localStorage["aitl-theme"]`,App.tsx:465-467)。设置页 `apps/web/src/views/SettingsView.tsx` 只有主题/API 状态/模型说明/快捷键四项。
- **界面中文字面量的分布**:`apps/web/src/lib/format.ts` 集中了约 20 个中文 label/日期函数(formatRelativeTime:288-318 的「N小时」、formatSignalChips:127、getAgentName:46 等,locale 全部写死 `zh-CN`);「N 分钟读完」内联在 `components/PostView.tsx:244` 和 `components/PostDetailView.tsx:178`;其余散在 App.tsx 和各 view/component 的 JSX 里。
- **内容语言门禁**(#85):`packages/core/src/harness/contentLanguage.ts` — `ContentLanguage` 类型目前只有 `"zh"`;`calculateCjkRatio`(CJK 字数 ÷ (CJK 字数+拉丁词数),阈值 0.3);只在 `modelRunner.ts:112-114` 一条路把关(导入知识卡),跟进卡/回帖/Q&A 未接。修复重试 2 轮后按卡丢弃。
- **提示词中文方针**在四处:`harness/systemPrompt.ts:32-38`、`harness/followupHarness.ts:75-83`、`harness/askGrounded.ts:156-159`、`harness/modelRunner.ts:190-212`(修复指引 :316)。`postHarness.ts` 无语言方针。
- **确定性回退中文模板**:`harness/runner.ts:69`、`harness/modelRunner.ts:87`、`transform/articleImport.ts:148`、`transform/youtubeImport.ts:160`、`transform/mockYoutubeImport.ts:41`、`transform/noteImport.ts:48,84`、`agents/conversationAgent.ts:93-96,218-251`、`agents/backgroundCuration.ts:244,267`。回退卡正文语言=来源语言(不翻译,维持)。
- **服务端配置**:`AITIMELINE_CONTENT_LANGUAGE` env(zh 默认|none 关闭),`server.mjs:542-554`;snapshot 无用户偏好字段,无 /api/settings 接口。

## 方案

### 1. 语言设置(一个开关管两件事)

- 设置页加「语言 / Language」项:`中文` / `English`,单选。
- **界面语言**:web 端 `language` 状态,持久化 `localStorage["aitl-language"]`,立即生效。
- **内容语言**:同一开关同步写服务端——snapshot 新增 `userSettings: { contentLanguage?: "zh" | "en" }`(persistenceStore 加字段,旧快照缺省视为 zh,做好迁移兼容);新增 `GET /api/settings`、`POST /api/settings`。优先级:用户设置 > `AITIMELINE_CONTENT_LANGUAGE` env > `"zh"`。
- web 启动时从 `GET /api/settings` 对齐;API 离线时用 localStorage 值,恢复连接后同步。

### 2. 界面 i18n(全量清扫,先列清单再动手)

- 建轻量字典层 `apps/web/src/lib/i18n.ts`:`zh`/`en` 两张字符串表 + `t(key)`(或等价的极简实现,**不引第三方 i18n 库**)。
- **动手前必须先产出完整清单**:枚举 `apps/web/src` 全部用户可见中文字符串(App.tsx、views/*、components/*、lib/format.ts、lib/*),清单落在 PR 描述或 spec 附录;收尾附 grep 证明(源码中 CJK 字面量只允许出现在 i18n 字典文件里,`grep -rP '[\x{4e00}-\x{9fff}]' apps/web/src --include='*.tsx' --include='*.ts' -l` 的结果只剩字典文件)。
- `format.ts` 全部函数改为 locale 感知(读全局 language;日期用 `zh-CN`/`en-US` 相应 locale);「N 分钟读完」→「N min read」等。
- 英文文案基调:简洁地道的产品英语,不逐字直译。观察员名(getAgentName)给对应英文名。

### 3. 内容语言(只影响新产出)

- `ContentLanguage` 类型扩为 `"zh" | "en"`。
- **门禁双向化**:`validateKnowledgePostContentLanguage(post, language)` — zh 要求 cjkRatio ≥ 0.3(现行为);en 要求 cjkRatio < 0.3(即以英文为主),修复提示相应换成英文指引。阈值与字段清单不变。
- **提示词参数化**:上面四处 Language policy 块按传入语言二选一(zh 保持现文案;en 版:全部面向用户字段用英语书写、引用逐字保留原文、概念/graphEdges 命名规则不变)。`contentLanguage` 从 server 侧读用户设置后传入:source-import worker(已有通道)、followupHarness、askGrounded、postHarness(补上 Language policy 注入点)。
- **确定性回退模板**:上列 8 处中文模板给英文变体,按语言设置选择;回退卡正文语言=来源语言的行为不变。
- **老内容不变**:任何已存在的 post/thread/memory 不重写、不翻译。中英内容可以混在同一条时间线里(切换后的自然结果,接受)。

### 4. 明确不做

- 不翻译/重写任何已有内容;不做「双语并存」或按卡片选语言。
- 不做浏览器语言自动检测、URL 路由 i18n、SEO。
- `apps/mobile` 不在本期(其内联中文不动)。
- 不改 cjkRatio 算法与 0.3 阈值本身。
- 不动排序、生命周期、图谱等无关模块。

## 验证标准

- `npm run typecheck`、`npm run build`、`npm test` 全绿。
- **smoke 扩展(必须)**:smoke-core 增加断言——en 模式下门禁拒中文卡/放行英文卡、en 提示词块被选中、确定性回退模板输出英文;smoke-api 增加 `/api/settings` 读写与持久化断言。全程网络免依赖。
- 截图(`docs/e2e/runs/2026-07-06-english-mode/`):设置页语言项;切 English 后的时间线、图谱、复习、发现各一张(界面全英文、老中文卡内容原样);切回中文恢复。
- 功能验证:无模型配置下,English 模式发一条笔记/跑一次导入,确定性产物的 `recommendedBecause` 等模板文案为英文。
- 清扫证明:CJK 字面量 grep 结果只剩 i18n 字典文件(测试/注释除外,注释不要求翻译)。
