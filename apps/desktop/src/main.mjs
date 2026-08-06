// @ts-check

import { existsSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  net,
  protocol,
  shell
} from "electron";
import {
  buildDesktopCorsOrigins,
  desktopOrigin,
  hasErrorCode,
  listenWithPortFallback,
  loadEnvironmentFile,
  readLocalStorageImport,
  resolveDataPaths,
  resolveStaticAssetPath
} from "./runtime.mjs";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../../..");
// The browser extension declares these ports in host_permissions and probes them
// in order, so the desktop app has to claim the same ones — an OS-assigned
// fallback port keeps the window working but leaves the extension unable to reach it.
const desktopPortCandidates = [8787, 8788];
const bindingHost = "127.0.0.1";
const localStorageImportName = "import-localstorage.json";
const localStorageDoneName = "import-localstorage.done";
const migrationPageUrl = `${desktopOrigin}/__desktop_migration__.html`;

/** @typedef {import("node:http").Server & { aitimeline?: { closeStores?: () => void } }} ApiServer */

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);

app.setName("AITimeline");
const hasSingleInstanceLock = app.requestSingleInstanceLock();

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {ApiServer | null} */
let apiServer = null;
let apiOrigin = "";
let allowQuit = false;
/** @type {Promise<void> | null} */
let startupPromise = null;
/** @type {Promise<void> | null} */
let shutdownPromise = null;

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // A shutting-down instance can no longer serve a window, and holding the
    // single-instance lock any longer would swallow this launch and every one
    // after it. Give up the lock instead.
    if (shutdownPromise) {
      app.exit(0);
      return;
    }

    if (!mainWindow) {
      if (!apiOrigin) return;
      void createMainWindow().catch(handleFatalStartupError);
      return;
    }

    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on("before-quit", (event) => {
    if (allowQuit) return;

    event.preventDefault();
    beginShutdown(true);
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (!mainWindow && apiOrigin && !shutdownPromise) {
      void createMainWindow().catch(handleFatalStartupError);
    }
  });

  // Electron holds the "ready" event until the ESM entry module finishes its
  // top-level evaluation, so a top-level `await app.whenReady()` deadlocks.
  void bootstrap();
}

async function bootstrap() {
  await app.whenReady();
  if (allowQuit) return;

  startupPromise = startApplication();
  try {
    await startupPromise;
  } catch (error) {
    if (shutdownPromise) {
      console.error("[aitimeline] desktop startup stopped during shutdown", error);
    } else {
      handleFatalStartupError(error);
    }
  } finally {
    startupPromise = null;
  }
}

async function startApplication() {
  const userDataPath = app.getPath("userData");
  loadEnvironmentFile(join(userDataPath, "config.env"));
  if (!app.isPackaged) loadEnvironmentFile(join(repoRoot, ".env"));

  const runtimeRoot = app.isPackaged ? app.getAppPath() : repoRoot;
  const apiModulePath = join(runtimeRoot, "apps/api/src/server.mjs");
  const webDistDir = join(runtimeRoot, "apps/web/dist");
  const dataPaths = resolveDataPaths({
    isPackaged: app.isPackaged,
    userDataPath,
    repoRoot
  });
  const { dataPath, curationDataPath, mediaRootDir } = dataPaths;
  const apiModule = await import(pathToFileURL(apiModulePath).href);
  const server = apiModule.createApiServer({
    host: bindingHost,
    dataPath,
    curationDataPath,
    mediaRootDir,
    worker: true,
    enableFixtures: true,
    corsOrigins: buildDesktopCorsOrigins(process.env.AITIMELINE_CORS_ORIGINS)
  });
  apiServer = server;

  try {
    const address = await listenWithPortFallback(server, desktopPortCandidates, bindingHost);
    apiOrigin = `http://${bindingHost}:${address.port}`;
  } catch (error) {
    if (apiServer === server) apiServer = null;
    server.aitimeline?.closeStores?.();
    throw error;
  }

  protocol.handle("app", (request) => {
    const filePath = request.url === migrationPageUrl
      ? join(currentDir, "migration.html")
      : resolveStaticAssetPath(request.url, webDistDir);
    return filePath
      ? net.fetch(pathToFileURL(filePath).href)
      : new Response("Not found", { status: 404 });
  });

  if (!shutdownPromise) await createMainWindow();
}

