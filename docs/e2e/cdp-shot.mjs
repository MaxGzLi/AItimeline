// Interaction-capable screenshot harness via the Chrome DevTools Protocol.
// No Playwright/Puppeteer: uses Node 22+ built-in global WebSocket + fetch.
// Lets us open the drawer / submit Ask-AI / hover etc. before capturing —
// which the static --screenshot harness (docs/e2e/screenshot.mjs) can't do.
//
// Usage: node docs/e2e/cdp-shot.mjs <out.png> <url> <width> <height> [interaction.js]
//   interaction.js (optional): a file whose contents are a single JS expression
//   evaluated in the page (with awaitPromise) AFTER load, BEFORE the screenshot.
//   It should evaluate to a Promise (e.g. an async IIFE) and may return a string
//   that this harness prints as a signal.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [, , out, url = "http://127.0.0.1:5173", w = "1440", h = "2200", evalFile] =
  process.argv;
const PORT = 9333;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = mkdtempSync(join(tmpdir(), "cdp-"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--force-color-profile=srgb",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  `--window-size=${w},${h}`,
  "about:blank",
]);

let ws;
let nextId = 1;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

try {
  // Wait for the CDP endpoint, then find the page target.
  let target;
  for (let i = 0; i < 50; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json());
      target = list.find((t) => t.type === "page");
      if (target?.webSocketDebuggerUrl) break;
    } catch {}
    await sleep(200);
  }
  if (!target) throw new Error("no CDP page target");

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  });

  await send("Page.enable");
  await send("Runtime.enable");
  // Pin media features so @media blocks are deterministic.
  // NOTE: this headless Chrome DEFAULTS to dark, so to verify LIGHT mode you
  // must emulate it explicitly (LIGHT=1); DARK=1 forces dark.
  // REDUCE=1 emulates prefers-reduced-motion: reduce (for a11y motion checks).
  const features = [];
  const scheme = process.env.DARK ? "dark" : process.env.LIGHT ? "light" : null;
  if (scheme) features.push({ name: "prefers-color-scheme", value: scheme });
  if (process.env.REDUCE) features.push({ name: "prefers-reduced-motion", value: "reduce" });
  if (features.length) {
    await send("Emulation.setEmulatedMedia", { features });
  }
  await send("Emulation.setDeviceMetricsOverride", {
    width: Number(w),
    height: Number(h),
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url });
  await sleep(2500); // SPA hydration + demo-card render

  if (evalFile) {
    const expression = readFileSync(evalFile, "utf8");
    const r = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    console.log("interaction signal:", r.result?.value ?? r.result?.description ?? "(none)");
  }

  // Full page by default; VIEWPORT=1 keeps the shot to the emulated viewport so
  // an interaction that scrolls to a card can frame just that card.
  const shot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: !process.env.VIEWPORT,
  });
  writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log("cdp screenshot written:", out);
} finally {
  try { ws?.close(); } catch {}
  chrome.kill("SIGKILL");
}
