// @ts-check

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  buildDesktopCorsOrigins,
  desktopOrigin,
  listenWithPortFallback,
  loadEnvironmentFile,
  resolveDataPaths,
  resolveStaticAssetPath
} from "../src/runtime.mjs";

/** @type {string[]} */
const temporaryDirectories = [];
const expectedApiDefaultOrigins = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:5198",
  "http://localhost:5198"
];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("loadEnvironmentFile", () => {
  test("loads .env values without overwriting the existing environment", () => {
    const directory = mkdtempSync(join(tmpdir(), "aitimeline-desktop-env-"));
    temporaryDirectories.push(directory);
    const configPath = join(directory, "config.env");
    writeFileSync(configPath, "EXISTING=from-file\nNEW_VALUE=\"from config\"\n", "utf8");
    const environment = { EXISTING: "from-shell" };

    const loaded = loadEnvironmentFile(configPath, environment);

    expect(environment).toEqual({ EXISTING: "from-shell", NEW_VALUE: "from config" });
    expect(loaded).toEqual(["NEW_VALUE"]);
  });

  test("treats a missing config file as an empty merge", () => {
    const environment = { EXISTING: "yes" };

    expect(loadEnvironmentFile("/path/that/does/not/exist/config.env", environment)).toEqual([]);
    expect(environment).toEqual({ EXISTING: "yes" });
  });
});

describe("resolveDataPaths", () => {
  test("uses the repository API data directory in development", () => {
    const paths = resolveDataPaths({
      isPackaged: false,
      userDataPath: "/Users/test/Library/Application Support/AITimeline",
      repoRoot: "/repo"
    });

    expect(paths).toEqual({
      dataRoot: resolve("/repo/apps/api/data"),
      dataPath: resolve("/repo/apps/api/data/aitimeline.json"),
      curationDataPath: resolve("/repo/apps/api/data/curation-jobs.json"),
      mediaRootDir: resolve("/repo/apps/api/data/media")
    });
  });

  test("uses userData for every packaged persistence path", () => {
    const userDataPath = "/Users/test/Library/Application Support/AITimeline";
    const paths = resolveDataPaths({ isPackaged: true, userDataPath, repoRoot: "/repo" });

    expect(paths).toEqual({
      dataRoot: resolve(userDataPath),
      dataPath: resolve(userDataPath, "aitimeline.json"),
      curationDataPath: resolve(userDataPath, "curation-jobs.json"),
      mediaRootDir: resolve(userDataPath, "media")
    });
  });
});

describe("resolveStaticAssetPath", () => {
  const distDir = resolve("/runtime/apps/web/dist");
  const indexPath = resolve(distDir, "index.html");
  const assetPath = resolve(distDir, "assets/app.js");
  const availableFiles = new Set([indexPath, assetPath]);
  const isFile = (filePath) => availableFiles.has(filePath);

  test("serves the root and known static assets", () => {
    expect(resolveStaticAssetPath("app://aitimeline/", distDir, isFile)).toBe(indexPath);
    expect(resolveStaticAssetPath("app://aitimeline/assets/app.js", distDir, isFile)).toBe(assetPath);
  });

  test("falls back to index.html for an unknown SPA route", () => {
    expect(resolveStaticAssetPath("app://aitimeline/graph/concept?id=one", distDir, isFile)).toBe(indexPath);
    expect(resolveStaticAssetPath("app://aitimeline?next=/assets/app.js", distDir, isFile)).toBe(indexPath);
    expect(resolveStaticAssetPath("app://aitimeline#next=/assets/app.js", distDir, isFile)).toBe(indexPath);
  });

  test.each([
    "app://aitimeline/../secret.txt",
    "app://aitimeline/%2e%2e/secret.txt",
    "app://aitimeline/%2e%2e%5csecret.txt",
    "app://other/assets/app.js",
    "https://aitimeline/assets/app.js"
  ])("rejects traversal and non-app origins: %s", (url) => {
    expect(resolveStaticAssetPath(url, distDir, isFile)).toBeUndefined();
  });
});

describe("buildDesktopCorsOrigins", () => {
  test("keeps every API browser default and adds the desktop origin", () => {
    const origins = buildDesktopCorsOrigins(undefined);

    expect(origins).toEqual(expect.arrayContaining([...expectedApiDefaultOrigins, desktopOrigin]));
  });

  test("merges configured origins without duplicates", () => {
    const origins = buildDesktopCorsOrigins(" https://example.test, app://aitimeline ");

    expect(origins).toContain("https://example.test");
    expect(origins.filter((origin) => origin === desktopOrigin)).toHaveLength(1);
    expect(origins).toEqual(expect.arrayContaining(expectedApiDefaultOrigins));
  });
});

describe("listenWithPortFallback", () => {
  test("uses a random loopback port when the preferred port is occupied", async () => {
    const blocker = createServer();
    const candidate = createServer();

    try {
      const occupiedAddress = await listenWithPortFallback(blocker, 0, "127.0.0.1");
      const candidateAddress = await listenWithPortFallback(candidate, occupiedAddress.port, "127.0.0.1");

      expect(candidateAddress.port).not.toBe(occupiedAddress.port);
      expect(candidateAddress.address).toBe("127.0.0.1");
    } finally {
      await Promise.all([closeIfListening(blocker), closeIfListening(candidate)]);
    }
  });
});

/** @param {import("node:http").Server} server */
function closeIfListening(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose(undefined));
  });
}
