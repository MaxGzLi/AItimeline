// @ts-check

import assert from "node:assert/strict";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildDesktopCorsOrigins,
  loadEnvironmentFile,
  readLocalStorageImport,
  resolveDataPaths
} from "../apps/desktop/src/runtime.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const runtimeRoot = process.env.AITIMELINE_DESKTOP_RUNTIME_ROOT ?? resolve(scriptDir, "..");
const { createApiServer } = await import(
  pathToFileURL(join(runtimeRoot, "apps/api/src/server.mjs")).href
);
const temporaryDirectory = mkdtempSync(join(tmpdir(), "aitimeline-desktop-smoke-"));
const configPath = join(temporaryDirectory, "config.env");
const previousCorsOrigins = process.env.AITIMELINE_CORS_ORIGINS;
/** @type {import("node:http").Server | undefined} */
let server;

try {
  delete process.env.AITIMELINE_CORS_ORIGINS;
  writeFileSync(
    configPath,
    "AITIMELINE_CORS_ORIGINS=https://desktop-smoke.example\nAITIMELINE_DESKTOP_SMOKE=loaded\n",
    "utf8"
  );

  const loadedVariables = loadEnvironmentFile(configPath);
  assert.deepEqual(
    new Set(loadedVariables),
    new Set(["AITIMELINE_CORS_ORIGINS", "AITIMELINE_DESKTOP_SMOKE"]),
    "desktop config.env should merge into process.env"
  );
  assert.equal(process.env.AITIMELINE_DESKTOP_SMOKE, "loaded");

  const dataPaths = resolveDataPaths({
    isPackaged: true,
    userDataPath: join(temporaryDirectory, "user-data"),
    repoRoot: process.cwd()
  });
  server = createApiServer({
    host: "127.0.0.1",
    dataPath: dataPaths.dataPath,
    curationDataPath: dataPaths.curationDataPath,
    mediaRootDir: dataPaths.mediaRootDir,
    worker: true,
    enableFixtures: true,
    corsOrigins: buildDesktopCorsOrigins(process.env.AITIMELINE_CORS_ORIGINS)
  });

  const address = await listenOnRandomPort(server);
  const response = await fetch(`http://127.0.0.1:${address.port}/health`, {
    headers: { Origin: "app://aitimeline" }
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "app://aitimeline");
  assert.deepEqual(await response.json(), { ok: true, service: "aitimeline-api" });

  await closeServer(server);
  server = undefined;
  assert.equal(existsSync(`${dataPaths.dataPath}.lock`), false, "snapshot writer lock should be released");
  assert.equal(existsSync(`${dataPaths.curationDataPath}.lock`), false, "curation writer lock should be released");
  await verifyMigrationPath(temporaryDirectory);

  console.log("desktop smoke passed: config -> API -> HTTP -> clean close -> migration copy");
} finally {
  if (server) await closeServer(server);
  delete process.env.AITIMELINE_DESKTOP_SMOKE;
  if (previousCorsOrigins === undefined) {
    delete process.env.AITIMELINE_CORS_ORIGINS;
  } else {
    process.env.AITIMELINE_CORS_ORIGINS = previousCorsOrigins;
  }
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

/**
 * @param {import("node:http").Server} httpServer
 * @returns {Promise<import("node:net").AddressInfo>}
 */
function listenOnRandomPort(httpServer) {
  return new Promise((resolveListen, rejectListen) => {
    httpServer.once("error", rejectListen);
    httpServer.listen(0, "127.0.0.1", () => {
      httpServer.off("error", rejectListen);
      const address = httpServer.address();
      if (!address || typeof address === "string") {
        rejectListen(new Error("desktop smoke API did not report a TCP address"));
        return;
      }
      resolveListen(address);
    });
  });
}

/**
 * @param {import("node:http").Server} httpServer
 */
function closeServer(httpServer) {
  return new Promise((resolveClose, rejectClose) => {
    httpServer.close((error) => error ? rejectClose(error) : resolveClose(undefined));
  });
}

/**
 * Exercise the documented copy/import sequence entirely inside the smoke temp
 * directory. No developer or user data directory is read or written.
 *
 * @param {string} rootDirectory
 */
async function verifyMigrationPath(rootDirectory) {
  const legacyDirectory = join(rootDirectory, "legacy-data");
  const migratedDirectory = join(rootDirectory, "migrated-user-data");
  const legacyMediaDirectory = join(legacyDirectory, "media");
  mkdirSync(legacyMediaDirectory, { recursive: true });
  mkdirSync(migratedDirectory, { recursive: true });

  copyFileSync(
    new URL("./fixtures/w4e/aitimeline-v1.json", import.meta.url),
    join(legacyDirectory, "aitimeline.json")
  );
  copyFileSync(
    new URL("./fixtures/w4e/curation-jobs-v1.json", import.meta.url),
    join(legacyDirectory, "curation-jobs.json")
  );
  writeFileSync(join(legacyMediaDirectory, "migration-marker.txt"), "desktop migration smoke\n", "utf8");

  copyFileSync(join(legacyDirectory, "aitimeline.json"), join(migratedDirectory, "aitimeline.json"));
  copyFileSync(join(legacyDirectory, "curation-jobs.json"), join(migratedDirectory, "curation-jobs.json"));
  cpSync(legacyMediaDirectory, join(migratedDirectory, "media"), { recursive: true });

  const localStorageImportPath = join(migratedDirectory, "import-localstorage.json");
  const localStorageDonePath = join(migratedDirectory, "import-localstorage.done");
  const localStorageEntries = {
    "aitl-theme": "dark",
    "aitl-language": "zh",
    "aitimeline.mvp.v3": "{\"version\":3}",
    "aitimeline.synced-signals.v1": "{}"
  };
  writeFileSync(localStorageImportPath, `${JSON.stringify(localStorageEntries, null, 2)}\n`, "utf8");
  assert.deepEqual(readLocalStorageImport(localStorageImportPath), localStorageEntries);

  const migratedPaths = resolveDataPaths({
    isPackaged: true,
    userDataPath: migratedDirectory,
    repoRoot: process.cwd()
  });
  const migratedServer = createApiServer({
    host: "127.0.0.1",
    dataPath: migratedPaths.dataPath,
    curationDataPath: migratedPaths.curationDataPath,
    mediaRootDir: migratedPaths.mediaRootDir,
    worker: false,
    enableFixtures: true,
    corsOrigins: buildDesktopCorsOrigins(process.env.AITIMELINE_CORS_ORIGINS)
  });

  try {
    const address = await listenOnRandomPort(migratedServer);
    const snapshotResponse = await fetch(`http://127.0.0.1:${address.port}/api/snapshot`);
    assert.equal(snapshotResponse.status, 200, "copied server snapshots should reopen");
    const migratedSnapshot = await snapshotResponse.json();
    assert.ok(
      Array.isArray(migratedSnapshot.posts) && migratedSnapshot.posts.some((post) => post.id === "w4e-post-1"),
      "copied timeline posts should survive migration"
    );
    assert.ok(
      migratedServer.aitimeline.curationStore.list().some((record) => record.id === "w4e-queued"),
      "copied curation records should survive migration"
    );
  } finally {
    await closeServer(migratedServer);
  }

  assert.equal(existsSync(join(migratedDirectory, "media/migration-marker.txt")), true);
  assert.equal(existsSync(`${migratedPaths.dataPath}.lock`), false);
  assert.equal(existsSync(`${migratedPaths.curationDataPath}.lock`), false);
  renameSync(localStorageImportPath, localStorageDonePath);
  assert.equal(existsSync(localStorageImportPath), false);
  assert.equal(existsSync(localStorageDonePath), true);
}
