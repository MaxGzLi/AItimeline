# @aitimeline/mobile

AITimeline 的 React Native (Expo) 手机端 v1 —— X 风格的移动界面。连接你电脑上跑的本地 API,手机和电脑在同一 Wi-Fi 下即可使用。

底部四个 tab:**时间线 / 发现 / 复习 / 设置**;时间线右下角有蓝色悬浮发帖按钮。

## 先决条件

- Node ≥ 20,已在仓库根目录 `npm install`。
- 手机装 [Expo Go](https://expo.dev/go)。
- 手机和电脑连同一个 Wi-Fi。

## 在真机上运行(Expo Go)

1. **编译 core**(手机端通过 Metro 引用 `packages/core/dist`,须先构建一次;改动 core 后要重跑):

   ```bash
   npm run build -w @aitimeline/core
   ```

2. **启动 API,并绑定到局域网**(默认只监听 127.0.0.1,手机访问不到):

   ```bash
   AITIMELINE_HOST=0.0.0.0 AITIMELINE_ENABLE_FIXTURES=1 npm run dev:api
   ```

   > 安全提示:`0.0.0.0` 会把这个无鉴权、无 SSRF 防护的本地 API 暴露给同网段所有人,只在可信局域网里这么用。

3. **查电脑的局域网 IP**(如 `192.168.1.23`):macOS `ipconfig getifaddr en0`,Windows `ipconfig`。

4. **启动 Expo**(在本目录或仓库根都行):

   ```bash
   npm run start -w @aitimeline/mobile
   # 或 cd apps/mobile && npx expo start
   ```

   用 Expo Go 扫描终端里的二维码。

5. 在 app 的 **设置 tab** 里,把「API 地址」改成 `http://<电脑局域网IP>:8787`(如 `http://192.168.1.23:8787`),下面的连接状态显示「已连接」即可。地址会存在手机本地(AsyncStorage),下次自动带出。

## 在浏览器里预览(Expo web)

用于快速看界面(视觉验证也是走这个),不需要真机:

```bash
npm run build -w @aitimeline/core   # 同样要先编译 core
npm run web -w @aitimeline/mobile   # 起在 http://localhost:8081
```

Expo web 是 react-native-web 渲染,和真机有细微差异;交互行为以 Expo Go 真机为准。

## v1 功能范围

- **时间线**:`GET /api/timeline` 推荐信息流、下拉刷新、点赞/收藏(`POST /api/signals`)、内联回复线程(`POST /api/posts/:id/replies`)、悬浮按钮发笔记(`POST /api/notes`,发布后显示观察员回帖)。
- **帖子详情**:标题/正文/要点、出处引用、概念标签、评论线程 + 回复框。
- **发现**:`GET /api/snapshot` 的候选来源(状态 chip)+「立即整理」(`POST /api/curation/run`)。
- **复习**:复用 `packages/core` 的 `createReviewQueue`,逐题「显示答案 → 记得/模糊/忘了」,打分记一条 `reviewed` 信号(暂不影响间隔)。
- **设置**:API 地址(AsyncStorage)、主题(跟随系统/浅色/深色)、`/health` 连接探测。

## 明确不做(v2)

图谱可视化、双链渲染、智能体机器房、来源导入、证据账本、推送。

## 工程说明

- **复用 core**:`packages/core` 是纯逻辑 TS,手机端直接 `import { createReviewQueue, ... } from "@aitimeline/core"`,不复制核心逻辑。类型走包的 `exports`(源码),运行时由 `metro.config.js` 把裸导入指到编译产物 `dist`(core 的 ESM `.js` 导入说明符 Metro 不会自动映射到 `.ts`,所以打包已编译的 JS)。
- **monorepo Metro**:`metro.config.js` 配了 `watchFolders` + `nodeModulesPaths`,让 Metro 能解析仓库根的 hoisted 依赖。
- **单例 react/react-native**:根 `package.json` 的 `overrides` 把 react/react-dom/react-native 锁到单一版本,避免 Metro 撞见多份拷贝。
- **不参与根 build**:mobile 没有 `build` 脚本(RN 打包不进 CI);`typecheck`(`tsc --noEmit`)被根 `npm run typecheck` 覆盖。
- API 响应类型从 `apps/web/src/lib/types.ts` 复制(文件头有来源注释),两端 UI 层各自维护。
