# AITimeline

AITimeline 是一个 open-core AI 知识流项目：开源部分负责 agent 工作流、知识卡片、排序、图谱和复习内核；商业 App 负责托管运行、多端同步、AI 互动额度、默认知识源和更完整的个人知识体验。

## Product Direction

目标不是做一个普通信息流，而是做一个会持续帮用户积累知识储备的 timeline：

- Agent 自动搜索、去重、总结和排序内容。
- 用户像刷信息流一样阅读知识卡片。
- 点赞、收藏和追问会沉淀进个人知识图谱。
- 不懂的点可以在卡片下和 AI 继续对话。
- 系统根据图谱薄弱点和遗忘曲线推送复习。

## Repo Shape

```text
apps/api          Local MVP API and background worker surface
apps/desktop      Electron desktop shell
apps/web          Hosted App 的 Web 原型
packages/core    可开源的知识流内核
docs             产品、商业、架构和上线策略
```

## Open-Core Boundary

开源内核优先服务开发者、重度知识用户和自托管玩家；收费 App 服务普通用户。

- 开源：agent runtime、connector 接口、知识卡片 schema、排序基础逻辑、图谱和复习算法、BYO API key。
- 收费：云端自动运行、多设备同步、高质量默认源包、AI 互动额度、深度研究、个性化长期记忆、移动端体验。

详见 [docs/product-strategy.md](./docs/product-strategy.md) 和 [docs/monetization.md](./docs/monetization.md)。

## Local Development

```bash
npm install
npm run dev:api
```

In another terminal:

```bash
npm run dev
```

Then open the local URL printed by Vite.

Run the local API/worker surface in a separate terminal when testing source ingestion and background curation:

```bash
npm run dev:api
```

The API listens on `http://127.0.0.1:8787` by default and stores local JSON snapshots under `apps/api/data/` unless `AITIMELINE_DATA_PATH` or `AITIMELINE_CURATION_DATA_PATH` is set.

## 桌面版

桌面版把标准 Web 构建产物、API 和常驻 worker 装进同一个 Electron 应用。开发模式仍使用当前 worktree 的 `apps/api/data/`；打包版的数据和配置则放在 `~/Library/Application Support/AITimeline/`。关闭最后一个窗口不会退出 macOS 应用，使用 `Cmd+Q` 才会停止 worker 并释放数据锁。

开发启动（会先构建 core 和 web）：

```bash
npm run dev -w @aitimeline/desktop
```

如果同一 worktree 的 `npm run dev:api` 正在运行，它会持有相同数据文件的写锁；先退出其中一个，再启动另一个。桌面 API 优先监听 `127.0.0.1:8791`，端口已占用时会自动使用随机端口，Web 页面通过 preload 获得实际地址。

生成未签名的 macOS Apple Silicon 安装包：

```bash
npm run dist -w @aitimeline/desktop
```

产物位于 `apps/desktop/dist/`，同时包含 DMG 和 ZIP。首期没有签名或公证；若 Gatekeeper 拦截，使用 Finder 的“右键 → 打开”。

### 桌面配置

把模型、搜索等变量写入 `~/Library/Application Support/AITimeline/config.env`，格式与仓库 `.env` 相同，然后完全退出并重新打开应用。例如：

```dotenv
AITIMELINE_MODEL_BASE_URL=https://api.openai.com/v1
AITIMELINE_MODEL_NAME=your-model
AITIMELINE_MODEL_API_KEY=your-api-key
```

`config.env` 不会覆盖启动环境中已经存在的同名变量。没有配置时，现有确定性回退仍然可用。开发模式还会读取仓库根目录的 `.env`，同样不覆盖已经加载的值。

### 从浏览器版搬家

搬家前先记录浏览器版的信息流卡片数、复习队列数和图谱概念数，并确保桌面应用和本地 API 都已退出。不要在任一进程仍运行时复制数据文件。

