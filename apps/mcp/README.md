# @aitimeline/mcp

把 AITimeline 暴露为本地 MCP 服务:你在外部 agent(Claude Code / Claude 等)里学习时,agent 通过三个工具把学习痕迹自动存进时间线。

## 工具

| 工具 | 作用 |
| --- | --- |
| `capture_source` | 对话中读过/引用过的 URL → 走导入管线成卡(质量门禁与每日预算照走) |
| `capture_conversation` | 一段讲解收尾后,把「用户问题 + 关键讲解」原文存为可引用的对话来源并成卡(卡片带「对话」标注) |
| `get_learning_context` | 只读:用户近期在学的主题与已确认概念,供 agent 因材施教 |

什么时候采、什么不采(闲聊调试不采、不采个人信息)写在 server instructions 里,接入后随 MCP 握手自动下发给 agent。

## 接入(Claude Code)

先启动本地 API(仓库根目录):

```bash
npm run dev:api
```

然后注册 MCP 服务:

```bash
claude mcp add aitimeline -- node /path/to/AItimeline/apps/mcp/src/server.mjs
```

验证:新开一个 Claude Code 会话,`/mcp` 里应能看到 `aitimeline` 与三个工具。

## 配置

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `AITIMELINE_API_URL` | `http://127.0.0.1:8787` | 本地 API 地址 |
| `AITIMELINE_API_TOKEN` | 空 | API 开启鉴权时的 Bearer token(loopback 默认不需要) |

本进程不直接调用模型、不直接读写快照文件;所有写入都经本地 API 的既有门禁与预算。
