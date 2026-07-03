# 2026-07-03 — Obsidian 式双链 + 知识图谱可视化

分支 `feat/wikilinks-graph`。给知识库加上 `[[…]]` 双链、反向链接区,以及一个自研 Canvas 力导向的知识图谱视图。

## 环境

- Web:Vite dev(apps/web),API:本地 Node HTTP API + worker(`apps/api`)。
- 截图用 `docs/e2e/cdp-shot.mjs`(headless Chrome + CDP)。
- 主列宽约 600px,图谱画布高 70vh,`devicePixelRatio` 已处理。

## 数据说明

`[[RAG]]` 里的 RAG 概念只存在于**离线 demo 卡片**里;一旦有任何来源被导入,应用就会用真实 API 帖子替换 demo 卡片,而本地 fixtures(`/fixtures/article`)产出的概念是英文的
`AI Agent / Knowledge Graph / Memory / Recommendation`,没有 RAG。所以为了让「可解析概念链接 + 幽灵链接」两种状态都真实出现,示例笔记链接的是 fixtures 里确实存在的概念
`[[Memory]]`(解析成蓝色概念链接)加上 `[[不存在的东西]]`(解析不到 → 灰色幽灵链接)。功能与截的两种链接状态与任务一致,只是概念词换成了本地库里真的有的那个。

种子步骤:
1. `POST /api/import/article`(`/fixtures/article`)→ 两张卡:`AI Agent`;`Knowledge Graph / Memory / Recommendation`。
2. `POST /api/notes`,正文含 `[[Memory]]` 和 `[[不存在的东西]]`。

## 截图

| 文件 | 说明 |
| --- | --- |
| `01-note-wikilinks-light.png` | 时间线上的笔记:`Memory` 渲染成蓝色概念链接,`不存在的东西` 渲染成灰色虚线下划线的幽灵链接(hover 提示「还没有这条内容」,不可点)。 |
| `02-graph-light.png` | 图谱视图(明)。「图谱」为默认 x-tab,旁边是「边界」。绿色实心圆 = 概念枢纽(此处四个概念都在「学习区」→ 绿色 `--x-repost`);灰色小点 = 卡片/笔记节点;虚线空心圈 = 幽灵节点「不存在的东西」;1px 连线为 mentions / wikilink 边。 |
| `03-graph-dark.png` | 图谱视图(暗)。画布背景纯黑,颜色随主题从 CSS 变量实时读取。PIL 抽查:画布区域 99.3% 像素为 `(0,0,0)`,取样点全为纯黑。 |
| `04-drawer-backlinks-light.png` | 来源详情抽屉里的「反向链接」节:列出用 `[[Memory]]` 提到本卡概念的那条笔记(来源标题 + 片段),点击可打开来源帖。 |

## 交互脚本

`scratchpad/ix/*.js`(喂给 cdp-shot 的 evalFile):等待 `.x-wikilink` 出现并滚到笔记;切到图谱 tab 等力导向收敛 ~4s;暗色用 `t` 键切主题;抽屉找到含「反向链接」的 section 滚入视口。

## 验证

`npm run typecheck && npm run build && npm test` 全绿(smoke:core / smoke:api / smoke:model 全过,新增双链断言在 smoke-core 内)。