1. 在浏览器版页面的开发者工具 Console 执行下面这行；它会把当前 origin 的全部 localStorage 复制到剪贴板，值保持为 localStorage 所需的原始字符串。

   ```js
   copy(JSON.stringify(Object.fromEntries(Object.entries(localStorage)), null, 2))
   ```

2. 创建用户数据目录，把剪贴板内容原样保存为 `~/Library/Application Support/AITimeline/import-localstorage.json`。文件顶层必须是对象；当前关键项是 `aitl-theme`、`aitl-language`、`aitimeline.mvp.v3` 和 `aitimeline.synced-signals.v1`。
3. 在仓库根目录复制服务端快照、策展队列和媒体文件。目标目录若已有数据，先自行备份并确认应覆盖哪些文件。

   ```bash
   DESKTOP_DATA="$HOME/Library/Application Support/AITimeline"
   mkdir -p "$DESKTOP_DATA/media"
   cp apps/api/data/aitimeline.json "$DESKTOP_DATA/aitimeline.json"
   cp apps/api/data/curation-jobs.json "$DESKTOP_DATA/curation-jobs.json"
   cp -R apps/api/data/media/. "$DESKTOP_DATA/media/"
   ```

4. 打开桌面应用。首个窗口会在显示前导入 localStorage、重载并逐项验证；成功后输入文件会改名为 `import-localstorage.done`。如果导入失败，原 `.json` 会保留，便于修正后重试。
5. 对照搬家前记录，检查信息流卡片数、复习队列和图谱概念数，并打开一条带媒体的卡片确认附件可读。确认无误前保留原浏览器数据和服务端目录备份。

## Model Client

The core package includes a server-side source import worker and an OpenAI-compatible model client adapter. The worker can run deterministic transforms or call any provider that exposes a compatible `/v1/chat/completions` endpoint, then feed the JSON response into the harness repair and grounding gates.

Copy [.env.example](./.env.example) when wiring a backend or worker:

```bash
AITIMELINE_MODEL_BASE_URL=https://api.openai.com/v1
AITIMELINE_MODEL_NAME=your-model
AITIMELINE_MODEL_API_KEY=your-api-key
```

Do not call model providers directly from the browser with a user or product API key. Use the adapter from a server, worker, CLI, or self-hosted runtime.

### Command runner (no API key)

If you have no API key but do have a command-line coding agent on the machine, point AITimeline at any command that reads a prompt on stdin and prints the answer on stdout. The command runs through `sh -c`; its stdout (trimmed) is the model answer, and a non-zero exit, a timeout, or empty output fails the run so the deterministic fallback stays in charge.

```bash
# Any of these; the command is yours to choose.
AITIMELINE_MODEL_COMMAND='claude --bare -p --model sonnet'
AITIMELINE_MODEL_COMMAND='codex exec'
# Optional; defaults to 120000.
AITIMELINE_MODEL_COMMAND_TIMEOUT_MS=120000
```

`AITIMELINE_MODEL_COMMAND` takes priority over the OpenAI-compatible variables above. `AITIMELINE_MODEL_DEEPREAD_*` keeps its own meaning: it still overrides deep-read generation, and deep read falls back to the command runner when it is unset.

The runner is vendor-neutral: AITimeline never detects, logs into, or special-cases any particular CLI. You supply the command, and the quota and terms of service of whatever tool it invokes are yours to manage. To use Anthropic models with an API key instead, the existing OpenAI-compatible endpoint works too.

Source discovery is optional and off by default: set `AITIMELINE_SEARCH_API_KEY` (Tavily) to let `discover_sources` jobs and dark-zone agent questions pull real source candidates. Without a key the app stays network-free and discovery proposals are surfaced to the user instead of executed.

The local API auto-selects the import runner from the environment: when `AITIMELINE_MODEL_COMMAND` or `AITIMELINE_MODEL_NAME` (or `OPENAI_MODEL`) is set it imports articles and YouTube transcripts through the model-backed runner; otherwise it falls back to the deterministic template runner, so the default setup stays network-free. Both `transformArticleUrl` and `transformYouTubeUrl` also accept a `runner` option for callers that wire their own model client.

