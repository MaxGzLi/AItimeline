// @ts-check

// Sandboxed Electron preloads run as plain scripts and provide a restricted
// require() even when the file uses the repository-wide .mjs convention.
const { contextBridge } = require("electron");

const argumentPrefix = "--aitimeline-api-origin=";
const apiOriginArgument = process.argv.find((argument) => argument.startsWith(argumentPrefix));
const apiOrigin = apiOriginArgument?.slice(argumentPrefix.length);

if (!apiOrigin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(apiOrigin)) {
  throw new Error("AITimeline desktop preload did not receive a valid API origin.");
}

contextBridge.exposeInMainWorld("aitimelineDesktop", Object.freeze({ apiOrigin }));