async function createMainWindow() {
  if (mainWindow) return mainWindow;
  if (!apiOrigin) throw new Error("AITimeline API has not started yet.");

  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    // 标题栏藏掉、红绿灯嵌进内容区(照 Codex 客户端);网页侧在桌面模式下
    // 给左上角让位并提供 -webkit-app-region: drag 的顶带。
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 14 },
    show: false,
    webPreferences: {
      preload: join(currentDir, "preload.mjs"),
      additionalArguments: [`--aitimeline-api-origin=${apiOrigin}`],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow = window;
  /** @type {Error | undefined} */
  let preloadError;

  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  window.webContents.on("preload-error", (_event, _preloadPath, error) => {
    preloadError = error;
  });

  installNavigationGuards(window);
  const localStorageEntries = readLocalStorageImport(join(app.getPath("userData"), localStorageImportName));
  await window.loadURL(migrationPageUrl);
  await assertDesktopBridge(window, preloadError);
  if (localStorageEntries) {
    await importLocalStorage(window, app.getPath("userData"), localStorageEntries);
  }
  await window.loadURL(`${desktopOrigin}/`);
  await assertDesktopBridge(window, preloadError);
  window.show();
  return window;
}

/**
 * @param {BrowserWindow} window
 */
function installNavigationGuards(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (isDesktopUrl(url)) return;
    event.preventDefault();
    openExternal(url);
  });
}

/**
 * @param {string} url
 */
function isDesktopUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "app:" &&
      parsed.hostname === "aitimeline" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port
    );
  } catch {
    return false;
  }
}

/**
 * @param {string} url
 */
function openExternal(url) {
  if (isDesktopUrl(url)) return;

  try {
    const protocol = new URL(url).protocol;
    if (protocol !== "http:" && protocol !== "https:") return;
  } catch {
    return;
  }

  void shell.openExternal(url).catch((error) => {
    console.error("[aitimeline] failed to open external URL", error);
  });
}

/**
 * @param {BrowserWindow} window
 * @param {string} userDataPath
 */
async function importLocalStorage(window, userDataPath, entries) {
  const importPath = join(userDataPath, localStorageImportName);
  const serializedEntries = JSON.stringify(entries);
  const serializedLiteral = JSON.stringify(serializedEntries);
  await window.webContents.executeJavaScript(`(() => {
    const entries = JSON.parse(${serializedLiteral});
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
    return true;
  })()`);

  const verified = await window.webContents.executeJavaScript(`(() => {
    const entries = JSON.parse(${serializedLiteral});
    return Object.entries(entries).every(([key, value]) => localStorage.getItem(key) === value);
  })()`);
  if (!verified) throw new Error("AITimeline could not verify the localStorage import.");

  const donePath = join(userDataPath, localStorageDoneName);
  if (existsSync(importPath)) renameSync(importPath, donePath);
}

/**
 * @param {BrowserWindow} window
 * @param {Error | undefined} preloadError
 */
async function assertDesktopBridge(window, preloadError) {
  if (preloadError) throw preloadError;
  const injectedOrigin = await window.webContents.executeJavaScript(
    "window.aitimelineDesktop?.apiOrigin"
  );
  if (injectedOrigin !== apiOrigin) {
    throw new Error("AITimeline desktop preload did not expose the active API origin.");
  }
}

async function closeApiServer() {
  const server = apiServer;
  if (!server) return;

  await new Promise((resolveClose) => {
    server.close((error) => {
      if (error) {
        console.error("[aitimeline] API close failed", error);
        server.aitimeline?.closeStores?.();
      }
      resolveClose(undefined);
    });
  });
  if (apiServer === server) apiServer = null;
}

/** @param {boolean} waitForStartup */
function beginShutdown(waitForStartup) {
  if (shutdownPromise) return;

  shutdownPromise = (async () => {
    if (waitForStartup && startupPromise) {
      await startupPromise.catch(() => undefined);
    }
    await closeApiServer();
  })().finally(() => {
    allowQuit = true;
    // Once `before-quit` has been prevented, macOS abandons the quit it started:
    // the app.quit() that used to run here closed the window and then stopped at
    // `window-all-closed`, never reaching `will-quit`, so the process stayed
    // alive without a window and kept the single-instance lock. The API server
    // and its writer locks are already released above, so exit outright.
    app.exit(0);
  });
}

/**
 * @param {unknown} error
 */
function handleFatalStartupError(error) {
  const writerLocked = hasErrorCode(error, "AITIMELINE_WRITER_LOCKED");
  const message = writerLocked
    ? "AITimeline 数据正在被另一个进程使用。请先退出另一个 AITimeline 实例或开发服务，再重新打开。"
    : "AITimeline 启动失败。请查看日志后重试。";

  console.error("[aitimeline] desktop startup failed", error);
  dialog.showErrorBox("AITimeline 无法启动", message);
  beginShutdown(false);
}