## Verification

```bash
npm run typecheck
npm run build
npm run smoke:core
npm run smoke:api
npm run smoke:model
npm run smoke:desktop
```

`smoke:core` builds `@aitimeline/core`, imports the compiled `dist` output in Node, and checks source import, YouTube transcript import, article import, model repair, grounding validation, cross-card connections, the concept whole-view digest and background curation execution.

`smoke:api` starts the local API on a temporary port and checks article import, timeline reads, memory edits, interaction signals, queued curation jobs, background source import persistence, grounded card Q&A (`POST /api/ask`), background source discovery through an injected search provider, and the agent entry (`POST /api/agent/ask`: grounded turns, dark-zone discovery proposals and turn metering).

`smoke:model` injects a fake model client and checks that the article and YouTube transforms run the model-backed runner when given one (the model output reaches the card and passes schema + grounding), that grounded card Q&A (`askGrounded`) answers from the post's cited source chunks, that a stub CLI driven through the command runner reaches the card and fails closed on a non-zero exit, and that all paths fall back to deterministic behavior when no model is configured.

`smoke:desktop` uses only temporary directories and a random loopback port to check `config.env` merging, desktop CORS, API startup, HTTP health, clean lock release, and the documented server-data/localStorage migration copy. `npm test` runs the core, API, model, MCP and desktop smokes together.

## Current MVP

第一版先验证四件事：

1. 用户是否愿意刷 AI 整理过的知识卡片。
2. 用户是否会对卡片持续追问。
3. 点赞内容是否能自然沉淀成知识图谱。
4. 复习提醒是否让用户感到自己真的在变聪明。

The current prototype also includes a mocked YouTube import flow: paste a YouTube URL, simulate transcript extraction, convert transcript segments into cited knowledge cards, insert those cards into the ranked timeline, inspect source citations, ask source-grounded AI questions, and keep the imported state in local storage.

The local API now exposes the first backend loop: import article or YouTube sources, persist source artifacts and release plans, record interaction signals, update editable user memory, enqueue background curation jobs, run due source imports, and answer source-grounded questions about a card (`POST /api/ask`). When a model is configured the answer comes from the model grounded in the card's cited chunks; otherwise it falls back to a deterministic extractive answer. The Web prototype reads timeline state from the API, imports URLs through the API, asks grounded follow-up questions through the API (with an offline fallback), links each card to other cards you have collected through the agent's concept graph (so fragments accumulate into a connected whole instead of an isolated stream), lets you click any concept (on a card or in the Saved Concepts rail) to read every fragment touching it as one ordered foundations-to-contrasts thread, queues source candidates for later background packaging, syncs likes/saves/questions into memory, tracks viewport dwell, and runs a bounded page-visible auto scout for due curation jobs.

## Next Planning Docs

- [docs/vision.md](./docs/vision.md): 更新后的产品愿景、主旨和防竞争定位。
- [docs/competitor-landscape.md](./docs/competitor-landscape.md): 竞品研究、开源项目借鉴和复用判断。
- [docs/agent-harness.md](./docs/agent-harness.md): Agent Harness v0，定义知识帖、thread、图谱、复习和反馈策略。
- [docs/roadmap.md](./docs/roadmap.md): 前后端、agent、知识库、记忆和推荐系统的阶段路线。
- [docs/knowledge-transformation.md](./docs/knowledge-transformation.md): YouTube、文章、论文等来源如何被 agent 转化成 timeline 知识卡。
- [docs/knowledge-loops.md](./docs/knowledge-loops.md): 供给闭环（知识源源不断）与掌握闭环（细化、保留、复习到学会）的设计，以及后续功能优先级。
- [docs/groundedness.md](./docs/groundedness.md): 正确性保障体系——已有防线、已知局限和 L1-L7 分层加固路线。
- [docs/agent-entry.md](./docs/agent-entry.md): 产品级 Agent 入口——知识边界模型、回答协议、发散拓展机制与计量收费。
