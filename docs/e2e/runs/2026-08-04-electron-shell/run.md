# Electron 壳截图验收记录

## 当前环境结果

- 标准 Web 构建、arm64 `.app` 和 ZIP 已由 electron-builder 真实生成；ZIP 完整性检查通过。
- 当前 Codex 进程直接启动任意 Electron GUI 都会在 macOS `RegisterApplication` 阶段收到 `SIGABRT`；Computer Use 也未获准读取这个本地未签名应用。因此这里无法取得可信的桌面窗口截图。
- DMG 已进入系统 `hdiutil create` 阶段，但受限环境返回“设备未配置”；需在普通 macOS 会话补跑。这个限制不影响 `.app` / ZIP 的生成。

## 验收机补拍

在仓库根目录执行：

```bash
npm ci
npm run dist -w @aitimeline/desktop
node docs/e2e/runs/2026-08-04-electron-shell/capture.mjs
```

第三条命令使用临时 `userData` 启动打包版；出现系统截图十字光标后点击 AITimeline 窗口。图片会保存为本目录的 `desktop-window.png`。随后用 `Cmd+Q` 正常退出；脚本会断言两把写锁均已释放，再清理临时数据。

截图至少应能看到：原有 AITimeline 左侧导航、信息流主界面，以及原生 macOS 窗口边框。
