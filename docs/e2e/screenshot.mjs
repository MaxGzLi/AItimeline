// Reusable headless-Chrome screenshot harness for the web app.
//
// Drives the system Google Chrome in headless mode (no Playwright/Puppeteer
// dependency) so the UI loop can capture real renders as verification artifacts.
//
// Usage:
//   node docs/e2e/screenshot.mjs <out.png> [url] [width] [height]
//
// Defaults: url=http://127.0.0.1:5173  width=1440  height=2200
// The web app falls back to demo cards when the API is offline, so no API
// server is required to render the feed.
import { execFile } from "node:child_process";
import { access, rm } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const [, , outArg, urlArg, widthArg, heightArg] = process.argv;

if (!outArg) {
  console.error("usage: node docs/e2e/screenshot.mjs <out.png> [url] [width] [height]");
  process.exit(2);
}

const out = outArg;
const url = urlArg ?? "http://127.0.0.1:5173";
const width = Number(widthArg ?? 1440);
const height = Number(heightArg ?? 2200);

await access(CHROME).catch(() => {
  console.error(`Chrome not found at ${CHROME}`);
  process.exit(3);
});

await rm(out, { force: true });

// --virtual-time-budget lets the SPA's JS run (React render + demo data) before
// the shot is taken; without it Chrome captures a blank pre-hydration frame.
await run(CHROME, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--force-color-profile=srgb",
  `--window-size=${width},${height}`,
  "--virtual-time-budget=9000",
  `--screenshot=${out}`,
  url
]);

await access(out);
console.log(`screenshot written: ${out}`);
