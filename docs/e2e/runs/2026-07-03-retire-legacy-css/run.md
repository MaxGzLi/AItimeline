# 旧样式表退役 · 截图核对

分支 `chore/retire-legacy-css`。把仍依赖旧 `styles.css` 的残余组件迁到 X 风格 `xshell.css` 的 `x-` 命名空间,然后删除 `styles.css`。

工具:`docs/e2e/cdp-shot.mjs`,视口 1440 宽。API 用 `AITIMELINE_ENABLE_FIXTURES=1 npm run dev:api`,Vite 在 127.0.0.1:5173。
无头 Chrome 默认 `prefers-color-scheme: dark`,故明色截图在交互脚本里显式 `data-theme="light"`。

## 截图

| 文件 | 场景 | 核对结论 |
| --- | --- | --- |
| `01-drawer-light.png` | 来源详情抽屉(点卡片正文)· 明色 | 白底 rgb(255,255,255)、深色文字 rgb(15,20,25);扁平分节、1px 细线;证据账本 通过/警告/失败 三色胶囊、SUMMARY/THESIS 等主张块蓝色小标题正常。无白块/错位。 |
| `02-drawer-dark.png` | 来源详情抽屉 · 暗色 | 纯黑底 rgb(0,0,0)、浅色文字(PIL 抽查最亮 233,亮像素占 6.5%);三色状态、边框、蓝色标签均清晰可读。 |
| `03-concept-light.png` | 概念摘要弹层(点 #标签) | 居中白色模态 + 半透明遮罩;条目用 1px 细线分隔,「基础」角色胶囊蓝色描边(foundation→蓝),标题粗体、要点灰色。 |
| `04-agent-light.png` | 智能体机器房视图 | 四个 `x-mr` 分节;输入框改成 x-search 语言的圆角胶囊(module 底),蓝色 x-pill、描边 ghost 按钮、就绪状态绿色对勾;16px 对齐无错位。 |
| `05-shortcuts-light.png` | 快捷键弹层(? 键) | 居中白色模态,kbd 键位 + 灰色说明,1px 细线分隔,与概念弹层共用 `.x-overlay`/`.x-modal`。 |

## 暗色抽屉像素抽查(PIL)

```
drawer bg near top (1050,150) = (0,0,0)
drawer bg mid    (1200,1300) = (0,0,0)
drawer region: bright(>120)=6.5%  maxLum=233
```

背景真黑、文字真亮,排除「看起来黑其实白」的误判。

## 测试

`npm run typecheck && npm run build && npm test` 全绿(core/api/model 三个 smoke 均通过)。
