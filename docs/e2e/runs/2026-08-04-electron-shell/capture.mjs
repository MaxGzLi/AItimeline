// @ts-check

// Interactive macOS fallback for the acceptance machine. It launches the
// packaged app with isolated temporary user data, then asks the operator to
// click the AITimeline window for a native window-only screenshot.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const run = promisify(execFile);
const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../../../..");
const appExecutable = join(
  repoRoot,
  "apps/desktop/dist/mac-arm64/AITimeline.app/Contents/MacOS/AITimeline"
);
const outputPath = join(currentDir, "desktop-window.png");
const userDataPath = await mkdtemp(join(tmpdir(), "aitimeline-desktop-capture-"));
const application = spawn(appExecutable, [`--user-data-dir=${userDataPath}`], {
  stdio: "inherit"
});

try {
  await new Promise((resolveWait) => setTimeout(resolveWait, 5000));
  if (application.exitCode !== null) {
    throw new Error(`AITimeline exited before capture with code ${application.exitCode}.`);
  }
  console.log("Click the AITimeline window to capture it.");
  await run("/usr/sbin/screencapture", ["-W", "-o", outputPath]);
  console.log(`desktop screenshot written: ${outputPath}`);
  console.log("Quit AITimeline with Cmd+Q to finish the lock check.");
  if (application.exitCode === null) await once(application, "exit");

  for (const lockName of ["aitimeline.json.lock", "curation-jobs.json.lock"]) {
    if (existsSync(join(userDataPath, lockName))) {
      throw new Error(`desktop lock remained after Cmd+Q: ${lockName}`);
    }
  }
  console.log("desktop Cmd+Q lock check passed");
} finally {
  if (application.exitCode === null) {
    application.kill("SIGTERM");
    await Promise.race([
      once(application, "exit"),
      new Promise((resolveWait) => setTimeout(resolveWait, 3000))
    ]);
  }
  await rm(userDataPath, { recursive: true, force: true });
}
