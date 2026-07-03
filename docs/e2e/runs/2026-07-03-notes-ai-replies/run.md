# 2026-07-03 · 笔记 + AI 回帖(后端落地)

发帖框的「发布」现在走 `POST /api/notes`:

1. 笔记转成一等来源(`user_note` 类型)+ 自我出处的帖子(citations 指向自己的
   registry chunk),立即出现在时间线,身份显示为「你的笔记 @you」。
2. 观察员用**发布前的库**跑一个 conversation turn 回帖(有出处才答,库外提议
   discovery),回复持久化在笔记帖的 thread 上,并计入 agentTurns 用量。

## 截图

- `note-posted-dark.png` — 通过发帖框发布「记一条:AI Agent 的自主性来自
  memory 和 evaluation 的循环。」后:流顶是 你 → 知识观察员 的回帖线程
  (边界标记 + grounded 回答 + 来源引用),笔记本身也作为帖子进入信息流
  (CDP 交互信号 `reply:yes note-in-feed:yes`)。

## 验证

- smoke-core 新增 transformUserNote 断言(自我出处、概念匹配、空笔记拒绝)
- smoke-api 新增 /api/notes 断言(user_note 来源、grounded 回复带引用、
  thread 持久化、agentTurns 计量、进入 timeline、写入记忆)
- 实测 API:`{"type":"user_note","intent":"grounded_qa","thread":1,"agentTurns":2}`
