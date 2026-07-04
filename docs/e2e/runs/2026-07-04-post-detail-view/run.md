# 2026-07-04 — X 式主栏帖子详情页 + 右栏联动

分支 `feat/post-detail-view`。点帖子后主栏切换为详情页(返回栏/Esc 返回,滚动位置恢复),右侧抽屉退役;时间线长正文折叠 4 行 + 「显示更多」。详情页打开时右栏联动:知识定位(概念 × 边界区域徽标)+ 局部图谱(一跳邻域)。Spec:`docs/specs/2026-07-04-post-detail-view.md`(含增量节)。

## 环境

- API:`PORT=8792 npm run dev:api`(隔离数据,截图前清空)。
- Web:`VITE_AITIMELINE_API_URL=http://127.0.0.1:8792 npm run dev -w @aitimeline/web -- --port 5182`。
- 截图:`docs/e2e/cdp-shot.mjs` + `docs/e2e/interactions/post-detail-view.js`(hash 选模式:无 hash=feed,`#detail`=进详情,`#darkdetail`=暗色详情;无头 focus 坑同 wikilink-autocomplete 脚本)。
- 种子:import /fixtures/article + 两条笔记(一短一长,长的用于验证折叠)。

## 交互脚本信号

- feed:`posts=4;showMore=1`(仅长笔记出现「显示更多」)
- detail light:`replies=2;askMessages=2;sections=10`(发评论收到观察员回复;问 AI 有来源回答)
- detail dark:同上(replies 累计 4)

## 截图

| 文件 | 说明 |
| --- | --- |
| `00-timeline-clamp-light.png` | 时间线:长笔记 4 行折叠 + 蓝色「显示更多」;短帖无该链接。 |
| `01-detail-light.png` | 主栏详情页(明):返回栏、完整正文、出处、评论线程、问 AI、知识块等 10 个分区;右栏=知识定位(3 概念 × 学习区徽标)+ 局部图谱 + 今日复习。 |
| `02-detail-dark.png` | 同场景(暗)。 |

## 验证

`npm run typecheck && npm run build && npm test` 全绿(Codex 主体实现自验 + 验收人独立复跑;右栏联动为验收人实现)。
