import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { hostname } from "node:os";
import { join } from "node:path";

import { createGuardedFetch } from "../apps/api/src/guardedFetch.mjs";
import { mergeSourceRegistries, resolveCitedChunk } from "../packages/core/dist/index.js";
import { createApiServer as createRawApiServer } from "../apps/api/src/server.mjs";

const previousContentLanguage = process.env.AITIMELINE_CONTENT_LANGUAGE;
const previousTimelineTimeZone = process.env.AITIMELINE_TIMEZONE;
const previousAllowPrivateFetch = process.env.AITIMELINE_ALLOW_PRIVATE_FETCH;
const previousAuthToken = process.env.AITIMELINE_AUTH_TOKEN;
const previousCorsOrigins = process.env.AITIMELINE_CORS_ORIGINS;
process.env.AITIMELINE_CONTENT_LANGUAGE = "zh";
process.env.AITIMELINE_TIMEZONE = "UTC";
process.env.AITIMELINE_ALLOW_PRIVATE_FETCH = "true";
delete process.env.AITIMELINE_AUTH_TOKEN;
delete process.env.AITIMELINE_CORS_ORIGINS;

function createApiServer(options = {}) {
  return createRawApiServer({
    ...options,
    guardedFetch: options.guardedFetch ?? ((input, init) => globalThis.fetch(input, init))
  });
}

const tempDir = await mkdtemp(join(tmpdir(), "aitimeline-api-"));
const mediaRootDir = join(tempDir, "media");
const dataPath = join(tempDir, "aitimeline.json");
const curationDataPath = join(tempDir, "curation-jobs.json");
await mkdir(join(mediaRootDir, "smoke-source"), { recursive: true });
await writeFile(join(mediaRootDir, "smoke-source", "1.png"), new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));

let discoveryBaseUrl = "";
const baseUrl = "http://aitimeline-smoke.local";
const seoWaterFixtureHtml = `
  <html>
    <head><meta property="og:title" content="Grok Advanced Guide: Unlock AI Success" /></head>
    <body>
      <article>
        <p>Welcome to the ultimate guide for Grok success. In today's fast-moving world, businesses need innovative AI solutions to transform productivity and unlock growth.</p>
        <p>This comprehensive advanced guide helps teams leverage cutting-edge technology, boost workflows, empower stakeholders, and revolutionize domain knowledge with seamless intelligence.</p>
        <p>Whether you are a beginner or expert, mastering AI will skyrocket outcomes. Start your journey, embrace the future, and discover game-changing strategies for every industry.</p>
      </article>
    </body>
  </html>
`;
const observedSearchQueries = [];
const deepReadFallbackModelEndpoint = "https://deepread-fallback.local/v1/chat/completions";
const observedDeepReadFallbackRequests = [];
const fakeSearchProvider = {
  id: "smoke",
  async search(query) {
    observedSearchQueries.push(query);
    return [
      {
        url: `${discoveryBaseUrl}/fixtures/article-background?query=${encodeURIComponent(query)}`,
        title: `Background source for ${query}`,
        snippet:
          "A discovered background source that prepares related knowledge with citations, concepts and review hooks."
      }
    ];
  }
};
let server = createApiServer({
  dataPath,
  curationDataPath,
  mediaRootDir,
  enableFixtures: true,
  searchProvider: fakeSearchProvider
});
discoveryBaseUrl = baseUrl;
const originalFetch = globalThis.fetch;

globalThis.fetch = async (input, init = {}) => {
  const url = getFetchUrl(input);

  if (url === `${baseUrl}/fixtures/connection-note`) {
    return new Response(
      `
        <html>
          <head><meta property="og:title" content="Connection note smoke import" /></head>
          <body>
            <article>
              <p>Knowledge Graph evaluation evidence from the imported source connects Knowledge Graph and Evaluation for the learner.</p>
            </article>
          </body>
        </html>
      `,
      {
        status: 200,
        headers: { "content-type": "text/html" }
      }
    );
  }

  if (url.startsWith("https://network-fail.local/")) {
    throw new TypeError("fetch failed");
  }

  // SEO water: the deterministic source quality gate rejects this without a
  // model, so the ledger's gate_rejected path stays testable offline.
  if (url.startsWith("https://gate-reject.local/")) {
    return new Response(seoWaterFixtureHtml, {
      status: 200,
      headers: { "content-type": "text/html" }
    });
  }

  if (url.startsWith("https://fallback-leak.local/")) {
    throw new Error("network provider body from https://internal-provider.local/private/deep-dive");
  }

  if (url === deepReadFallbackModelEndpoint) {
    observedDeepReadFallbackRequests.push({ url, headers: new Headers(init.headers) });
    return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }

  if (url.startsWith(baseUrl)) {
    return dispatchToServer(server, url, init);
  }

  return originalFetch(input, init);
};

try {
  const health = await requestJson("/health");

  assert.equal(health.ok, true, "API health check should pass");

  assert.throws(
    () => createRawApiServer({
      host: "0.0.0.0",
      authToken: "",
      dataPath: join(tempDir, "auth-missing.json"),
      curationDataPath: join(tempDir, "auth-missing-jobs.json"),
      mediaRootDir
    }),
    /Set AITIMELINE_AUTH_TOKEN/,
    "non-loopback binding without a token must fail closed before startup"
  );
  const authenticatedServer = createRawApiServer({
    host: "0.0.0.0",
    authToken: "smoke-secret",
    dataPath: join(tempDir, "auth.json"),
    curationDataPath: join(tempDir, "auth-jobs.json"),
    mediaRootDir
  });
  try {
    const unauthenticated = await dispatchToServer(authenticatedServer, `${baseUrl}/api/snapshot`);
    assert.equal(unauthenticated.status, 401, "non-loopback API requests without a token must be rejected");
    assert.equal((await unauthenticated.json()).code, "AUTH_REQUIRED", "auth rejection must expose a stable code");
    const bearerAuthenticated = await dispatchToServer(authenticatedServer, `${baseUrl}/api/snapshot`, {
      headers: { authorization: "Bearer smoke-secret" }
    });
    assert.equal(bearerAuthenticated.status, 200, "a matching bearer token must authorize an API request");
    const headerAuthenticated = await dispatchToServer(authenticatedServer, `${baseUrl}/api/snapshot`, {
      headers: { "x-aitimeline-token": "smoke-secret" }
    });
    assert.equal(headerAuthenticated.status, 200, "the dedicated token header must authorize an API request");
  } finally {
    await closeServer(authenticatedServer);
  }
  const loopbackTokenServer = createRawApiServer({
    authToken: "loopback-secret",
    dataPath: join(tempDir, "loopback-token.json"),
    curationDataPath: join(tempDir, "loopback-token-jobs.json"),
    mediaRootDir
  });
  try {
    const loopbackDenied = await dispatchToServer(loopbackTokenServer, `${baseUrl}/api/snapshot`);
    assert.equal(loopbackDenied.status, 401, "a configured token must be enforced even on loopback bindings");
    const loopbackAllowed = await dispatchToServer(loopbackTokenServer, `${baseUrl}/api/snapshot`, {
      headers: { authorization: "Bearer loopback-secret" }
    });
    assert.equal(loopbackAllowed.status, 200, "the configured token must authorize loopback requests");
  } finally {
    await closeServer(loopbackTokenServer);
  }

  const allowedCors = await dispatchToServer(server, `${baseUrl}/health`, {
    headers: { origin: "http://localhost:5173" }
  });
  assert.equal(
    allowedCors.headers.get("access-control-allow-origin"),
    "http://localhost:5173",
    "allowlisted CORS origins must be echoed"
  );
  const deniedCors = await dispatchToServer(server, `${baseUrl}/health`, {
    headers: { origin: "https://evil.example" }
  });
  assert.equal(
    deniedCors.headers.has("access-control-allow-origin"),
    false,
    "non-allowlisted CORS origins must not receive an allow-origin header"
  );
  const originlessHealth = await dispatchToServer(server, `${baseUrl}/health`);
  assert.equal(originlessHealth.status, 200, "originless curl and same-origin requests must remain available");

  const privateGuardServer = createRawApiServer({
    dataPath: join(tempDir, "private-guard.json"),
    curationDataPath: join(tempDir, "private-guard-jobs.json"),
    mediaRootDir,
    guardedFetchOptions: { allowPrivate: false }
  });
  try {
    const beforePrivateSnapshot = await requestJsonFromServer(privateGuardServer, "/api/snapshot");
    const blockedPrivate = await dispatchToServer(privateGuardServer, `${baseUrl}/api/import/article`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "http://127.0.0.1/private-source" })
    });
    const blockedPrivatePayload = await blockedPrivate.json();
    assert.equal(blockedPrivate.status, 400, "private article imports must be rejected");
    assert.equal(
      blockedPrivatePayload.code,
      "FETCH_PRIVATE_ADDRESS_BLOCKED",
      "private fetch rejection must expose a stable code"
    );
    const afterPrivateSnapshot = await requestJsonFromServer(privateGuardServer, "/api/snapshot");
    assert.equal(
      afterPrivateSnapshot.sourceImports.length,
      beforePrivateSnapshot.sourceImports.length,
      "blocked private imports must not persist an import record"
    );
    assert.equal(
      afterPrivateSnapshot.posts.length,
      beforePrivateSnapshot.posts.length,
      "blocked private imports must not persist cards"
    );
  } finally {
    await closeServer(privateGuardServer);
  }

  const guardedFixture = createHttpServer((request, response) => {
    if (request.url === "/figure.png") {
      response.setHeader("content-type", "image/png");
      response.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      return;
    }
    if (request.url === "/binary") {
      response.setHeader("content-type", "application/octet-stream");
      response.end(Buffer.from([0x00, 0x01, 0x02, 0x03]));
      return;
    }
    response.setHeader("content-type", "text/html; charset=utf-8");
    if (request.url === "/large") {
      response.end(`<html><body><article><p>${"oversized ".repeat(800)}</p></article></body></html>`);
      return;
    }
    response.end(`
      <html><head><title>Guarded loopback fixture</title></head><body><article>
      <p>Guarded fetch allows a trusted local fixture when the explicit private-fetch gate is enabled, while retaining response limits and content checks.</p>
      <p>The imported fixture provides enough grounded source material for deterministic smoke cards and verifies that local development remains usable.</p>
      </article></body></html>
    `);
  });
  const guardedFixtureAddress = await listenOnTemporaryPort(guardedFixture);
  const gatedImportServer = createRawApiServer({
    dataPath: join(tempDir, "gated-import.json"),
    curationDataPath: join(tempDir, "gated-import-jobs.json"),
    mediaRootDir,
    guardedFetchOptions: { allowPrivate: true, maxResponseBytes: 1_200 }
  });
  try {
    const allowedPrivate = await dispatchToServer(gatedImportServer, `${baseUrl}/api/import/article`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: `http://127.0.0.1:${guardedFixtureAddress.port}/article` })
    });
    assert.equal(allowedPrivate.status, 200, "the explicit private-fetch gate must allow loopback fixtures");
    const beforeLargeSnapshot = await requestJsonFromServer(gatedImportServer, "/api/snapshot");
    const oversized = await dispatchToServer(gatedImportServer, `${baseUrl}/api/import/article`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: `http://127.0.0.1:${guardedFixtureAddress.port}/large` })
    });
    const oversizedPayload = await oversized.json();
    assert.equal(oversized.status, 400, "oversized fetch responses must be rejected");
    assert.equal(
      oversizedPayload.code,
      "FETCH_RESPONSE_TOO_LARGE",
      "oversized response rejection must expose a stable code"
    );
    const afterLargeSnapshot = await requestJsonFromServer(gatedImportServer, "/api/snapshot");
    assert.equal(
      afterLargeSnapshot.sourceImports.length,
      beforeLargeSnapshot.sourceImports.length,
      "oversized responses must not persist partial import records"
    );
    assert.equal(
      afterLargeSnapshot.posts.length,
      beforeLargeSnapshot.posts.length,
      "oversized responses must not produce partial cards"
    );

    const gatedGuardedFetch = createGuardedFetch({ allowPrivate: true });
    const figureResponse = await gatedGuardedFetch(`http://127.0.0.1:${guardedFixtureAddress.port}/figure.png`);
    assert.equal(figureResponse.status, 200, "image content types must pass the guard so arXiv figure caching keeps working");
    assert.equal(
      (await figureResponse.arrayBuffer()).byteLength,
      8,
      "guarded image responses must deliver their bytes intact"
    );
    await assert.rejects(
      () => gatedGuardedFetch(`http://127.0.0.1:${guardedFixtureAddress.port}/binary`),
      (error) => error?.code === "FETCH_CONTENT_TYPE_BLOCKED",
      "content types outside the whitelist must be rejected even with the private gate open"
    );
  } finally {
    await closeServer(gatedImportServer);
    await closeServer(guardedFixture);
  }

  // --- Source version chain: re-importing a changed URL must not drift old evidence (W6-D) ---
  const versionedParagraphV1 =
    "Grounded timelines archive the first edition paragraph so early citations keep their exact original wording forever.";
  const versionedParagraphV2 =
    "Grounded timelines publish a revised second edition paragraph while superseded citations stay pinned to their archived text.";
  let versionedFixtureBody = versionedParagraphV1;
  const versionedFixture = createHttpServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<html><head><title>Versioned source</title></head><body><article><p>${versionedFixtureBody}</p></article></body></html>`);
  });
  const versionedFixtureAddress = await listenOnTemporaryPort(versionedFixture);
  const versionedServer = createApiServer({
    dataPath: join(tempDir, "versioned-source.json"),
    curationDataPath: join(tempDir, "versioned-source-jobs.json"),
    mediaRootDir
  });
  try {
    const versionedUrl = `http://127.0.0.1:${versionedFixtureAddress.port}/versioned-article`;
    const firstEdition = await requestJsonFromServer(versionedServer, "/api/import/article", {
      method: "POST",
      body: { url: versionedUrl, createdAt: "2026-07-01T00:00:00.000Z" }
    });
    const cardA = firstEdition.posts[0];
    assert.ok(cardA.citations[0]?.chunkVersionId, "new cards must bind citations to a content-addressed chunk version");
    versionedFixtureBody = versionedParagraphV2;
    const secondEdition = await requestJsonFromServer(versionedServer, "/api/import/article", {
      method: "POST",
      body: { url: versionedUrl, createdAt: "2026-07-02T00:00:00.000Z" }
    });
    const cardB = secondEdition.posts[0];
    assert.notEqual(
      cardB.citations[0].chunkVersionId,
      cardA.citations[0].chunkVersionId,
      "a changed re-import must mint a distinct chunk version"
    );
    const versionedSnapshot = await requestJsonFromServer(versionedServer, "/api/snapshot");
    const versionedRegistry = mergeSourceRegistries(
      ...versionedSnapshot.sourceRegistries.map((record) => record.registry)
    );
    const citedChunkId = cardA.citations[0].chunkId;
    const versionsForChunk = versionedRegistry.chunkVersions.filter((version) => version.chunkId === citedChunkId);
    assert.equal(versionsForChunk.length, 2, "both content versions must coexist in the merged registry");
    const resolvedA = resolveCitedChunk(versionedRegistry, cardA.citations[0]);
    const resolvedB = resolveCitedChunk(versionedRegistry, cardB.citations[0]);
    assert.ok(
      resolvedA?.content.includes("first edition paragraph"),
      "the first card's evidence must keep resolving to the archived first-edition text"
    );
    assert.ok(
      resolvedB?.content.includes("second edition paragraph"),
      "the second card's evidence must resolve to the current second-edition text"
    );
    assert.ok(
      versionedRegistry.chunks.find((chunk) => chunk.id === citedChunkId)?.content.includes("second edition paragraph"),
      "the live chunk view must show the latest content"
    );

    await closeServer(versionedServer);
    const reopenedVersionedServer = createApiServer({
      dataPath: join(tempDir, "versioned-source.json"),
      curationDataPath: join(tempDir, "versioned-source-jobs.json"),
      mediaRootDir
    });
    try {
      const reopenedSnapshot = await requestJsonFromServer(reopenedVersionedServer, "/api/snapshot");
      // Re-importing the same URL replaces the post (same id), so the persisted
      // card is the second edition; the first edition's citation object stands
      // in for any older entity (follow-up, reply) still bound to that version.
      const reopenedCurrent = reopenedSnapshot.posts.find((post) => post.id === cardB.id);
      assert.equal(
        reopenedCurrent?.citations[0]?.chunkVersionId,
        cardB.citations[0].chunkVersionId,
        "chunk version bindings must survive the strict decoder across a restart"
      );
      const reopenedRegistry = mergeSourceRegistries(
        ...reopenedSnapshot.sourceRegistries.map((record) => record.registry)
      );
      assert.ok(
        resolveCitedChunk(reopenedRegistry, cardA.citations[0])?.content.includes("first edition paragraph"),
        "archived version text must survive a restart so old citations never drift"
      );
      assert.ok(
        resolveCitedChunk(reopenedRegistry, reopenedCurrent.citations[0])?.content.includes("second edition paragraph"),
        "the current card must keep resolving to its own edition after a restart"
      );
    } finally {
      await closeServer(reopenedVersionedServer);
    }
  } finally {
    await closeServer(versionedFixture);
  }

  let redirectRequests = 0;
  const redirectGuard = createGuardedFetch({
    allowPrivate: false,
    resolver: async (host) => host === "public.example"
      ? [{ address: "93.184.216.34", family: 4 }]
      : [{ address: "127.0.0.1", family: 4 }],
    requestImpl: async () => {
      redirectRequests += 1;
      return new Response(null, {
        status: 302,
        headers: { location: "http://private.example/secret" }
      });
    }
  });
  await assert.rejects(
    () => redirectGuard("https://public.example/start"),
    (error) => error?.code === "FETCH_PRIVATE_ADDRESS_BLOCKED",
    "redirects from a public target to a private address must be checked and blocked"
  );
  assert.equal(redirectRequests, 1, "the private redirect target must be rejected before a second request is sent");

  const initialSettings = await requestJson("/api/settings");

  assert.equal(initialSettings.contentLanguage, "zh", "settings API should default to Chinese");
  assert.deepEqual(initialSettings.userSettings, {}, "settings API should keep old snapshots compatible");

  const savedSettings = await requestJson("/api/settings", {
    method: "POST",
    body: { contentLanguage: "en" }
  });
  const settingsSnapshot = await requestJson("/api/snapshot");

  assert.equal(savedSettings.contentLanguage, "en", "settings API should accept English mode");
  assert.equal(savedSettings.userSettings.contentLanguage, "en", "settings API should return persisted user settings");
  assert.equal(
    settingsSnapshot.userSettings.contentLanguage,
    "en",
    "settings API should persist content language into the snapshot"
  );
  assert.ok(
    Array.isArray(settingsSnapshot.conceptBriefs),
    "old snapshots should expose conceptBriefs as an empty compatible field"
  );
  assert.ok(
    Array.isArray(settingsSnapshot.weeklyRecaps),
    "old snapshots should expose weeklyRecaps as an empty compatible field"
  );
  assert.ok(
    Array.isArray(settingsSnapshot.learningGoals),
    "old snapshots should expose learningGoals as an empty compatible field"
  );
  assert.ok(
    Array.isArray(settingsSnapshot.deepReadArticles),
    "old snapshots should expose deepReadArticles as an empty compatible field"
  );

  await closeServer(server);
  server = createApiServer({
    dataPath,
    curationDataPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  const settingsReloadedResponse = await dispatchToServer(server, `${baseUrl}/api/settings`);
  const settingsReloaded = await settingsReloadedResponse.json();

  assert.equal(settingsReloadedResponse.ok, true, "reloaded API server should read settings");
  assert.equal(settingsReloaded.contentLanguage, "en", "settings should survive server recreation");
  assert.equal(
    settingsReloaded.userSettings.contentLanguage,
    "en",
    "reloaded settings should expose persisted user language"
  );

  const resetSettings = await requestJson("/api/settings", {
    method: "POST",
    body: { userSettings: { contentLanguage: "zh" } }
  });

  assert.equal(resetSettings.contentLanguage, "zh", "settings API should reset back to Chinese mode");

  const lockDataPath = join(tempDir, "writer-lock-main.json");
  const lockQueuePath = join(tempDir, "writer-lock-queue.json");
  const lockServerA = createApiServer({ dataPath: lockDataPath, curationDataPath: lockQueuePath, mediaRootDir });
  assert.throws(
    () => createApiServer({ dataPath: lockDataPath, curationDataPath: lockQueuePath, mediaRootDir }),
    /Writer lock rejected.*live writer/,
    "a second server must be rejected while the first server owns both snapshot locks"
  );
  await closeServer(lockServerA);
  const lockServerC = createApiServer({ dataPath: lockDataPath, curationDataPath: lockQueuePath, mediaRootDir });
  await closeServer(lockServerC);

  const partialMainPath = join(tempDir, "partial-init-main.json");
  const partialQueuePath = join(tempDir, "partial-init-queue.json");
  const queueBlocker = createApiServer({
    dataPath: join(tempDir, "partial-blocker-main.json"),
    curationDataPath: partialQueuePath,
    mediaRootDir
  });
  assert.throws(
    () => createApiServer({ dataPath: partialMainPath, curationDataPath: partialQueuePath, mediaRootDir }),
    /Writer lock rejected/,
    "queue lock failure should reject partial initialization"
  );
  const partialCleanupProbe = createApiServer({
    dataPath: partialMainPath,
    curationDataPath: join(tempDir, "partial-cleanup-probe-queue.json"),
    mediaRootDir
  });
  await closeServer(partialCleanupProbe);
  await closeServer(queueBlocker);

  const staleDataPath = join(tempDir, "stale-lock-main.json");
  const staleQueuePath = join(tempDir, "stale-lock-queue.json");
  await writeFile(`${staleDataPath}.lock`, JSON.stringify({
    format: 1,
    targetPath: staleDataPath,
    pid: 999999,
    hostname: hostname(),
    ownerId: "dead-owner",
    processStartedAt: "2026-01-01T00:00:00.000Z",
    acquiredAt: "2026-01-01T00:00:00.000Z"
  }));
  const staleRecoveredServer = createApiServer({ dataPath: staleDataPath, curationDataPath: staleQueuePath, mediaRootDir });
  await closeServer(staleRecoveredServer);

  for (const [name, lockBody, expected] of [
    ["live", { format: 1, targetPath: join(tempDir, "live-lock-main.json"), pid: process.pid, hostname: hostname(), ownerId: "live-owner", processStartedAt: "2026-01-01T00:00:00.000Z", acquiredAt: "2026-01-01T00:00:00.000Z" }, /live writer/],
    ["foreign", { format: 1, targetPath: join(tempDir, "foreign-lock-main.json"), pid: 999999, hostname: "foreign-host", ownerId: "foreign-owner", processStartedAt: "2026-01-01T00:00:00.000Z", acquiredAt: "2026-01-01T00:00:00.000Z" }, /foreign host/]
  ]) {
    const lockedPath = lockBody.targetPath;
    await writeFile(`${lockedPath}.lock`, JSON.stringify(lockBody));
    assert.throws(
      () => createApiServer({ dataPath: lockedPath, curationDataPath: join(tempDir, `${name}-lock-queue.json`), mediaRootDir }),
      expected,
      `${name} writer locks should fail closed`
    );
  }
  const malformedLockPath = join(tempDir, "malformed-lock-main.json");
  await writeFile(`${malformedLockPath}.lock`, "not-json");
  assert.throws(
    () => createApiServer({ dataPath: malformedLockPath, curationDataPath: join(tempDir, "malformed-lock-queue.json"), mediaRootDir }),
    /malformed lock/,
    "malformed writer locks should fail closed"
  );

  const backupDataPath = join(tempDir, "rolling-backup-main.json");
  const backupQueuePath = join(tempDir, "rolling-backup-queue.json");
  const backupServer = createApiServer({ dataPath: backupDataPath, curationDataPath: backupQueuePath, mediaRootDir });
  await requestJsonFromServer(backupServer, "/api/settings", { method: "POST", body: { contentLanguage: "en" } });
  await requestJsonFromServer(backupServer, "/api/settings", { method: "POST", body: { contentLanguage: "zh" } });
  await closeServer(backupServer);
  const backupCurrent = JSON.parse(await readFile(backupDataPath, "utf8"));
  const backupPrevious = JSON.parse(await readFile(`${backupDataPath}.bak.1`, "utf8"));
  assert.equal(backupPrevious.revision, backupCurrent.revision - 1, "rolling backup should be exactly one revision behind current");
  assert.equal(
    (await readdir(tempDir)).some((name) => name.startsWith("rolling-backup-main.json.tmp-")),
    false,
    "successful commits must not leave process temp files"
  );

  for (const [name, invalidSnapshot, expected] of [
    ["bad-post-container", { version: 1, updatedAt: "2026-07-10T00:00:00.000Z", posts: {} }, /\$\.posts: expected an array/],
    ["bad-settings", { version: 1, updatedAt: "2026-07-10T00:00:00.000Z", userSettings: "bad" }, /\$\.userSettings: expected an object/],
    ["unknown-version", { version: 99, updatedAt: "2026-07-10T00:00:00.000Z" }, /supported snapshot version/]
  ]) {
    const invalidPath = join(tempDir, `${name}.json`);
    const invalidQueuePath = join(tempDir, `${name}-queue.json`);
    const serialized = JSON.stringify(invalidSnapshot);
    await writeFile(invalidPath, serialized);
    assert.throws(() => createApiServer({ dataPath: invalidPath, curationDataPath: invalidQueuePath, mediaRootDir }), expected);
    assert.equal(await readFile(invalidPath, "utf8"), serialized, `${name} startup failure must leave the primary untouched`);
  }

  const fixtureRoundTripDataPath = join(tempDir, "w4e-fixture-main.json");
  const fixtureRoundTripQueuePath = join(tempDir, "w4e-fixture-queue.json");
  await writeFile(
    fixtureRoundTripDataPath,
    await readFile(new URL("./fixtures/w4e/aitimeline-v1.json", import.meta.url), "utf8")
  );
  await writeFile(
    fixtureRoundTripQueuePath,
    await readFile(new URL("./fixtures/w4e/curation-jobs-v1.json", import.meta.url), "utf8")
  );
  let fixtureRoundTripServer = createApiServer({
    dataPath: fixtureRoundTripDataPath,
    curationDataPath: fixtureRoundTripQueuePath,
    mediaRootDir
  });
  await closeServer(fixtureRoundTripServer);
  const firstCanonicalMain = JSON.parse(await readFile(fixtureRoundTripDataPath, "utf8"));
  const firstCanonicalQueue = JSON.parse(await readFile(fixtureRoundTripQueuePath, "utf8"));
  assert.equal(firstCanonicalMain.version, 2, "API startup should migrate the production-shape main fixture to v2");
  assert.equal(firstCanonicalQueue.version, 2, "API startup should migrate the production-shape queue fixture to v2");
  fixtureRoundTripServer = createApiServer({
    dataPath: fixtureRoundTripDataPath,
    curationDataPath: fixtureRoundTripQueuePath,
    mediaRootDir
  });
  await closeServer(fixtureRoundTripServer);
  assert.deepEqual(
    JSON.parse(await readFile(fixtureRoundTripDataPath, "utf8")),
    firstCanonicalMain,
    "a second API startup should not rewrite or semantically change the canonical main fixture"
  );
  assert.deepEqual(
    JSON.parse(await readFile(fixtureRoundTripQueuePath, "utf8")),
    firstCanonicalQueue,
    "a second API startup should not rewrite or semantically change the canonical queue fixture"
  );

  const backfillDataPath = join(tempDir, "review-backfill.json");
  const backfillCurationPath = join(tempDir, "review-backfill-curation.json");
  const backfillPosts = [
    makeApiSmokePost({
      id: "legacy-liked-a",
      title: "Legacy liked A",
      concepts: ["Legacy Review"],
      createdAt: "2026-06-01T00:00:00.000Z"
    }),
    makeApiSmokePost({
      id: "legacy-saved-b",
      title: "Legacy saved B",
      concepts: ["Legacy Review"],
      createdAt: "2026-06-01T00:00:00.000Z"
    }),
    makeApiSmokePost({
      id: "legacy-liked-c",
      title: "Legacy liked C",
      concepts: ["Legacy Review"],
      createdAt: "2026-06-01T00:00:00.000Z"
    })
  ];
  const connectionNotePost = {
    ...makeApiSmokePost({
      id: "legacy-connection-note",
      title: "Legacy connection note",
      concepts: ["Legacy Review"],
      createdAt: "2026-06-01T00:00:00.000Z"
    }),
    kind: "connection_note"
  };

  await writeFile(
    backfillDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-06-01T00:00:00.000Z",
      posts: [...backfillPosts, connectionNotePost],
      interactionSignals: [
        makeInteractionSignalRecord(backfillPosts[0], { liked: true, createdAt: "2026-06-01T00:00:00.000Z" }),
        makeInteractionSignalRecord(backfillPosts[1], { saved: true, createdAt: "2026-06-02T00:00:00.000Z" }),
        makeInteractionSignalRecord(backfillPosts[2], { liked: true, createdAt: "2026-06-03T00:00:00.000Z" }),
        makeInteractionSignalRecord(connectionNotePost, { liked: true, createdAt: "2026-06-04T00:00:00.000Z" })
      ]
    })
  );

  const backfillServer = createApiServer({
    dataPath: backfillDataPath,
    curationDataPath: backfillCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const firstDue = await requestJsonFromServer(backfillServer, "/api/review/due?now=2026-06-10T00:00:00.000Z");
    const firstSnapshot = await requestJsonFromServer(backfillServer, "/api/snapshot");
    const secondDue = await requestJsonFromServer(backfillServer, "/api/review/due?now=2026-06-10T00:00:00.000Z");
    const secondSnapshot = await requestJsonFromServer(backfillServer, "/api/snapshot");

    assert.deepEqual(
      firstDue.due.map((state) => state.postId),
      backfillPosts.map((post) => post.id),
      "legacy liked/saved signals should be backfilled into due review states"
    );
    assert.equal(firstSnapshot.reviewStates.length, 3, "review backfill should skip connection_note cards");
    assert.equal(
      firstSnapshot.reviewStates.find((state) => state.postId === backfillPosts[0].id)?.dueAt,
      "2026-06-02T00:00:00.000Z",
      "review backfill should derive dueAt from the original signal createdAt"
    );
    assert.deepEqual(secondDue.due, firstDue.due, "second due request should not duplicate backfilled review states");
    assert.equal(secondSnapshot.reviewStates.length, 3, "review backfill should be idempotent");

    // 注入面取卡端点:复习到期优先、连接播报卡除名、limit 生效、字段精简。
    const injectCards = await requestJsonFromServer(
      backfillServer,
      "/api/inject/cards?now=2026-06-10T00:00:00.000Z&limit=10"
    );

    assert.deepEqual(
      injectCards.cards.map((card) => card.id).sort(),
      backfillPosts.map((post) => post.id).sort(),
      "inject cards should serve the due review posts and never the connection note"
    );
    assert.ok(
      injectCards.cards.every((card) => card.reviewDueAt),
      "review-due cards should carry reviewDueAt so the extension can tell why they came back"
    );

    const [firstInjectCard] = injectCards.cards;

    assert.equal(firstInjectCard.topicId, "legacy-review", "inject card topicId should be the slug of the first concept");
    assert.deepEqual(firstInjectCard.conceptIds, ["Legacy Review"], "inject card should carry concept ids for signals");
    assert.ok(
      firstInjectCard.title && firstInjectCard.summary && firstInjectCard.sourceTitle && firstInjectCard.sourceUrl,
      "inject card should carry the render fields (title/summary/source)"
    );
    assert.equal(firstInjectCard.savedAt, "2026-06-01T00:00:00.000Z", "inject card savedAt should be the post createdAt");

    const limitedInjectCards = await requestJsonFromServer(
      backfillServer,
      "/api/inject/cards?now=2026-06-10T00:00:00.000Z&limit=2"
    );

    assert.equal(limitedInjectCards.cards.length, 2, "inject cards should honor the limit parameter");

    // 注入卡的三段信号(纯曝光 / 累计停留 / 点开)必须被信号端点原样接住。
    const injectPostId = firstInjectCard.id;
    const injectSignalBase = {
      postId: injectPostId,
      topicId: firstInjectCard.topicId,
      conceptIds: firstInjectCard.conceptIds,
      impression: true,
      dwellTimeMs: 0,
      openedThread: false,
      liked: false,
      saved: false,
      askedQuestion: false,
      reviewed: false,
      skippedQuickly: false
    };
    const injectImpression = await requestJsonFromServer(backfillServer, "/api/signals", {
      method: "POST",
      body: {
        generatedAt: "2026-06-10T01:00:00.000Z",
        signal: { ...injectSignalBase, createdAt: "2026-06-10T01:00:00.000Z" },
        sourceCandidates: []
      }
    });

    assert.equal(injectImpression.idempotentReplay, false, "inject impression should be accepted as a fresh signal");
    assert.equal(
      injectImpression.records.length,
      0,
      "inject impression must stay pure exposure and trigger no curation records"
    );

    const injectDwell = await requestJsonFromServer(backfillServer, "/api/signals", {
      method: "POST",
      body: {
        generatedAt: "2026-06-10T01:01:00.000Z",
        signal: { ...injectSignalBase, dwellTimeMs: 4200, createdAt: "2026-06-10T01:01:00.000Z" },
        sourceCandidates: []
      }
    });

    assert.ok(injectDwell.feedback, "inject dwell signal should produce learning feedback");

    const injectOpen = await requestJsonFromServer(backfillServer, "/api/signals", {
      method: "POST",
      body: {
        generatedAt: "2026-06-10T01:02:00.000Z",
        signal: { ...injectSignalBase, openedThread: true, dwellTimeMs: 9000, createdAt: "2026-06-10T01:02:00.000Z" },
        sourceCandidates: []
      }
    });

    assert.ok(injectOpen.feedback, "inject open signal should produce learning feedback");

    const injectSignalSnapshot = await requestJsonFromServer(backfillServer, "/api/snapshot");
    const injectSignalRecords = injectSignalSnapshot.interactionSignals.filter(
      (record) => record.signal.postId === injectPostId && record.createdAt.startsWith("2026-06-10T01:")
    );

    assert.equal(injectSignalRecords.length, 3, "all three inject signals should be persisted");
    assert.equal(
      Math.max(...injectSignalRecords.map((record) => record.signal.dwellTimeMs)),
      9000,
      "cumulative dwell should resolve to the max dwell across inject signals"
    );
  } finally {
    await closeServer(backfillServer);
  }

  const invalidHistoricalSignalDataPath = join(tempDir, "invalid-historical-signal.json");
  const invalidHistoricalSignalCurationPath = join(tempDir, "invalid-historical-signal-curation.json");
  const historicalSignalPost = makeApiSmokePost({
    id: "historical-signal-post",
    title: "Historical signal post",
    concepts: ["Historical Signal"]
  });

  await writeFile(
    invalidHistoricalSignalDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-06-10T00:00:00.000Z",
      posts: [historicalSignalPost],
      interactionSignals: [
        makeInteractionSignalRecord(historicalSignalPost, { createdAt: "not-a-date" })
      ]
    })
  );

  const originalConsoleWarn = console.warn;
  const historicalSignalWarnings = [];
  let invalidHistoricalSignalServer;

  console.warn = (...args) => historicalSignalWarnings.push(args);
  try {
    invalidHistoricalSignalServer = createApiServer({
      dataPath: invalidHistoricalSignalDataPath,
      curationDataPath: invalidHistoricalSignalCurationPath,
      mediaRootDir,
      enableFixtures: true,
      searchProvider: fakeSearchProvider
    });
  } finally {
    console.warn = originalConsoleWarn;
  }

  try {
    const historicalTimelineResponse = await dispatchToServer(
      invalidHistoricalSignalServer,
      `${baseUrl}/api/timeline?now=2026-06-10T00:00:00.000Z`
    );

    const historicalTimeline = await historicalTimelineResponse.json();

    assert.equal(historicalTimelineResponse.status, 200, "one bad historical signal must not crash timeline");
    assert.ok(
      historicalTimeline.posts.some((post) => post.id === historicalSignalPost.id),
      "timeline should keep serving posts after isolating a bad historical signal"
    );
    assert.ok(
      historicalSignalWarnings.some(
        (args) =>
          String(args[0]).includes("persistence load issue") &&
          args[1]?.recordId === "signal-historical-signal-post-not-a-date" &&
          args[1]?.jsonPath === "$.interactionSignals[0].signal.createdAt"
      ),
      "isolated historical signals should be reported during store construction with record id and path"
    );
  } finally {
    await closeServer(invalidHistoricalSignalServer);
  }

  const structuredErrorDataPath = join(tempDir, "structured-error-redaction.json");
  const structuredErrorCurationPath = join(tempDir, "structured-error-redaction-curation.json");
  const sensitiveStructuredError =
    "provider failed at https://internal.example/private using /Users/example/private-config.json";

  await writeFile(
    structuredErrorDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-06-10T00:00:00.000Z",
      sourceImports: [
        {
          id: "failed-structured-import",
          source: {
            id: "failed-structured-source",
            title: "Failed structured source",
            url: "https://example.com/failed-structured-source",
            type: "article"
          },
          status: "failed",
          createdAt: "2026-06-10T00:00:00.000Z",
          errorMessage: sensitiveStructuredError
        }
      ],
      subscriptions: [
        {
          id: "failed-structured-subscription",
          kind: "rss",
          feedUrl: "https://example.com/feed.xml",
          title: "Failed structured subscription",
          filterMode: "relevant",
          createdAt: "2026-06-01T00:00:00.000Z",
          lastError: sensitiveStructuredError
        }
      ]
    })
  );

  const structuredErrorServer = createApiServer({
    dataPath: structuredErrorDataPath,
    curationDataPath: structuredErrorCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const structuredTimeline = await requestJsonFromServer(
      structuredErrorServer,
      "/api/timeline?now=2026-06-10T00:00:00.000Z"
    );
    const structuredSubscriptions = await requestJsonFromServer(structuredErrorServer, "/api/subscriptions");
    const structuredSnapshot = await requestJsonFromServer(structuredErrorServer, "/api/snapshot");

    for (const payload of [structuredTimeline, structuredSubscriptions, structuredSnapshot]) {
      const serialized = JSON.stringify(payload);
      assert.equal(serialized.includes("internal.example"), false, "structured responses must redact internal URLs");
      assert.equal(serialized.includes("/Users/example"), false, "structured responses must redact file paths");
    }
  } finally {
    await closeServer(structuredErrorServer);
  }

  const backfillLimitDataPath = join(tempDir, "review-backfill-limit.json");
  const backfillLimitCurationPath = join(tempDir, "review-backfill-limit-curation.json");
  const backfillLimitPosts = Array.from({ length: 55 }, (_, index) =>
    makeApiSmokePost({
      id: `legacy-limit-${index + 1}`,
      title: `Legacy limit ${index + 1}`,
      concepts: ["Legacy Review Limit"],
      createdAt: "2026-06-01T00:00:00.000Z"
    })
  );

  await writeFile(
    backfillLimitDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-06-01T00:00:00.000Z",
      posts: backfillLimitPosts,
      interactionSignals: backfillLimitPosts.map((post, index) =>
        makeInteractionSignalRecord(post, {
          liked: true,
          createdAt: `2026-06-${String((index % 9) + 1).padStart(2, "0")}T00:00:00.000Z`
        })
      )
    })
  );

  const backfillLimitServer = createApiServer({
    dataPath: backfillLimitDataPath,
    curationDataPath: backfillLimitCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    await requestJsonFromServer(backfillLimitServer, "/api/review/due?now=2026-06-20T00:00:00.000Z");
    const limitSnapshot = await requestJsonFromServer(backfillLimitServer, "/api/snapshot");

    assert.equal(limitSnapshot.reviewStates.length, 50, "legacy review backfill should create at most 50 states per request");
  } finally {
    await closeServer(backfillLimitServer);
  }

  const reviewGradeDataPath = join(tempDir, "review-grades.json");
  const reviewGradeCurationPath = join(tempDir, "review-grades-curation.json");
  const reviewGradePosts = [
    makeReviewGradePost("review-remembered", "Review remembered", "Remembered Concept"),
    makeReviewGradePost("review-fuzzy", "Review fuzzy", "Fuzzy Concept"),
    makeReviewGradePost("review-forgot", "Review forgot", "Forgot Concept"),
    makeReviewGradePost("review-forgot-peer-a", "Review forgot peer A", "Forgot Concept"),
    makeReviewGradePost("review-forgot-peer-b", "Review forgot peer B", "Forgot Concept")
  ];

  await writeFile(
    reviewGradeDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-06-10T00:00:00.000Z",
      posts: reviewGradePosts,
      reviewStates: [
        {
          postId: "review-remembered",
          intervalDays: 3,
          dueAt: "2026-06-10T00:00:00.000Z",
          lastReviewedAt: "2026-06-07T00:00:00.000Z"
        },
        {
          postId: "review-fuzzy",
          intervalDays: 3,
          dueAt: "2026-06-10T00:00:00.000Z",
          lastReviewedAt: "2026-06-07T00:00:00.000Z"
        },
        {
          postId: "review-forgot",
          intervalDays: 7,
          dueAt: "2026-06-10T00:00:00.000Z",
          lastReviewedAt: "2026-06-03T00:00:00.000Z"
        },
        {
          postId: "review-forgot-peer-a",
          intervalDays: 7,
          dueAt: "2026-06-20T00:00:00.000Z",
          lastReviewedAt: "2026-06-03T00:00:00.000Z"
        },
        {
          postId: "review-forgot-peer-b",
          intervalDays: 14,
          dueAt: "2026-06-24T00:00:00.000Z",
          lastReviewedAt: "2026-06-10T00:00:00.000Z"
        }
      ],
      topicStates: [
        {
          topicId: "Forgot Concept",
          interestScore: 0.8,
          fatigueScore: 0.1,
          comprehensionScore: 0.9,
          updatedAt: "2026-06-10T00:00:00.000Z"
        }
      ]
    })
  );

  const reviewGradeServer = createApiServer({
    dataPath: reviewGradeDataPath,
    curationDataPath: reviewGradeCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const reviewDue = await requestJsonFromServer(
      reviewGradeServer,
      "/api/review/due?now=2026-06-10T00:00:00.000Z"
    );
    const rememberedDue = reviewDue.due.find((item) => item.postId === "review-remembered");
    const forgotDue = reviewDue.due.find((item) => item.postId === "review-forgot");

    assert.deepEqual(
      rememberedDue?.reviewPrompt,
      {
        id: "review-remembered-prompt-3",
        prompt: "Review remembered prompt for day 3",
        answerHint: "Review remembered answer for day 3"
      },
      "due review should select the prompt whose dueInDays matches the current interval"
    );
    assert.equal(
      forgotDue?.reviewPrompt?.answerHint,
      "Review forgot answer for day 7",
      "due review should carry the matched prompt answerHint"
    );
    assert.ok(
      reviewDue.due.every((item) => item.reviewPrompt?.id && item.reviewPrompt.prompt && item.reviewPrompt.answerHint),
      "every due review item should carry an id, prompt, and answerHint"
    );

    const rememberedBody = {
      reviewedAt: "2026-06-10T01:00:00.000Z",
      grade: "remembered",
      reviewEventId: "review-event-remembered-1"
    };
    const remembered = await requestJsonFromServer(
      reviewGradeServer,
      "/api/review/review-remembered/complete",
      { method: "POST", body: rememberedBody }
    );
    const rememberedSnapshot = await requestJsonFromServer(reviewGradeServer, "/api/snapshot");
    const rememberedReplay = await requestJsonFromServer(
      reviewGradeServer,
      "/api/review/review-remembered/complete",
      {
        method: "POST",
        body: {
          ...rememberedBody,
          reviewedAt: "2026-06-12T01:00:00.000Z",
          grade: "forgot"
        }
      }
    );
    const rememberedReplaySnapshot = await requestJsonFromServer(reviewGradeServer, "/api/snapshot");

    assert.equal(remembered.reviewState.intervalDays, 7, "remembered should advance to the next review interval");
    assert.equal(remembered.nextDueAt, "2026-06-17T01:00:00.000Z", "remembered should return its next due time");
    assert.equal(rememberedReplay.reviewState.intervalDays, 7, "same reviewEventId replay must not advance twice");
    assert.equal(
      rememberedReplay.nextDueAt,
      remembered.nextDueAt,
      "same reviewEventId must return the first result even when replay payload fields change"
    );
    assert.equal(rememberedReplay.idempotentReplay, true, "same reviewEventId should be reported as a replay");
    assert.equal(
      rememberedReplaySnapshot.interactionSignals.length,
      rememberedSnapshot.interactionSignals.length,
      "same reviewEventId replay must not duplicate review side effects"
    );
    assert.deepEqual(
      rememberedReplaySnapshot.topicStates,
      rememberedSnapshot.topicStates,
      "same reviewEventId replay must not update topic state twice"
    );

    const fuzzy = await requestJsonFromServer(reviewGradeServer, "/api/review/review-fuzzy/complete", {
      method: "POST",
      body: {
        reviewedAt: "2026-06-10T02:00:00.000Z",
        grade: "fuzzy",
        reviewEventId: "review-event-fuzzy-1"
      }
    });

    assert.equal(fuzzy.reviewState.intervalDays, 3, "fuzzy should keep the current review interval");
    assert.equal(fuzzy.nextDueAt, "2026-06-13T02:00:00.000Z", "fuzzy should schedule from the held interval");

    const forgot = await requestJsonFromServer(reviewGradeServer, "/api/review/review-forgot/complete", {
      method: "POST",
      body: {
        reviewedAt: "2026-06-10T03:00:00.000Z",
        grade: "forgot",
        reviewEventId: "review-event-forgot-1"
      }
    });
    const forgotSnapshot = await requestJsonFromServer(reviewGradeServer, "/api/snapshot");
    const forgotMemory = forgotSnapshot.userMemories.find((record) => record.userId === "local-user")?.memory;

    assert.equal(forgot.reviewState.intervalDays, 1, "forgot should reset to the shortest review interval");
    assert.equal(forgot.nextDueAt, "2026-06-11T03:00:00.000Z", "forgot should return the reset due time");
    assert.deepEqual(forgot.masteryPromotions, [], "forgot must not promote mastery");
    assert.equal(
      forgotMemory?.knowledge.knownConcepts.includes("Forgot Concept") ?? false,
      false,
      "forgot must not add the reviewed concept to mastery memory"
    );
  } finally {
    await closeServer(reviewGradeServer);
  }

  const failedCandidateDataPath = join(tempDir, "failed-candidate.json");
  const failedCandidateCurationPath = join(tempDir, "failed-candidate-curation.json");
  const failedCandidateRecord = makeSourceCandidateRecord({
    id: "legacy-unsupported-candidate",
    url: "https://github.com/example/legacy-unsupported-candidate",
    score: 0.9,
    status: "queued",
    concept: "Legacy Candidate",
    createdAt: "2026-06-10T00:00:00.000Z"
  });
  failedCandidateRecord.candidate.source.type = "repo";
  const failedCandidateJob = makeQueuedImportJobRecord(
    failedCandidateRecord,
    "2026-06-10T00:00:00.000Z"
  );

  await writeFile(
    failedCandidateDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-06-10T00:00:00.000Z",
      sourceCandidates: [failedCandidateRecord]
    })
  );
  await writeFile(
    failedCandidateCurationPath,
    JSON.stringify({ version: 1, records: [failedCandidateJob] })
  );

  const failedCandidateServer = createApiServer({
    dataPath: failedCandidateDataPath,
    curationDataPath: failedCandidateCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const failedCandidateBatch = await requestJsonFromServer(failedCandidateServer, "/api/curation/run", {
      method: "POST",
      body: { now: "2026-06-10T00:00:00.000Z", kinds: ["import_source"] }
    });
    const failedCandidateSnapshot = await requestJsonFromServer(failedCandidateServer, "/api/snapshot");
    const terminalCandidate = failedCandidateSnapshot.sourceCandidates.find(
      (record) => record.id === failedCandidateRecord.id
    );
    const terminalJob = failedCandidateBatch.records.find((record) => record.job.id === failedCandidateJob.job.id);

    assert.equal(terminalJob?.status, "failed", "unsupported legacy import jobs should reach a failed terminal state");
    assert.equal(terminalJob?.lastError, "Source import failed.", "failed job responses should redact internal causes");
    assert.equal(
      terminalCandidate?.status,
      "skipped",
      "non-network terminal import failures should move candidates out of queued"
    );
    assert.deepEqual(
      terminalCandidate?.rejectionReasons,
      ["Source import failed."],
      "terminal candidate failures should persist a stable failure reason"
    );
  } finally {
    await closeServer(failedCandidateServer);
  }

  // A curation run executes synchronously and can outlive the page's patience.
  // A second run arriving mid-flight must bail out instead of stacking another
  // pass over the queue.
  const runGuardCreatedAt = "2026-07-20T00:00:00.000Z";
  const runGuardDataPath = join(tempDir, "run-guard.json");
  const runGuardCurationPath = join(tempDir, "run-guard-curation.json");
  const runGuardCandidates = ["run-guard-a", "run-guard-b"].map((id) =>
    makeSourceCandidateRecord({
      id,
      url: `https://run-guard.local/${id}`,
      score: 0.9,
      status: "queued",
      concept: "Run Guard",
      createdAt: runGuardCreatedAt
    })
  );

  await writeFile(
    runGuardDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: runGuardCreatedAt,
      sourceCandidates: runGuardCandidates
    })
  );
  await writeFile(
    runGuardCurationPath,
    JSON.stringify({
      version: 1,
      records: runGuardCandidates.map((record) => makeQueuedImportJobRecord(record, runGuardCreatedAt))
    })
  );

  const runGuardFetchUrls = [];
  let releaseRunGuardFetch = null;
  const runGuardServer = createApiServer({
    dataPath: runGuardDataPath,
    curationDataPath: runGuardCurationPath,
    mediaRootDir,
    guardedFetch: async (input, init) => {
      const url = getFetchUrl(input);

      if (!url.startsWith("https://run-guard.local/")) {
        return globalThis.fetch(input, init);
      }

      runGuardFetchUrls.push(url);

      // Only the first import hangs: a second run that slipped past the guard
      // then finishes on its own and shows up as an extra fetch plus a moved
      // job, instead of hanging the smoke.
      if (runGuardFetchUrls.length === 1) {
        await new Promise((resolveFetch) => {
          releaseRunGuardFetch = resolveFetch;
        });
      }

      return new Response(
        `
          <html>
            <head><meta property="og:title" content="Run guard fixture" /></head>
            <body>
              <article>
                <p>The observer run guard keeps a second concurrent run from stacking onto the queue.</p>
              </article>
            </body>
          </html>
        `,
        { status: 200, headers: { "content-type": "text/html" } }
      );
    }
  });

  async function waitForRunGuardFetch(expectedCount) {
    for (let attempt = 0; attempt < 400 && runGuardFetchUrls.length < expectedCount; attempt += 1) {
      await new Promise((resolveTick) => setTimeout(resolveTick, 5));
    }

    assert.equal(
      runGuardFetchUrls.length,
      expectedCount,
      `curation run should reach blocking source fetch #${expectedCount}`
    );
  }

  try {
    const blockedFirstRun = requestJsonFromServer(runGuardServer, "/api/curation/run", {
      method: "POST",
      body: { now: runGuardCreatedAt, limit: 1, kinds: ["import_source"] }
    });

    await waitForRunGuardFetch(1);

    const jobsBeforeConcurrentRun = await requestJsonFromServer(runGuardServer, "/api/curation/jobs");
    const concurrentRun = await requestJsonFromServer(runGuardServer, "/api/curation/run", {
      method: "POST",
      body: { now: "2026-07-20T00:00:01.000Z", limit: 1, kinds: ["import_source"] }
    });
    const jobsAfterConcurrentRun = await requestJsonFromServer(runGuardServer, "/api/curation/jobs");

    assert.equal(concurrentRun.alreadyRunning, true, "a run arriving mid-flight should report alreadyRunning");
    assert.equal(typeof concurrentRun.startedAt, "string", "the guarded response should say when the run started");
    assert.equal(concurrentRun.records, undefined, "the guarded run should not report a batch it never ran");
    assert.equal(runGuardFetchUrls.length, 1, "the guarded run should not start a second import");
    assert.deepEqual(
      jobsAfterConcurrentRun.jobs.map((record) => `${record.id}:${record.status}`),
      jobsBeforeConcurrentRun.jobs.map((record) => `${record.id}:${record.status}`),
      "the guarded run should leave the queue untouched"
    );

    releaseRunGuardFetch();

    const firstRunResult = await blockedFirstRun;

    assert.equal(firstRunResult.alreadyRunning, false, "the run holding the guard should report alreadyRunning false");
    assert.equal(firstRunResult.records.length, 1, "the run holding the guard should still process its job");

    // The guard is released in a finally, so the next run gets to work.
    const laterRunResult = await requestJsonFromServer(runGuardServer, "/api/curation/run", {
      method: "POST",
      body: { now: "2026-07-20T00:01:00.000Z", limit: 1, kinds: ["import_source"] }
    });

    assert.equal(laterRunResult.alreadyRunning, false, "the guard should release once a run finishes");
    assert.equal(laterRunResult.records.length, 1, "a run after the guard released should process the next job");
  } finally {
    releaseRunGuardFetch?.();
    await closeServer(runGuardServer);
  }

  const masteryDataPath = join(tempDir, "mastery-promotion.json");
  const masteryCurationPath = join(tempDir, "mastery-promotion-curation.json");
  const masteryConcept = "Mastery Loop";
  const masteryPosts = [
    makeApiSmokePost({
      id: "mastery-card-a",
      title: "Mastery card A",
      concepts: [masteryConcept],
      createdAt: "2026-06-01T00:00:00.000Z"
    }),
    makeApiSmokePost({
      id: "mastery-card-b",
      title: "Mastery card B",
      concepts: [masteryConcept],
      createdAt: "2026-06-01T00:00:00.000Z"
    })
  ];

  await writeFile(
    masteryDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-06-10T00:00:00.000Z",
      posts: masteryPosts,
      learningGoals: [
        {
          id: "learning-goal-mastery-loop",
          concept: masteryConcept,
          createdAt: "2026-06-09T00:00:00.000Z",
          status: "active"
        }
      ],
      reviewStates: [
        {
          postId: masteryPosts[0].id,
          intervalDays: 3,
          dueAt: "2026-06-10T00:00:00.000Z",
          lastReviewedAt: "2026-06-07T00:00:00.000Z"
        },
        {
          postId: masteryPosts[1].id,
          intervalDays: 7,
          dueAt: "2026-06-17T00:00:00.000Z",
          lastReviewedAt: "2026-06-10T00:00:00.000Z"
        }
      ],
      topicStates: [
        {
          topicId: masteryConcept.toLowerCase(),
          interestScore: 0.4,
          fatigueScore: 0.1,
          comprehensionScore: 0.2,
          updatedAt: "2026-05-01T00:00:00.000Z"
        },
        {
          topicId: masteryConcept,
          interestScore: 0.8,
          fatigueScore: 0.1,
          comprehensionScore: 0.72,
          updatedAt: "2026-06-10T00:00:00.000Z"
        }
      ]
    })
  );

  const masteryServer = createApiServer({
    dataPath: masteryDataPath,
    curationDataPath: masteryCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const promoted = await requestJsonFromServer(
      masteryServer,
      `/api/review/${encodeURIComponent(masteryPosts[0].id)}/complete`,
      {
        method: "POST",
        body: { reviewedAt: "2026-06-10T00:00:00.000Z" }
      }
    );
    const promotedSnapshot = await requestJsonFromServer(masteryServer, "/api/snapshot");
    const promotedMemory = promotedSnapshot.userMemories.find((record) => record.userId === "local-user")?.memory;
    const promotionEvent = promotedSnapshot.memoryEvents.find(
      (record) => record.event.kind === "auto_mastery_promotion" && record.event.field === "knowledge.knownConcepts"
    );
    const promotionNotification = promotedSnapshot.notifications.find((record) => record.kind === "mastery_promotion");
    const goalRecord = promotedSnapshot.learningGoals.find((record) => record.id === "learning-goal-mastery-loop");
    const goalNotification = promotedSnapshot.notifications.find((record) => record.kind === "learning_goal_achieved");

    assert.equal(promoted.masteryPromotions.length, 1, "complete should auto-promote a concept that meets mastery rules");
    assert.equal(
      promoted.learningGoalAchievements.length,
      1,
      "auto-promoted active goal concepts should be marked achieved in the review response"
    );
    assert.ok(
      promotedMemory?.knowledge.knownConcepts.includes(masteryConcept),
      "auto-promoted concept should enter knownConcepts"
    );
    assert.ok(promotionEvent, "auto promotion should persist a memory event with an auto_mastery_promotion kind");
    assert.match(
      promotionEvent?.event.reason ?? "",
      /cards=2\/2.*score=/,
      "auto promotion memory event should record card, interval, and score evidence"
    );
    assert.ok(promotionNotification, "auto promotion should create a mastery notification");
    assert.match(promotionNotification?.body ?? "", /已进入已掌握/, "mastery notification should use the zh template");
    assert.equal(goalRecord?.status, "achieved", "auto-promoted active goal should persist as achieved");
    assert.ok(goalRecord?.achievedAt, "achieved learning goals should persist achievedAt");
    assert.ok(goalNotification, "auto-promoted learning goal should create a goal notification");

    await requestJsonFromServer(masteryServer, "/api/goals?userId=local-user&now=2026-06-10T00:00:00.000Z");
    const repeatedGoalSnapshot = await requestJsonFromServer(masteryServer, "/api/snapshot");
    assert.equal(
      repeatedGoalSnapshot.notifications.filter((record) => record.kind === "learning_goal_achieved").length,
      1,
      "learning goal achieved notification should be idempotent across lazy checks"
    );

    await requestJsonFromServer(masteryServer, "/api/memory", {
      method: "POST",
      body: {
        edits: [{ kind: "add", field: "knowledge.knownConcepts", value: "Manual Only Concept" }]
      }
    });
    const demotion = await requestJsonFromServer(masteryServer, "/api/memory", {
      method: "POST",
      body: {
        edits: [
          { kind: "remove", field: "knowledge.knownConcepts", value: masteryConcept },
          { kind: "remove", field: "knowledge.knownConcepts", value: "Manual Only Concept" }
        ]
      }
    });
    const demotedSnapshot = await requestJsonFromServer(masteryServer, "/api/snapshot");
    const blacklistEvents = demotedSnapshot.memoryEvents.filter(
      (record) => record.event.kind === "auto_mastery_blacklist" && record.event.field === "knowledge.knownConcepts"
    );

    assert.ok(
      demotion.events.some((event) => event.kind === "auto_mastery_blacklist"),
      "manual removal of an auto-promoted concept should return a blacklist event"
    );
    assert.equal(
      blacklistEvents.length,
      1,
      "batch removal should only blacklist the auto-promoted concept, not manual ones removed alongside"
    );
    assert.deepEqual(
      blacklistEvents[0]?.event.previousValue,
      [masteryConcept],
      "blacklist event should carry a single-concept diff so batch removals stay precise"
    );

    const blockedPromotion = await requestJsonFromServer(
      masteryServer,
      `/api/review/${encodeURIComponent(masteryPosts[1].id)}/complete`,
      {
        method: "POST",
        body: { reviewedAt: "2026-06-11T00:00:00.000Z" }
      }
    );
    const blockedSnapshot = await requestJsonFromServer(masteryServer, "/api/snapshot");
    const blockedMemory = blockedSnapshot.userMemories.find((record) => record.userId === "local-user")?.memory;

    assert.deepEqual(blockedPromotion.masteryPromotions, [], "blacklisted concepts should not be auto-promoted again");
    assert.equal(
      blockedMemory?.knowledge.knownConcepts.includes(masteryConcept),
      false,
      "blacklisted concepts should stay out of knownConcepts after later review completions"
    );
    assert.equal(
      blockedSnapshot.notifications.filter((record) => record.kind === "mastery_promotion").length,
      1,
      "blacklisted concepts should not create another mastery notification"
    );
  } finally {
    await closeServer(masteryServer);
  }

  const goalDataPath = join(tempDir, "learning-goals.json");
  const goalCurationPath = join(tempDir, "learning-goals-curation.json");
  const goalPosts = [
    makeApiSmokePost({
      id: "goal-foundation",
      title: "Goal Foundation",
      concepts: ["Foundation"],
      createdAt: "2026-07-01T00:00:00.000Z"
    }),
    {
      ...makeApiSmokePost({
        id: "goal-prerequisite",
        title: "Goal Prerequisite",
        concepts: ["Prerequisite"],
        createdAt: "2026-07-02T00:00:00.000Z"
      }),
      graphEdges: [
        {
          id: "goal-prereq-requires-foundation",
          sourceConcept: "Prerequisite",
          relation: "requires",
          targetConcept: "Foundation",
          evidence: "Prerequisite requires Foundation.",
          weight: 0.8
        }
      ]
    },
    {
      ...makeApiSmokePost({
        id: "goal-target",
        title: "Goal Topic",
        concepts: ["Goal Topic"],
        createdAt: "2026-07-03T00:00:00.000Z"
      }),
      graphEdges: [
        {
          id: "goal-topic-requires-prerequisite",
          sourceConcept: "Goal Topic",
          relation: "requires",
          targetConcept: "Prerequisite",
          evidence: "Goal Topic requires Prerequisite.",
          weight: 0.9
        },
        {
          id: "goal-topic-requires-gap",
          sourceConcept: "Goal Topic",
          relation: "requires",
          targetConcept: "Gap Concept",
          evidence: "Goal Topic requires an uncovered gap concept.",
          weight: 0.7
        }
      ]
    },
    makeApiSmokePost({
      id: "goal-other",
      title: "Other Goal",
      concepts: ["Other Goal"],
      createdAt: "2026-07-04T00:00:00.000Z"
    })
  ];

  await writeFile(
    goalDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-07-08T00:00:00.000Z",
      posts: goalPosts
    })
  );

  const goalServer = createApiServer({
    dataPath: goalDataPath,
    curationDataPath: goalCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const createdGoal = await requestJsonFromServer(goalServer, "/api/goals", {
      method: "POST",
      body: {
        concept: "Goal Topic",
        now: "2026-07-08T00:00:00.000Z"
      }
    });
    const queuedGapTopics = createdGoal.gapProduction.records.map((record) => record.job.topicId);

    assert.equal(createdGoal.record.status, "active", "POST /api/goals should create an active learning goal");
    assert.ok(createdGoal.record.tree, "created active goals should include a realtime skill tree");
    assert.ok(
      createdGoal.record.tree.nodes.some((node) => node.concept === "Gap Concept" && node.gap),
      "created goal tree should expose uncovered gap concepts"
    );
    assert.ok(
      queuedGapTopics.includes("Gap Concept"),
      "creating a learning goal should enqueue gap concepts as concept_brief jobs"
    );
    assert.ok(
      createdGoal.gapProduction.records.length > 0 && createdGoal.gapProduction.records.length <= 3,
      "gap production should enqueue at most 3 concept_brief jobs per call"
    );
    assert.equal(
      createdGoal.gapProduction.budget.used,
      createdGoal.gapProduction.records.length,
      "goal gap production should consume the daily auto-job budget"
    );

    const goalsAfterFirstGet = await requestJsonFromServer(
      goalServer,
      "/api/goals?userId=local-user&now=2026-07-08T00:00:00.000Z"
    );
    const snapshotAfterFirstGet = await requestJsonFromServer(goalServer, "/api/snapshot");
    const usedAfterFirstGet = snapshotAfterFirstGet.autoJobBudget[0]?.used ?? 0;
    const queuedAfterFirstGet = snapshotAfterFirstGet.curationJobs.filter((record) => record.job.kind === "concept_brief").length;

    await requestJsonFromServer(goalServer, "/api/goals?userId=local-user&now=2026-07-08T00:00:00.000Z");
    const snapshotAfterRepeatGet = await requestJsonFromServer(goalServer, "/api/snapshot");
    const queuedAfterRepeatGet = snapshotAfterRepeatGet.curationJobs.filter(
      (record) => record.job.kind === "concept_brief"
    ).length;

    assert.equal(goalsAfterFirstGet.records.length, 1, "GET /api/goals should list active goals");
    assert.equal(
      snapshotAfterRepeatGet.autoJobBudget[0]?.used,
      usedAfterFirstGet,
      "repeated GET /api/goals should not consume budget for duplicate gap jobs"
    );
    assert.equal(
      queuedAfterRepeatGet,
      queuedAfterFirstGet,
      "repeated GET /api/goals should not duplicate concept_brief queue records"
    );

    const goalTimeline = await requestJsonFromServer(
      goalServer,
      "/api/timeline?userId=local-user&now=2026-07-08T00:00:00.000Z"
    );

    assert.ok(
      goalTimeline.posts.some((post) => post.scoreReasons.some((reason) => reason.includes("在你的学习路径上"))),
      "timeline ranking should expose the learning path reason when a card concept hits an active goal path"
    );
    assert.ok(Array.isArray(goalTimeline.timelineBlocks), "timeline API should expose block structure");
    assert.ok(
      goalTimeline.timelineBlocks.some((block) => block.divider?.topicLabel),
      "timeline blocks should expose divider metadata"
    );
    assert.ok(
      goalTimeline.posts.some((post) => post.blockTopic?.source === "learning_goal"),
      "timeline posts should expose their computed blockTopic"
    );

    await requestJsonFromServer(goalServer, "/api/goals", {
      method: "POST",
      body: { concept: "Prerequisite", now: "2026-07-08T00:01:00.000Z" }
    });
    await requestJsonFromServer(goalServer, "/api/goals", {
      method: "POST",
      body: { concept: "Foundation", now: "2026-07-08T00:02:00.000Z" }
    });
    const overLimitResponse = await dispatchToServer(goalServer, `${baseUrl}/api/goals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ concept: "Other Goal", now: "2026-07-08T00:03:00.000Z" })
    });
    const overLimitPayload = await overLimitResponse.json();

    assert.equal(overLimitResponse.status, 400, "POST /api/goals should reject more than 3 active goals");
    assert.match(overLimitPayload.error, /3 active learning goals/, "active goal limit error should explain the cap");

    const archivedGoal = await requestJsonFromServer(
      goalServer,
      `/api/goals/${encodeURIComponent(createdGoal.record.id)}`,
      {
        method: "POST",
        body: { status: "archived" }
      }
    );

    assert.equal(archivedGoal.record.status, "archived", "POST /api/goals/:id should archive a goal");

    const deletedGoal = await requestJsonFromServer(
      goalServer,
      `/api/goals/${encodeURIComponent(createdGoal.record.id)}`,
      {
        method: "DELETE"
      }
    );

    assert.equal(deletedGoal.deleted, true, "DELETE /api/goals/:id should delete a goal");
  } finally {
    await closeServer(goalServer);
  }

  const topicBlocksDataPath = join(tempDir, "topic-blocks-timeline.json");
  const topicBlocksCurationPath = join(tempDir, "topic-blocks-curation.json");
  const topicBlocksNow = "2026-07-08T10:00:00.000Z";
  const topicBlockPosts = [
    makeApiSmokePost({
      id: "alpha-block-1",
      title: "Alpha block 1",
      concepts: ["Alpha"],
      createdAt: "2026-07-08T08:00:00.000Z"
    }),
    makeApiSmokePost({
      id: "alpha-block-2",
      title: "Alpha block 2",
      concepts: ["Alpha"],
      createdAt: "2026-07-08T08:01:00.000Z"
    }),
    makeApiSmokePost({
      id: "alpha-block-3",
      title: "Alpha block 3",
      concepts: ["Alpha"],
      createdAt: "2026-07-08T08:02:00.000Z"
    }),
    makeApiSmokePost({
      id: "beta-block-1",
      title: "Beta block 1",
      concepts: ["Beta"],
      createdAt: "2026-07-08T09:00:00.000Z"
    }),
    makeApiSmokePost({
      id: "beta-block-2",
      title: "Beta block 2",
      concepts: ["Beta"],
      createdAt: "2026-07-08T09:01:00.000Z"
    }),
    makeApiSmokePost({
      id: "beta-block-3",
      title: "Beta block 3",
      concepts: ["Beta"],
      createdAt: "2026-07-08T09:02:00.000Z"
    })
  ];

  await writeFile(
    topicBlocksDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: topicBlocksNow,
      posts: topicBlockPosts,
      userMemories: [
        {
          userId: "local-user",
          updatedAt: topicBlocksNow,
          memory: {
            profile: { interests: ["Beta"], goals: [] },
            knowledge: { knownConcepts: [], weakConcepts: [], savedConcepts: [] },
            interaction: { recentCardIds: [], recentQuestions: [] },
            agent: { topicAgents: [], preferredSourceTypes: [] }
          }
        }
      ]
    })
  );

  const topicBlocksServer = createApiServer({
    dataPath: topicBlocksDataPath,
    curationDataPath: topicBlocksCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const initialTopicBlocksTimeline = await requestJsonFromServer(
      topicBlocksServer,
      `/api/timeline?userId=local-user&now=${encodeURIComponent(topicBlocksNow)}`
    );

    assert.equal(
      initialTopicBlocksTimeline.timelineBlocks[0]?.topic.label,
      "Beta",
      "timeline blocks should initially follow the highest-ranked topic block"
    );

    await requestJsonFromServer(topicBlocksServer, "/api/signals", {
      method: "POST",
      body: {
        generatedAt: topicBlocksNow,
        signal: {
          postId: "alpha-block-1",
          topicId: "Alpha",
          conceptIds: ["Alpha"],
          impression: true,
          dwellTimeMs: 300000,
          openedThread: false,
          liked: false,
          saved: false,
          askedQuestion: false,
          reviewed: false,
          skippedQuickly: false,
          createdAt: topicBlocksNow
        }
      }
    });

    const dwellBoostedTimeline = await requestJsonFromServer(
      topicBlocksServer,
      `/api/timeline?userId=local-user&now=${encodeURIComponent(topicBlocksNow)}`
    );

    assert.equal(
      dwellBoostedTimeline.timelineBlocks[0]?.topic.label,
      "Alpha",
      "same-day dwell aggregation should change the timeline block order"
    );

    // Dwell reports are cumulative per card and re-sent as they grow: two
    // records for the same post must aggregate as max, not sum.
    for (const dwellTimeMs of [60000, 90000]) {
      await requestJsonFromServer(topicBlocksServer, "/api/signals", {
        method: "POST",
        body: {
          generatedAt: topicBlocksNow,
          signal: {
            postId: "alpha-block-2",
            topicId: "Alpha",
            conceptIds: ["Alpha"],
            impression: true,
            dwellTimeMs,
            openedThread: false,
            liked: false,
            saved: false,
            askedQuestion: false,
            reviewed: false,
            skippedQuickly: false,
            createdAt: topicBlocksNow
          }
        }
      });
    }

    const cumulativeDwellTimeline = await requestJsonFromServer(
      topicBlocksServer,
      `/api/timeline?userId=local-user&now=${encodeURIComponent(topicBlocksNow)}`
    );
    const alphaBlock = cumulativeDwellTimeline.timelineBlocks.find((block) => block.topic.label === "Alpha");

    // alpha-block-1 max 300000 clamped to 120000, alpha-block-2 max(60000, 90000)
    // = 90000 -> 210000ms = 3.5 min * 6 = 21. A sum would give 27.
    assert.equal(
      alphaBlock?.dwellBoost,
      21,
      "cumulative dwell re-sends for the same post should aggregate as per-post max, not sum"
    );
  } finally {
    await closeServer(topicBlocksServer);
  }

  // Feed freshness: a per-page-load seed rotates cards that score close together
  // so a reload opens on a different card, while a seedless request stays
  // deterministic.
  const freshnessDataPath = join(tempDir, "feed-freshness-timeline.json");
  const freshnessCurationPath = join(tempDir, "feed-freshness-curation.json");
  const freshnessNow = "2026-07-08T10:00:00.000Z";

  await writeFile(
    freshnessDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: freshnessNow,
      posts: Array.from({ length: 6 }, (_unused, index) =>
        makeApiSmokePost({
          id: `freshness-post-${index + 1}`,
          title: `Freshness post ${index + 1}`,
          concepts: ["Freshness"],
          createdAt: `2026-07-08T0${index}:00:00.000Z`
        })
      )
    })
  );

  const freshnessServer = createApiServer({
    dataPath: freshnessDataPath,
    curationDataPath: freshnessCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const freshnessTimelineIds = async (seed) =>
      (
        await requestJsonFromServer(
          freshnessServer,
          `/api/timeline?userId=local-user&now=${encodeURIComponent(freshnessNow)}${
            seed === undefined ? "" : `&seed=${encodeURIComponent(seed)}`
          }`
        )
      ).posts.map((post) => post.id);
    const seedlessIds = await freshnessTimelineIds();

    assert.equal(seedlessIds.length, 6, "feed freshness fixture should expose all six candidate posts");
    assert.deepEqual(
      await freshnessTimelineIds(),
      seedlessIds,
      "timeline without a seed should return the same order on every request"
    );

    const firstSeedIds = await freshnessTimelineIds("page-load-one");
    const secondSeedIds = await freshnessTimelineIds("page-load-two");

    assert.deepEqual(
      await freshnessTimelineIds("page-load-one"),
      firstSeedIds,
      "the same seed should return the same order, so polling inside one page load does not shuffle"
    );
    assert.notEqual(
      firstSeedIds[0],
      secondSeedIds[0],
      `two different seeds should open on different posts: ${JSON.stringify({ firstSeedIds, secondSeedIds })}`
    );
    assert.deepEqual(
      [...firstSeedIds].sort(),
      [...seedlessIds].sort(),
      "seed rotation should reorder the timeline without adding or dropping posts"
    );
    assert.deepEqual(
      await freshnessTimelineIds("not a valid seed!"),
      seedlessIds,
      "an invalid seed should be ignored instead of rejected"
    );
  } finally {
    await closeServer(freshnessServer);
  }

  const conceptKeyApiDataPath = join(tempDir, "concept-key-api.json");
  const conceptKeyApiCurationPath = join(tempDir, "concept-key-api-curation.json");
  const conceptKeyApiNow = "2026-07-08T10:00:00.000Z";
  const conceptKeyApiPost = makeApiSmokePost({
    id: "concept-key-rag-post",
    title: "RAG concept-key API fixture",
    concepts: ["RAG"],
    createdAt: conceptKeyApiNow
  });
  const conceptKeyDwellPost = makeApiSmokePost({
    id: "coalesced-dwell-api-post",
    title: "Coalesced dwell API fixture",
    concepts: ["Dwell"],
    createdAt: conceptKeyApiNow
  });
  const productionThresholdPost = makeApiSmokePost({
    id: "production-threshold-api-post",
    title: "Production threshold API fixture",
    concepts: ["Threshold"],
    createdAt: conceptKeyApiNow
  });
  const directThresholdPost = makeApiSmokePost({
    id: "direct-threshold-api-post",
    title: "Direct threshold API fixture",
    concepts: ["Threshold Direct"],
    createdAt: conceptKeyApiNow
  });
  const likedThresholdPost = makeApiSmokePost({
    id: "liked-threshold-api-post",
    title: "Liked threshold API fixture",
    concepts: ["Threshold Liked"],
    createdAt: conceptKeyApiNow
  });
  const incrementalStrengthPost = makeApiSmokePost({
    id: "incremental-strength-api-post",
    title: "Incremental strength API fixture",
    concepts: ["Strength Incremental"],
    createdAt: conceptKeyApiNow
  });
  const directStrengthPost = makeApiSmokePost({
    id: "direct-strength-api-post",
    title: "Direct strength API fixture",
    concepts: ["Strength Direct"],
    createdAt: conceptKeyApiNow
  });

  await writeFile(
    conceptKeyApiDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: conceptKeyApiNow,
      posts: [
        conceptKeyApiPost,
        conceptKeyDwellPost,
        productionThresholdPost,
        directThresholdPost,
        likedThresholdPost,
        incrementalStrengthPost,
        directStrengthPost
      ]
    })
  );

  const conceptKeyApiServer = createApiServer({
    dataPath: conceptKeyApiDataPath,
    curationDataPath: conceptKeyApiCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    await requestJsonFromServer(conceptKeyApiServer, "/api/source-candidates", {
      method: "POST",
      body: {
        url: `${baseUrl}/fixtures/article-background?query=full-width-rag`,
        title: "Full-width RAG candidate",
        intakeKind: "agent_discovery",
        topicId: "ＲＡＧ",
        conceptIds: ["ＲＡＧ"],
        relevanceScore: 0.95,
        noveltyScore: 0.8,
        qualityScore: 0.9,
        reason: "Full-width concept-key candidate fixture.",
        discoveredAt: conceptKeyApiNow
      }
    });
    const conceptKeySignalResult = await requestJsonFromServer(conceptKeyApiServer, "/api/signals", {
      method: "POST",
      body: {
        generatedAt: conceptKeyApiNow,
        signal: {
          postId: conceptKeyApiPost.id,
          topicId: "RAG",
          conceptIds: ["RAG"],
          impression: true,
          dwellTimeMs: 18000,
          openedThread: true,
          liked: true,
          saved: false,
          askedQuestion: false,
          reviewed: false,
          skippedQuickly: false,
          createdAt: conceptKeyApiNow
        }
      }
    });

    assert.ok(
      conceptKeySignalResult.records.some((record) => record.job.kind === "import_source"),
      "API candidate matching should treat full-width ＲＡＧ and ASCII RAG as one concept key"
    );

    const cumulativeDwellResults = [];
    let snapshotAfterFirstDwell;

    for (const [index, dwellTimeMs] of [12000, 15000, 18000].entries()) {
      cumulativeDwellResults.push(
        await requestJsonFromServer(conceptKeyApiServer, "/api/signals", {
          method: "POST",
          body: {
            generatedAt: `2026-07-08T11:0${index}:00.000Z`,
            signal: {
              postId: conceptKeyDwellPost.id,
              topicId: "Dwell",
              conceptIds: ["Dwell"],
              impression: true,
              dwellTimeMs,
              openedThread: false,
              liked: false,
              saved: false,
              askedQuestion: false,
              reviewed: false,
              skippedQuickly: false,
              createdAt: `2026-07-08T11:0${index}:00.000Z`
            }
          }
        })
      );

      if (index === 0) {
        snapshotAfterFirstDwell = await requestJsonFromServer(conceptKeyApiServer, "/api/snapshot");
      }
    }

    const snapshotAfterCumulativeDwell = await requestJsonFromServer(conceptKeyApiServer, "/api/snapshot");
    const firstDwellBudget = snapshotAfterFirstDwell.autoJobBudget.find((record) => record.date === "2026-07-08");
    const finalDwellBudget = snapshotAfterCumulativeDwell.autoJobBudget.find((record) => record.date === "2026-07-08");

    assert.ok(cumulativeDwellResults[0].records.length > 0, "the first qualifying dwell should enqueue production");
    assert.ok(
      cumulativeDwellResults.slice(1).every((result) => result.coalescedReplay && result.records.length === 0),
      "15s and 18s cumulative re-sends should not repeat topic feedback production"
    );
    assert.equal(
      finalDwellBudget?.used,
      firstDwellBudget?.used,
      "cumulative dwell re-sends should not consume the daily budget again"
    );
    assert.equal(
      snapshotAfterCumulativeDwell.curationJobs.length,
      snapshotAfterFirstDwell.curationJobs.length,
      "cumulative dwell re-sends should not persist duplicate curation jobs"
    );
    assert.deepEqual(
      {
        interestScore: cumulativeDwellResults[2].topicState.interestScore,
        fatigueScore: cumulativeDwellResults[2].topicState.fatigueScore,
        comprehensionScore: cumulativeDwellResults[2].topicState.comprehensionScore
      },
      {
        interestScore: cumulativeDwellResults[0].topicState.interestScore,
        fatigueScore: cumulativeDwellResults[0].topicState.fatigueScore,
        comprehensionScore: cumulativeDwellResults[0].topicState.comprehensionScore
      },
      "12 -> 15 -> 18 second cumulative dwell should contribute one topic-state update"
    );

    const thresholdSignal = (dwellTimeMs, createdAt) => ({
      postId: productionThresholdPost.id,
      topicId: "Threshold",
      conceptIds: ["Threshold"],
      impression: true,
      dwellTimeMs,
      openedThread: false,
      liked: false,
      saved: false,
      askedQuestion: false,
      reviewed: false,
      skippedQuickly: false,
      createdAt
    });
    const thresholdNineSecondResult = await requestJsonFromServer(conceptKeyApiServer, "/api/signals", {
      method: "POST",
      body: {
        generatedAt: "2026-07-08T12:00:00.000Z",
        signal: thresholdSignal(9000, "2026-07-08T12:00:00.000Z")
      }
    });
    const snapshotAfterNineSeconds = await requestJsonFromServer(conceptKeyApiServer, "/api/snapshot");
    const thresholdTwelveSecondResult = await requestJsonFromServer(conceptKeyApiServer, "/api/signals", {
      method: "POST",
      body: {
        generatedAt: "2026-07-08T12:01:00.000Z",
        signal: thresholdSignal(12000, "2026-07-08T12:01:00.000Z")
      }
    });
    const snapshotAfterTwelveSeconds = await requestJsonFromServer(conceptKeyApiServer, "/api/snapshot");
    const budgetAfterNineSeconds = snapshotAfterNineSeconds.autoJobBudget.find(
      (record) => record.date === "2026-07-08"
    );
    const budgetAfterTwelveSeconds = snapshotAfterTwelveSeconds.autoJobBudget.find(
      (record) => record.date === "2026-07-08"
    );

    assert.ok(thresholdNineSecondResult.records.length > 0, "9s dwell should cross the production threshold once");
    assert.equal(
      thresholdTwelveSecondResult.records.length,
      0,
      "9s -> 12s dwell should update topic semantics without enqueueing production twice"
    );
    assert.equal(
      budgetAfterTwelveSeconds?.used,
      budgetAfterNineSeconds?.used,
      "9s -> 12s dwell should not consume another production budget slot"
    );
    assert.equal(
      snapshotAfterTwelveSeconds.curationJobs.length,
      snapshotAfterNineSeconds.curationJobs.length,
      "9s -> 12s dwell should not persist another production job"
    );
    const directTwelveSecondResult = await requestJsonFromServer(conceptKeyApiServer, "/api/signals", {
      method: "POST",
      body: {
        generatedAt: "2026-07-08T12:02:00.000Z",
        signal: {
          ...thresholdSignal(12000, "2026-07-08T12:02:00.000Z"),
          postId: directThresholdPost.id,
          topicId: "Threshold Direct",
          conceptIds: ["Threshold Direct"]
        }
      }
    });

    assert.deepEqual(
      {
        interestScore: thresholdTwelveSecondResult.topicState.interestScore,
        fatigueScore: thresholdTwelveSecondResult.topicState.fatigueScore,
        comprehensionScore: thresholdTwelveSecondResult.topicState.comprehensionScore
      },
      {
        interestScore: directTwelveSecondResult.topicState.interestScore,
        fatigueScore: directTwelveSecondResult.topicState.fatigueScore,
        comprehensionScore: directTwelveSecondResult.topicState.comprehensionScore
      },
      "9s -> 12s and a direct 12s report should converge to the same topic scores"
    );

    const likedThresholdSignal = (dwellTimeMs, createdAt) => ({
      ...thresholdSignal(dwellTimeMs, createdAt),
      postId: likedThresholdPost.id,
      topicId: "Threshold Liked",
      conceptIds: ["Threshold Liked"],
      liked: true
    });
    await requestJsonFromServer(conceptKeyApiServer, "/api/signals", {
      method: "POST",
      body: {
        generatedAt: "2026-07-08T12:03:00.000Z",
        signal: likedThresholdSignal(2000, "2026-07-08T12:03:00.000Z")
      }
    });
    const snapshotAfterLikedAction = await requestJsonFromServer(conceptKeyApiServer, "/api/snapshot");
    const likedThresholdResult = await requestJsonFromServer(conceptKeyApiServer, "/api/signals", {
      method: "POST",
      body: {
        generatedAt: "2026-07-08T12:04:00.000Z",
        signal: likedThresholdSignal(9000, "2026-07-08T12:04:00.000Z")
      }
    });
    const snapshotAfterLikedDwell = await requestJsonFromServer(conceptKeyApiServer, "/api/snapshot");

    assert.equal(
      likedThresholdResult.records.length,
      0,
      "an explicit action that already qualified production should not enqueue again when dwell reaches 9s"
    );
    assert.equal(
      snapshotAfterLikedDwell.curationJobs.length,
      snapshotAfterLikedAction.curationJobs.length,
      "liked@2s -> liked@9s should keep the production job count stable"
    );
    assert.equal(
      snapshotAfterLikedDwell.autoJobBudget.find((record) => record.date === "2026-07-08")?.used,
      snapshotAfterLikedAction.autoJobBudget.find((record) => record.date === "2026-07-08")?.used,
      "liked@2s -> liked@9s should not consume another production budget slot"
    );

    const openedStrengthSignal = (post, dwellTimeMs, createdAt) => ({
      postId: post.id,
      topicId: post.concepts[0],
      conceptIds: post.concepts,
      impression: true,
      dwellTimeMs,
      openedThread: true,
      liked: false,
      saved: false,
      askedQuestion: false,
      reviewed: false,
      skippedQuickly: false,
      createdAt
    });
    await requestJsonFromServer(conceptKeyApiServer, "/api/signals", {
      method: "POST",
      body: {
        generatedAt: "2026-07-08T12:05:00.000Z",
        signal: openedStrengthSignal(incrementalStrengthPost, 8000, "2026-07-08T12:05:00.000Z")
      }
    });
    const incrementalStrengthResult = await requestJsonFromServer(conceptKeyApiServer, "/api/signals", {
      method: "POST",
      body: {
        generatedAt: "2026-07-08T12:06:00.000Z",
        signal: openedStrengthSignal(incrementalStrengthPost, 9000, "2026-07-08T12:06:00.000Z")
      }
    });
    const directStrengthResult = await requestJsonFromServer(conceptKeyApiServer, "/api/signals", {
      method: "POST",
      body: {
        generatedAt: "2026-07-08T12:07:00.000Z",
        signal: openedStrengthSignal(directStrengthPost, 9000, "2026-07-08T12:07:00.000Z")
      }
    });

    assert.deepEqual(
      {
        interestScore: incrementalStrengthResult.topicState.interestScore,
        fatigueScore: incrementalStrengthResult.topicState.fatigueScore,
        comprehensionScore: incrementalStrengthResult.topicState.comprehensionScore
      },
      {
        interestScore: directStrengthResult.topicState.interestScore,
        fatigueScore: directStrengthResult.topicState.fatigueScore,
        comprehensionScore: directStrengthResult.topicState.comprehensionScore
      },
      "openedThread@8s -> @9s and a direct @9s report should converge across the strength threshold"
    );
  } finally {
    await closeServer(conceptKeyApiServer);
  }

  const legacyTopicStateDataPath = join(tempDir, "legacy-topic-state.json");
  const legacyTopicStateCurationPath = join(tempDir, "legacy-topic-state-curation.json");
  const legacyTopicStatePost = makeApiSmokePost({
    id: "legacy-topic-state-post",
    title: "Legacy topic state fixture",
    concepts: ["Legacy Topic"],
    createdAt: "2026-07-08T13:00:00.000Z"
  });
  const legacyTopicStateRecord = makeInteractionSignalRecord(legacyTopicStatePost, {
    createdAt: "2026-07-08T13:00:00.000Z"
  });
  legacyTopicStateRecord.signal = {
    ...legacyTopicStateRecord.signal,
    dwellTimeMs: 12000
  };

  await writeFile(
    legacyTopicStateDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-07-08T13:00:00.000Z",
      posts: [legacyTopicStatePost],
      interactionSignals: [legacyTopicStateRecord]
    })
  );

  const legacyTopicStateServer = createApiServer({
    dataPath: legacyTopicStateDataPath,
    curationDataPath: legacyTopicStateCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const legacyTopicStateSignalResult = await requestJsonFromServer(legacyTopicStateServer, "/api/signals", {
      method: "POST",
      body: {
        generatedAt: "2026-07-08T13:01:00.000Z",
        signal: {
          ...legacyTopicStateRecord.signal,
          dwellTimeMs: 15000,
          createdAt: "2026-07-08T13:01:00.000Z"
        }
      }
    });
    const legacyTopicStateSnapshot = await requestJsonFromServer(legacyTopicStateServer, "/api/snapshot");

    assert.ok(
      legacyTopicStateSignalResult.topicState,
      "a legacy snapshot with signals but no topic state should initialize topic feedback on the next resend"
    );
    assert.equal(
      legacyTopicStateSnapshot.topicStates.length,
      1,
      "legacy topic feedback initialization should persist exactly one topic state"
    );
    assert.equal(
      legacyTopicStateSignalResult.records.length,
      0,
      "legacy topic-state repair should not re-enqueue production for an already-qualified daily dwell"
    );
  } finally {
    await closeServer(legacyTopicStateServer);
  }

  const previousBoundaryTimeZone = process.env.AITIMELINE_TIMEZONE;
  process.env.AITIMELINE_TIMEZONE = "Asia/Shanghai";
  const timeZoneDeepReadServer = createApiServer({
    dataPath: join(tempDir, "timezone-deepread.json"),
    curationDataPath: join(tempDir, "timezone-deepread-curation.json"),
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const shanghaiDayOneDeepRead = await requestJsonFromServer(timeZoneDeepReadServer, "/api/deepread", {
      method: "POST",
      body: {
        topic: "Shanghai day one",
        userId: "timezone-user",
        now: "2026-07-10T15:30:00.000Z"
      }
    });
    const shanghaiDayTwoDeepRead = await requestJsonFromServer(timeZoneDeepReadServer, "/api/deepread", {
      method: "POST",
      body: {
        topic: "Shanghai day two",
        userId: "timezone-user",
        now: "2026-07-10T16:30:00.000Z"
      }
    });

    assert.equal(shanghaiDayOneDeepRead.queued, true, "the first local-day deep-read should queue");
    assert.equal(
      shanghaiDayTwoDeepRead.queued,
      true,
      "deep-read daily limits should reset at Asia/Shanghai midnight, not UTC midnight"
    );
  } finally {
    await closeServer(timeZoneDeepReadServer);

    if (previousBoundaryTimeZone === undefined) {
      delete process.env.AITIMELINE_TIMEZONE;
    } else {
      process.env.AITIMELINE_TIMEZONE = previousBoundaryTimeZone;
    }
  }

  const guaranteeDataPath = join(tempDir, "goal-production-guarantee.json");
  const guaranteeCurationPath = join(tempDir, "goal-production-guarantee-curation.json");
  const guaranteeNow = "2026-07-08T09:00:00.000Z";
  const guaranteePosts = [
    {
      ...makeApiSmokePost({
        id: "guarantee-goal-a-post",
        title: "Guarantee Goal A",
        concepts: ["Guarantee Goal A"],
        createdAt: guaranteeNow
      }),
      graphEdges: [
        {
          id: "guarantee-a-requires-gap",
          sourceConcept: "Guarantee Goal A",
          relation: "requires",
          targetConcept: "Guarantee Gap A",
          evidence: "Guarantee Goal A requires Guarantee Gap A.",
          weight: 0.9
        }
      ]
    },
    {
      ...makeApiSmokePost({
        id: "guarantee-goal-b-post",
        title: "Guarantee Goal B",
        concepts: ["Guarantee Goal B"],
        createdAt: guaranteeNow
      }),
      graphEdges: [
        {
          id: "guarantee-b-requires-gap",
          sourceConcept: "Guarantee Goal B",
          relation: "requires",
          targetConcept: "Guarantee Gap B",
          evidence: "Guarantee Goal B requires Guarantee Gap B.",
          weight: 0.9
        }
      ]
    }
  ];
  const previousBudgetForGuarantee = process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET;
  process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET = "2";

  await writeFile(
    guaranteeDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: guaranteeNow,
      posts: guaranteePosts,
      learningGoals: [
        {
          id: "guarantee-goal-a",
          concept: "Guarantee Goal A",
          createdAt: guaranteeNow,
          status: "active"
        },
        {
          id: "guarantee-goal-b",
          concept: "Guarantee Goal B",
          createdAt: guaranteeNow,
          status: "active"
        }
      ]
    })
  );

  const guaranteeServer = createApiServer({
    dataPath: guaranteeDataPath,
    curationDataPath: guaranteeCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const firstGuaranteeRun = await requestJsonFromServer(guaranteeServer, "/api/curation/run", {
      method: "POST",
      body: { now: guaranteeNow, kinds: ["concept_brief"] }
    });
    const firstGuaranteeSnapshot = await requestJsonFromServer(guaranteeServer, "/api/snapshot");
    const firstGuaranteeJobs = firstGuaranteeSnapshot.curationJobs.filter(
      (record) => record.job.kind === "concept_brief"
    );

    assert.equal(
      firstGuaranteeRun.goalProductionGuarantee.records.length,
      2,
      "daily production guarantee should reserve one production slot per active goal"
    );
    assert.deepEqual(
      firstGuaranteeRun.goalProductionGuarantee.records.map((record) => record.job.topicId).sort(),
      ["Guarantee Gap A", "Guarantee Gap B"],
      "daily production guarantee should use existing gap concept_brief demand"
    );
    assert.equal(
      firstGuaranteeSnapshot.autoJobBudget.find((record) => record.date === "2026-07-08")?.used,
      2,
      "daily production guarantee should consume slots inside the existing budget"
    );
    assert.equal(firstGuaranteeJobs.length, 2, "daily production guarantee should persist queued jobs");

    const repeatedGuaranteeRun = await requestJsonFromServer(guaranteeServer, "/api/curation/run", {
      method: "POST",
      body: { now: "2026-07-08T09:05:00.000Z", kinds: ["concept_brief"] }
    });
    const repeatedGuaranteeSnapshot = await requestJsonFromServer(guaranteeServer, "/api/snapshot");

    assert.equal(
      repeatedGuaranteeRun.goalProductionGuarantee.records.length,
      0,
      "daily production guarantee should be idempotent for a goal already produced today"
    );
    assert.equal(
      repeatedGuaranteeSnapshot.curationJobs.filter((record) => record.job.kind === "concept_brief").length,
      firstGuaranteeJobs.length,
      "daily production guarantee should not duplicate jobs on repeated runs"
    );
    assert.equal(
      repeatedGuaranteeSnapshot.autoJobBudget.find((record) => record.date === "2026-07-08")?.used,
      2,
      "daily production guarantee should not consume more budget on repeated runs"
    );
  } finally {
    await closeServer(guaranteeServer);
    if (previousBudgetForGuarantee === undefined) {
      delete process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET;
    } else {
      process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET = previousBudgetForGuarantee;
    }
  }

  const noDemandDataPath = join(tempDir, "goal-production-no-demand.json");
  const noDemandCurationPath = join(tempDir, "goal-production-no-demand-curation.json");
  const noDemandNow = "2026-07-08T11:00:00.000Z";

  await writeFile(
    noDemandDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: noDemandNow,
      posts: [
        makeApiSmokePost({
          id: "no-demand-goal-post",
          title: "No Demand Goal",
          concepts: ["No Demand Goal"],
          createdAt: noDemandNow
        })
      ],
      learningGoals: [
        {
          id: "no-demand-goal",
          concept: "No Demand Goal",
          createdAt: noDemandNow,
          status: "active"
        }
      ],
      userMemories: [
        {
          userId: "local-user",
          updatedAt: noDemandNow,
          memory: {
            profile: { interests: [], goals: [] },
            knowledge: { knownConcepts: ["No Demand Goal"], weakConcepts: [], savedConcepts: [] },
            interaction: { recentCardIds: [], recentQuestions: [] },
            agent: { topicAgents: [], preferredSourceTypes: [] }
          }
        }
      ]
    })
  );

  const noDemandServer = createApiServer({
    dataPath: noDemandDataPath,
    curationDataPath: noDemandCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const noDemandRun = await requestJsonFromServer(noDemandServer, "/api/curation/run", {
      method: "POST",
      body: { now: noDemandNow, kinds: ["concept_brief"] }
    });
    const noDemandSnapshot = await requestJsonFromServer(noDemandServer, "/api/snapshot");

    assert.equal(
      noDemandRun.goalProductionGuarantee.records.length,
      0,
      "daily production guarantee should not force production when a goal has no existing demand"
    );
    assert.equal(noDemandSnapshot.curationJobs.length, 0, "no-demand goals should not create curation jobs");
  } finally {
    await closeServer(noDemandServer);
  }

  const lowIntervalDataPath = join(tempDir, "mastery-low-interval.json");
  const lowIntervalCurationPath = join(tempDir, "mastery-low-interval-curation.json");
  const lowIntervalConcept = "Low Interval Mastery";
  const lowIntervalPosts = [
    makeApiSmokePost({
      id: "low-interval-a",
      title: "Low interval A",
      concepts: [lowIntervalConcept],
      createdAt: "2026-06-01T00:00:00.000Z"
    }),
    makeApiSmokePost({
      id: "low-interval-b",
      title: "Low interval B",
      concepts: [lowIntervalConcept],
      createdAt: "2026-06-01T00:00:00.000Z"
    })
  ];

  await writeFile(
    lowIntervalDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-06-10T00:00:00.000Z",
      posts: lowIntervalPosts,
      reviewStates: [
        { postId: lowIntervalPosts[0].id, intervalDays: 1, dueAt: "2026-06-10T00:00:00.000Z" },
        { postId: lowIntervalPosts[1].id, intervalDays: 7, dueAt: "2026-06-17T00:00:00.000Z" }
      ],
      topicStates: [
        {
          topicId: lowIntervalConcept,
          interestScore: 0.8,
          fatigueScore: 0.1,
          comprehensionScore: 0.78,
          updatedAt: "2026-06-10T00:00:00.000Z"
        }
      ]
    })
  );

  const lowIntervalServer = createApiServer({
    dataPath: lowIntervalDataPath,
    curationDataPath: lowIntervalCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const lowInterval = await requestJsonFromServer(
      lowIntervalServer,
      `/api/review/${encodeURIComponent(lowIntervalPosts[0].id)}/complete`,
      {
        method: "POST",
        body: { reviewedAt: "2026-06-10T00:00:00.000Z" }
      }
    );
    const lowIntervalSnapshot = await requestJsonFromServer(lowIntervalServer, "/api/snapshot");

    assert.deepEqual(lowInterval.masteryPromotions, [], "concepts should not promote when fewer than two cards meet interval rules");
    assert.equal(lowIntervalSnapshot.userMemories.length, 0, "low-interval negative case should not write memory");
  } finally {
    await closeServer(lowIntervalServer);
  }

  const lowScoreDataPath = join(tempDir, "mastery-low-score.json");
  const lowScoreCurationPath = join(tempDir, "mastery-low-score-curation.json");
  const lowScoreConcept = "Low Score Mastery";
  const lowScorePosts = [
    makeApiSmokePost({
      id: "low-score-a",
      title: "Low score A",
      concepts: [lowScoreConcept],
      createdAt: "2026-06-01T00:00:00.000Z"
    }),
    makeApiSmokePost({
      id: "low-score-b",
      title: "Low score B",
      concepts: [lowScoreConcept],
      createdAt: "2026-06-01T00:00:00.000Z"
    })
  ];

  await writeFile(
    lowScoreDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-06-10T00:00:00.000Z",
      posts: lowScorePosts,
      reviewStates: [
        { postId: lowScorePosts[0].id, intervalDays: 3, dueAt: "2026-06-10T00:00:00.000Z" },
        { postId: lowScorePosts[1].id, intervalDays: 7, dueAt: "2026-06-17T00:00:00.000Z" }
      ],
      topicStates: [
        {
          topicId: lowScoreConcept,
          interestScore: 0.8,
          fatigueScore: 0.1,
          comprehensionScore: 0.2,
          updatedAt: "2026-06-10T00:00:00.000Z"
        }
      ]
    })
  );

  const lowScoreServer = createApiServer({
    dataPath: lowScoreDataPath,
    curationDataPath: lowScoreCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const lowScore = await requestJsonFromServer(
      lowScoreServer,
      `/api/review/${encodeURIComponent(lowScorePosts[0].id)}/complete`,
      {
        method: "POST",
        body: { reviewedAt: "2026-06-10T00:00:00.000Z" }
      }
    );
    const lowScoreSnapshot = await requestJsonFromServer(lowScoreServer, "/api/snapshot");

    assert.deepEqual(lowScore.masteryPromotions, [], "concepts should not promote when topic comprehension is below threshold");
    assert.equal(lowScoreSnapshot.userMemories.length, 0, "low-score negative case should not write memory");
  } finally {
    await closeServer(lowScoreServer);
  }

  const legacyMasteryDataPath = join(tempDir, "mastery-legacy-compatible.json");
  const legacyMasteryCurationPath = join(tempDir, "mastery-legacy-compatible-curation.json");
  await writeFile(
    legacyMasteryDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-06-10T00:00:00.000Z"
    })
  );
  const legacyMasteryServer = createApiServer({
    dataPath: legacyMasteryDataPath,
    curationDataPath: legacyMasteryCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const legacyMasterySnapshot = await requestJsonFromServer(legacyMasteryServer, "/api/snapshot");

    assert.deepEqual(legacyMasterySnapshot.memoryEvents, [], "legacy snapshots without memoryEvents should load compatibly");
    assert.deepEqual(legacyMasterySnapshot.notifications, [], "legacy snapshots without notifications should load compatibly");
    assert.deepEqual(legacyMasterySnapshot.reviewStates, [], "legacy snapshots without reviewStates should load compatibly");
  } finally {
    await closeServer(legacyMasteryServer);
  }

  const subscriptionDataPath = join(tempDir, "subscriptions.json");
  const subscriptionCurationPath = join(tempDir, "subscriptions-curation-jobs.json");
  const subscriptionFeedUrl = "https://feeds.local/aitimeline-rss.xml";
  const subscriptionFeedFixture = `
    <rss version="2.0">
      <channel>
        <title>Subscription Smoke Feed</title>
        <link>https://feeds.local/</link>
        <item>
          <title>RAG retrieval architecture 4</title>
          <link>https://sources.local/rag-4</link>
          <pubDate>Tue, 07 Jul 2026 04:00:00 GMT</pubDate>
          <description>RAG retrieval architecture and evaluation notes.</description>
        </item>
        <item>
          <title>RAG retrieval architecture 3</title>
          <link>https://sources.local/rag-3</link>
          <pubDate>Tue, 07 Jul 2026 03:00:00 GMT</pubDate>
          <description>RAG retrieval quality improves with grounded evaluation.</description>
        </item>
        <item>
          <title>RAG retrieval architecture 2</title>
          <link>https://sources.local/rag-2</link>
          <pubDate>Tue, 07 Jul 2026 02:00:00 GMT</pubDate>
          <description>RAG system design and indexing trade-offs.</description>
        </item>
        <item>
          <title>RAG retrieval architecture 1</title>
          <link>https://sources.local/rag-1</link>
          <pubDate>Tue, 07 Jul 2026 01:00:00 GMT</pubDate>
          <description>RAG notes beyond the single-source import cap.</description>
        </item>
        <item>
          <title>Gardening calendar</title>
          <link>https://sources.local/garden</link>
          <pubDate>Tue, 07 Jul 2026 00:00:00 GMT</pubDate>
          <description>Tomato watering schedule with no relevant AI concepts.</description>
        </item>
      </channel>
    </rss>
  `;
  let subscriptionFeedFetchCount = 0;

  await writeFile(
    subscriptionDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-07-07T00:00:00.000Z",
      topicStates: [
        {
          topicId: "RAG",
          interestScore: 0.8,
          fatigueScore: 0.1,
          comprehensionScore: 0.7,
          updatedAt: "2026-07-07T00:00:00.000Z"
        }
      ],
      userSettings: { contentLanguage: "en" }
    })
  );

  const subscriptionServer = createApiServer({
    dataPath: subscriptionDataPath,
    curationDataPath: subscriptionCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider,
    feedFetch: async (input) => {
      const url = getFetchUrl(input);

      if (url !== subscriptionFeedUrl) {
        throw new Error(`Unexpected subscription fetch: ${url}`);
      }

      subscriptionFeedFetchCount += 1;
      return new Response(subscriptionFeedFixture, {
        status: 200,
        headers: { "content-type": "application/rss+xml" }
      });
    }
  });

  try {
    const legacySubscriptionSnapshot = await requestJsonFromServer(subscriptionServer, "/api/snapshot");

    assert.deepEqual(
      legacySubscriptionSnapshot.subscriptions,
      [],
      "legacy API snapshots without subscriptions should expose an empty subscriptions array"
    );

    const createdSubscription = await requestJsonFromServer(subscriptionServer, "/api/subscriptions", {
      method: "POST",
      body: { url: subscriptionFeedUrl }
    });
    const listedSubscriptions = await requestJsonFromServer(subscriptionServer, "/api/subscriptions");

    assert.equal(createdSubscription.record.title, "Subscription Smoke Feed", "subscription API should store feed title");
    assert.equal(createdSubscription.record.filterMode, "relevant", "subscription API should default to relevant mode");
    assert.equal(listedSubscriptions.records.length, 1, "subscription list API should expose the stored subscription");
    assert.equal(subscriptionFeedFetchCount, 1, "subscription create should validate by fetching the feed once");

    await requestJsonFromServer(subscriptionServer, "/api/curation/run", {
      method: "POST",
      body: {
        now: "2026-07-07T06:00:00.000Z",
        kinds: []
      }
    });

    const subscriptionSnapshot = await requestJsonFromServer(subscriptionServer, "/api/snapshot");
    const subscriptionCandidates = subscriptionSnapshot.sourceCandidates.filter(
      (record) => record.intakeKind === "subscription"
    );
    const subscriptionQueuedJobs = await requestJsonFromServer(subscriptionServer, "/api/curation/jobs?status=queued");
    const subscriptionImportJobs = subscriptionQueuedJobs.jobs.filter((record) => record.job.kind === "import_source");

    assert.equal(subscriptionFeedFetchCount, 2, "first curation run should poll the subscription feed");
    assert.equal(subscriptionCandidates.length, 5, "subscription poll should save all new feed entries as candidates");
    assert.equal(
      subscriptionCandidates.filter((record) => record.status === "queued").length,
      3,
      "relevant subscription polling should queue at most three entries per source"
    );
    assert.equal(
      subscriptionCandidates.filter((record) => record.status === "pending").length,
      2,
      "irrelevant and over-cap subscription entries should remain pending candidates"
    );
    assert.equal(subscriptionImportJobs.length, 3, "subscription import jobs should be enqueued through curation");

    await requestJsonFromServer(subscriptionServer, "/api/curation/run", {
      method: "POST",
      body: {
        now: "2026-07-07T06:00:00.000Z",
        kinds: []
      }
    });

    const subscriptionSnapshotAfterRepeat = await requestJsonFromServer(subscriptionServer, "/api/snapshot");
    const subscriptionQueuedJobsAfterRepeat = await requestJsonFromServer(
      subscriptionServer,
      "/api/curation/jobs?status=queued"
    );

    assert.equal(subscriptionFeedFetchCount, 2, "repeat subscription polling inside 6h should not fetch again");
    assert.equal(
      subscriptionSnapshotAfterRepeat.sourceCandidates.filter((record) => record.intakeKind === "subscription").length,
      5,
      "repeat subscription polling should not duplicate candidates"
    );
    assert.equal(
      subscriptionQueuedJobsAfterRepeat.jobs.filter((record) => record.job.kind === "import_source").length,
      3,
      "repeat subscription polling should not duplicate import jobs"
    );

    await requestJsonFromServer(subscriptionServer, "/api/curation/run", {
      method: "POST",
      body: {
        now: "2026-07-07T11:59:00.000Z",
        kinds: []
      }
    });

    assert.equal(subscriptionFeedFetchCount, 2, "lastPolledAt younger than 6h should skip subscription feed fetch");

    await requestJsonFromServer(subscriptionServer, "/api/curation/run", {
      method: "POST",
      body: {
        now: "2026-07-07T13:00:00.000Z",
        kinds: []
      }
    });

    const subscriptionSnapshotAfterRefetch = await requestJsonFromServer(subscriptionServer, "/api/snapshot");
    const subscriptionQueuedJobsAfterRefetch = await requestJsonFromServer(
      subscriptionServer,
      "/api/curation/jobs?status=queued"
    );

    assert.equal(subscriptionFeedFetchCount, 3, "polling after 6h should fetch the subscription feed again");
    assert.equal(
      subscriptionSnapshotAfterRefetch.sourceCandidates.filter((record) => record.intakeKind === "subscription").length,
      5,
      "re-fetching an unchanged feed should not duplicate candidates"
    );
    assert.equal(
      subscriptionQueuedJobsAfterRefetch.jobs.filter((record) => record.job.kind === "import_source").length,
      3,
      "re-fetching an unchanged feed should not duplicate import jobs"
    );
  } finally {
    await closeServer(subscriptionServer);
  }

  const previousSupplyBudget = process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET;
  process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET = "2";

  const supplyNow = "2026-07-08T12:00:00.000Z";
  const supplyDataPath = join(tempDir, "supply-drought.json");
  const supplyCurationPath = join(tempDir, "supply-drought-curation.json");
  const supplyOldPosts = [
    makeApiSmokePost({
      id: "supply-old-1",
      title: "Supply old card 1",
      concepts: ["Supply"],
      createdAt: "2026-07-04T00:00:00.000Z"
    }),
    makeApiSmokePost({
      id: "supply-old-2",
      title: "Supply old card 2",
      concepts: ["Supply"],
      createdAt: "2026-07-05T00:00:00.000Z"
    })
  ];
  const recentConnectionNote = {
    ...makeApiSmokePost({
      id: "supply-connection-note",
      title: "Supply recent connection note",
      concepts: ["Supply"],
      createdAt: "2026-07-08T11:00:00.000Z"
    }),
    kind: "connection_note"
  };
  const supplyCandidates = [
    makeSourceCandidateRecord({
      id: "supply-candidate-1",
      url: "https://network-fail.local/supply-1",
      score: 0.99
    }),
    makeSourceCandidateRecord({
      id: "supply-candidate-2",
      url: `${baseUrl}/fixtures/article-background?query=supply-2`,
      score: 0.94
    }),
    makeSourceCandidateRecord({
      id: "supply-candidate-3",
      url: `${baseUrl}/fixtures/article-background?query=supply-3`,
      score: 0.9
    }),
    makeSourceCandidateRecord({
      id: "supply-candidate-4",
      url: `${baseUrl}/fixtures/article-background?query=supply-4`,
      score: 0.86
    }),
    makeSourceCandidateRecord({
      id: "supply-candidate-5",
      url: `${baseUrl}/fixtures/article-background?query=supply-5`,
      score: 0.82
    }),
    makeSourceCandidateRecord({
      id: "supply-candidate-6",
      url: `${baseUrl}/fixtures/article-background?query=supply-6`,
      score: 0.78
    }),
    makeSourceCandidateRecord({
      id: "supply-candidate-unreachable",
      url: `${baseUrl}/fixtures/article-background?query=unreachable`,
      score: 1,
      status: "unreachable"
    }),
    makeSourceCandidateRecord({
      id: "supply-candidate-already-queued",
      url: `${baseUrl}/fixtures/article-background?query=already-queued`,
      score: 0.97,
      status: "queued"
    })
  ];
  const existingQueuedImportJob = makeQueuedImportJobRecord(
    supplyCandidates.find((record) => record.id === "supply-candidate-already-queued"),
    supplyNow
  );

  await writeFile(
    supplyDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: supplyNow,
      posts: [...supplyOldPosts, recentConnectionNote],
      sourceCandidates: supplyCandidates,
      subscriptions: [
        {
          id: "supply-subscription-1",
          kind: "rss",
          feedUrl: "https://feeds.local/supply-1.xml",
          title: "Supply subscription 1",
          filterMode: "relevant",
          createdAt: "2026-07-01T00:00:00.000Z",
          lastPolledAt: supplyNow
        },
        {
          id: "supply-subscription-2",
          kind: "rss",
          feedUrl: "https://feeds.local/supply-2.xml",
          title: "Supply subscription 2",
          filterMode: "relevant",
          createdAt: "2026-07-01T00:00:00.000Z",
          lastPolledAt: supplyNow
        }
      ],
      reviewStates: [
        {
          postId: "supply-old-1",
          intervalDays: 1,
          dueAt: "2026-07-07T00:00:00.000Z"
        }
      ]
    })
  );
  await writeFile(
    supplyCurationPath,
    JSON.stringify({
      version: 1,
      records: [existingQueuedImportJob]
    })
  );

  const supplyServer = createApiServer({
    dataPath: supplyDataPath,
    curationDataPath: supplyCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const droughtTimeline = await requestJsonFromServer(
      supplyServer,
      `/api/timeline?now=${encodeURIComponent(supplyNow)}`
    );

    assert.equal(droughtTimeline.supplyStatus.newCards48h, 0, "connection_note cards should not count as new supply");
    assert.equal(droughtTimeline.supplyStatus.pendingCandidates, 6, "supplyStatus should count pending candidates");
    assert.equal(droughtTimeline.supplyStatus.queuedCandidates, 1, "supplyStatus should count queued candidates");
    assert.equal(droughtTimeline.supplyStatus.activeSubscriptions, 2, "supplyStatus should count active subscriptions");
    assert.equal(droughtTimeline.supplyStatus.queuedImports, 1, "supplyStatus should count queued import_source jobs");
    assert.equal(droughtTimeline.supplyStatus.budgetRemaining, 2, "supplyStatus should expose today's budget remaining");
    assert.equal(droughtTimeline.supplyStatus.reviewDueCount, 1, "supplyStatus should count due review cards");
    assert.equal(droughtTimeline.supplyStatus.drought, true, "old-card supply should be in drought");

    const refillResult = await requestJsonFromServer(supplyServer, "/api/supply/refill", {
      method: "POST",
      body: { now: supplyNow }
    });
    const refillSnapshot = await requestJsonFromServer(supplyServer, "/api/snapshot");
    const refillJobs = await requestJsonFromServer(supplyServer, "/api/curation/jobs?status=queued");
    const refillImportJobs = refillJobs.jobs.filter((record) => record.job.kind === "import_source");

    assert.deepEqual(refillResult, { queued: 2, skipped: 3, budgetRemaining: 0 }, "refill should queue to the budget limit and skip the rest of top-5");
    assert.equal(
      refillSnapshot.autoJobBudget.find((record) => record.date === "2026-07-08")?.used,
      2,
      "refill should consume the daily auto-job budget"
    );
    assert.deepEqual(
      refillImportJobs.map((record) => record.job.sourceCandidate.id).sort(),
      ["supply-candidate-1", "supply-candidate-2", "supply-candidate-already-queued"].sort(),
      "refill should enqueue the highest-scored pending candidates and leave unreachable unselected"
    );
    assert.equal(
      refillSnapshot.sourceCandidates.find((record) => record.id === "supply-candidate-unreachable")?.status,
      "unreachable",
      "unreachable candidates should remain unreachable after refill"
    );

    const repeatRefill = await requestJsonFromServer(supplyServer, "/api/supply/refill", {
      method: "POST",
      body: { now: supplyNow }
    });
    const repeatRefillJobs = await requestJsonFromServer(supplyServer, "/api/curation/jobs?status=queued");

    assert.equal(repeatRefill.queued, 0, "repeat refill should not enqueue duplicates");
    assert.equal(repeatRefill.budgetRemaining, 0, "repeat refill should report exhausted budget");
    assert.equal(
      repeatRefillJobs.jobs.filter((record) => record.job.kind === "import_source").length,
      3,
      "repeat refill should keep the import queue idempotent"
    );

    // Frequency control must be exercised while the drought persists: run the
    // worker twice without executing imports (kinds excludes import_source), so
    // no new cards are produced between the two checks.
    await requestJsonFromServer(supplyServer, "/api/curation/run", {
      method: "POST",
      body: {
        now: supplyNow,
        kinds: ["generate_followup"]
      }
    });
    const stillDroughtTimeline = await requestJsonFromServer(
      supplyServer,
      `/api/timeline?now=${encodeURIComponent(supplyNow)}`
    );

    assert.equal(
      stillDroughtTimeline.supplyStatus.drought,
      true,
      "drought should still hold before the repeat notification check"
    );

    await requestJsonFromServer(supplyServer, "/api/curation/run", {
      method: "POST",
      body: {
        now: supplyNow,
        kinds: ["generate_followup"]
      }
    });
    const persistentDroughtNotifications = await requestJsonFromServer(supplyServer, "/api/notifications");

    assert.equal(
      persistentDroughtNotifications.records.filter((record) => record.kind === "supply_drought").length,
      1,
      "supply_drought notification should not repeat while the drought persists"
    );

    await requestJsonFromServer(supplyServer, "/api/curation/run", {
      method: "POST",
      body: {
        now: supplyNow,
        kinds: ["import_source"]
      }
    });
    const afterNetworkFailureSnapshot = await requestJsonFromServer(supplyServer, "/api/snapshot");
    const afterNetworkNotifications = await requestJsonFromServer(supplyServer, "/api/notifications");

    assert.equal(
      afterNetworkFailureSnapshot.sourceCandidates.find((record) => record.id === "supply-candidate-1")?.status,
      "unreachable",
      "network failed import_source jobs should mark their source candidate unreachable"
    );
    assert.equal(
      afterNetworkFailureSnapshot.sourceCandidates.find((record) => record.id === "supply-candidate-2")?.status,
      "imported",
      "successful refill imports should mark candidates imported"
    );
    assert.equal(
      afterNetworkNotifications.records.filter((record) => record.kind === "supply_drought").length,
      1,
      "worker drought check should create one supply_drought notification"
    );

    const recoveredAfterImportsTimeline = await requestJsonFromServer(
      supplyServer,
      `/api/timeline?now=${encodeURIComponent("2026-07-08T12:05:00.000Z")}`
    );

    assert.equal(
      recoveredAfterImportsTimeline.supplyStatus.drought,
      false,
      "successful imports should lift the drought"
    );

    await requestJsonFromServer(supplyServer, "/api/curation/run", {
      method: "POST",
      body: {
        now: "2026-07-08T12:05:00.000Z",
        kinds: ["import_source"]
      }
    });
    const repeatedNotifications = await requestJsonFromServer(supplyServer, "/api/notifications");

    assert.equal(
      repeatedNotifications.records.filter((record) => record.kind === "supply_drought").length,
      1,
      "no further supply_drought notification should be created once supply recovers"
    );
  } finally {
    await closeServer(supplyServer);
    if (previousSupplyBudget === undefined) {
      delete process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET;
    } else {
      process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET = previousSupplyBudget;
    }
  }

  // Supply budget ledger + candidate pool hygiene.
  // Every timestamp here is relative to the real clock: a scenario that pins
  // "today" to a literal date drifts the moment the suite runs on another day.
  const previousLedgerBudget = process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET;
  process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET = "2";

  const ledgerNowMs = Date.now();
  const ledgerNow = new Date(ledgerNowMs).toISOString();
  const ledgerRecentAt = new Date(ledgerNowMs - 60 * 60 * 1000).toISOString();
  const ledgerStaleAt = new Date(ledgerNowMs - 20 * 24 * 60 * 60 * 1000).toISOString();
  const ledgerDayKey = ledgerNow.slice(0, 10);
  const ledgerDataPath = join(tempDir, "supply-ledger.json");
  const ledgerCurationPath = join(tempDir, "supply-ledger-curation.json");
  const ledgerBadHostHistory = ["rejected_source", "rejected_source", "rejected_source", "unreachable", "unreachable"].map(
    (status, index) =>
      makeSourceCandidateRecord({
        id: `ledger-bad-host-${index + 1}`,
        url: `https://bad-domain.local/history-${index + 1}`,
        score: 0.4,
        status,
        createdAt: ledgerRecentAt
      })
  );
  const ledgerCandidates = [
    makeSourceCandidateRecord({
      id: "ledger-gate-reject",
      url: "https://gate-reject.local/grok-advanced-guide",
      score: 0.99,
      createdAt: ledgerRecentAt
    }),
    makeSourceCandidateRecord({
      id: "ledger-network-fail",
      url: "https://network-fail.local/ledger",
      score: 0.98,
      createdAt: ledgerRecentAt
    }),
    makeSourceCandidateRecord({
      id: "ledger-bad-host-pending",
      // Scored high enough that the score penalty alone would not keep it out:
      // only the hard exclusion can stop it winning the refunded slot.
      url: "https://bad-domain.local/next-candidate",
      score: 1,
      createdAt: ledgerRecentAt
    }),
    makeSourceCandidateRecord({
      id: "ledger-stale",
      url: `${baseUrl}/fixtures/article-background?query=ledger-stale`,
      score: 0.96,
      createdAt: ledgerStaleAt
    }),
    makeSourceCandidateRecord({
      id: "ledger-good",
      url: `${baseUrl}/fixtures/article-background?query=ledger-good`,
      score: 0.4,
      createdAt: ledgerRecentAt
    }),
    // Zombies: left in `queued` with no live job. One has a terminal job to map
    // back from, the other has nothing and must fall back to `pending`.
    makeSourceCandidateRecord({
      id: "ledger-zombie-terminal",
      url: "https://zombie-terminal.local/article",
      score: 0.1,
      status: "queued",
      createdAt: ledgerRecentAt
    }),
    makeSourceCandidateRecord({
      id: "ledger-zombie-orphan",
      url: "https://zombie-orphan.local/article",
      score: 0.1,
      status: "queued",
      createdAt: ledgerRecentAt
    }),
    ...ledgerBadHostHistory
  ];
  const ledgerZombieTerminalJob = {
    ...makeQueuedImportJobRecord(
      ledgerCandidates.find((record) => record.id === "ledger-zombie-terminal"),
      ledgerRecentAt
    ),
    status: "failed",
    attempts: 1,
    completedAt: ledgerRecentAt,
    materializedAt: ledgerRecentAt,
    lastError: "fetch failed"
  };

  await writeFile(
    ledgerDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: ledgerNow,
      posts: [],
      sourceCandidates: ledgerCandidates
    })
  );
  await writeFile(ledgerCurationPath, JSON.stringify({ version: 1, records: [ledgerZombieTerminalJob] }));

  const ledgerServer = createApiServer({
    dataPath: ledgerDataPath,
    curationDataPath: ledgerCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const firstLedgerRefill = await requestJsonFromServer(ledgerServer, "/api/supply/refill", {
      method: "POST",
      body: { now: ledgerNow }
    });
    const afterRefillSnapshot = await requestJsonFromServer(ledgerServer, "/api/snapshot");
    const findLedgerCandidate = (snapshot, id) => snapshot.sourceCandidates.find((record) => record.id === id);

    assert.equal(firstLedgerRefill.queued, 2, "refill should queue up to the daily budget");
    assert.equal(firstLedgerRefill.budgetRemaining, 0, "queueing two jobs should exhaust a budget of two");

    // (c) stale pending candidates are retired before selection.
    assert.equal(
      findLedgerCandidate(afterRefillSnapshot, "ledger-stale")?.status,
      "skipped",
      "pending candidates older than 14 days should be retired as skipped"
    );
    assert.equal(
      findLedgerCandidate(afterRefillSnapshot, "ledger-stale")?.rejectionReasons?.includes("stale_candidate"),
      true,
      "retired stale candidates should record the stale_candidate reason"
    );

    // Zombie repair: `queued` candidates with no live job get unstuck.
    assert.equal(
      findLedgerCandidate(afterRefillSnapshot, "ledger-zombie-terminal")?.status,
      "unreachable",
      "a zombie candidate with a terminal failed job should inherit that job's outcome"
    );
    assert.equal(
      findLedgerCandidate(afterRefillSnapshot, "ledger-zombie-orphan")?.status,
      "pending",
      "a zombie candidate with no job at all should fall back to pending"
    );

    // (d) a host with five recorded failures never wins a refill slot.
    const firstLedgerJobs = await requestJsonFromServer(ledgerServer, "/api/curation/jobs?status=queued");

    assert.deepEqual(
      firstLedgerJobs.jobs.map((record) => record.job.sourceCandidate.id).sort(),
      ["ledger-gate-reject", "ledger-network-fail"],
      "candidates on a five-times-failed host should be excluded from refill selection"
    );
    assert.equal(
      findLedgerCandidate(afterRefillSnapshot, "ledger-bad-host-pending")?.status,
      "pending",
      "excluded bad-host candidates should stay pending rather than being deleted"
    );

    await requestJsonFromServer(ledgerServer, "/api/curation/run", {
      method: "POST",
      body: { now: ledgerNow, kinds: ["import_source"] }
    });
    const afterRunSnapshot = await requestJsonFromServer(ledgerServer, "/api/snapshot");
    const ledgerBudget = afterRunSnapshot.autoJobBudget.find((record) => record.date === ledgerDayKey);

    // (a) gate rejection is counted and never refunded.
    assert.equal(ledgerBudget?.gateRejected, 1, "a gate-rejected import should count against the ledger");
    assert.equal(
      findLedgerCandidate(afterRunSnapshot, "ledger-gate-reject")?.status,
      "rejected_source",
      "gate-rejected candidates should be written back as rejected_source"
    );

    // (b) a fetch failure is counted and refunds its slot.
    assert.equal(ledgerBudget?.importFailed, 1, "a failed import should count against the ledger");
    assert.equal(ledgerBudget?.refunded, 1, "an unreachable source should refund its budget slot");
    assert.equal(ledgerBudget?.used, 1, "refunding a slot should lower today's used count");
    assert.equal(
      findLedgerCandidate(afterRunSnapshot, "ledger-network-fail")?.status,
      "unreachable",
      "fetch-failed candidates should be written back as unreachable"
    );

    const refundedLedgerRefill = await requestJsonFromServer(ledgerServer, "/api/supply/refill", {
      method: "POST",
      body: { now: ledgerNow }
    });
    const afterRefundRefillJobs = await requestJsonFromServer(ledgerServer, "/api/curation/jobs?status=queued");

    assert.equal(refundedLedgerRefill.queued, 1, "a refunded slot should let the same day queue another candidate");
    // The bad host outranks ledger-good on raw score, so this only holds if the
    // exclusion actually kept it out of selection.
    assert.equal(
      afterRefundRefillJobs.jobs.some((record) => record.job.sourceCandidate.id === "ledger-good"),
      true,
      "the refunded slot should go to the next eligible candidate"
    );
    assert.equal(
      afterRefundRefillJobs.jobs.every((record) => record.job.sourceCandidate.id !== "ledger-bad-host-pending"),
      true,
      "a five-times-failed host should never win a refill slot"
    );

    // (e) the timeline response reports the same ledger the snapshot stores.
    const ledgerTimeline = await requestJsonFromServer(
      ledgerServer,
      `/api/timeline?now=${encodeURIComponent(ledgerNow)}`
    );

    assert.deepEqual(
      ledgerTimeline.supplyStatus.todayLedger,
      { limit: 2, used: 2, produced: 0, gateRejected: 1, importFailed: 1, refunded: 1 },
      "supplyStatus.todayLedger should report today's settled budget"
    );
    assert.equal(
      ledgerTimeline.supplyStatus.budgetRemaining,
      0,
      "budgetRemaining should agree with the ledger's used count"
    );
  } finally {
    await closeServer(ledgerServer);
    if (previousLedgerBudget === undefined) {
      delete process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET;
    } else {
      process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET = previousLedgerBudget;
    }
  }

  const previousBacklogBudget = process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET;
  process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET = "3";

  const backlogDataPath = join(tempDir, "channel-backlog.json");
  const backlogCurationPath = join(tempDir, "channel-backlog-curation.json");
  const backlogChannelId = "UCbacklogSmokeChannel0001";
  const backlogFeedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${backlogChannelId}`;
  const backlogUploadsUrl = `https://www.youtube.com/playlist?list=UU${backlogChannelId.slice(2)}`;
  const backlogLegacyFeedUrl = "https://feeds.local/legacy-empty.xml";
  const backlogVideoTitles = {
    vidaaaaaaaa: "Backlog video one",
    vidbbbbbbbb: "Backlog video two",
    vidcccccccc: "Backlog video three",
    viddddddddd: "Backlog video four",
    videeeeeeee: "Backlog video five"
  };
  const backlogNoCaptionsVideoId = "vidaaaaaaaa";
  const backlogLockup = (videoId) => ({
    lockupViewModel: {
      contentId: videoId,
      contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
      metadata: { lockupMetadataViewModel: { title: { content: backlogVideoTitles[videoId] } } }
    }
  });
  const backlogContinuationItem = {
    continuationItemViewModel: {
      trigger: "CONTINUATION_TRIGGER_ON_ITEM_SHOWN",
      continuationCommand: {
        innertubeCommand: {
          continuationCommand: { token: "backlog-page-2", request: "CONTINUATION_REQUEST_TYPE_BROWSE" }
        }
      }
    }
  };
  const buildBacklogUploadsPage = (newestFirstVideoIds) =>
    `<html><body><script>var ytInitialData = ${JSON.stringify({
      contents: { items: [...newestFirstVideoIds.map(backlogLockup), backlogContinuationItem] }
    })};</script><script>ytcfg.set(${JSON.stringify({
      INNERTUBE_API_KEY: "backlog-innertube-key",
      INNERTUBE_CONTEXT_CLIENT_VERSION: "2.20260701"
    })});</script></body></html>`;
  const backlogUploadsPage2 = {
    onResponseReceivedActions: [
      {
        appendContinuationItemsAction: {
          continuationItems: [backlogLockup("vidbbbbbbbb"), backlogLockup("vidaaaaaaaa")]
        }
      }
    ]
  };
  const backlogTranscriptSentences = [
    "Options pricing starts from the idea that a fair price removes free lunches from the market.",
    "A binomial tree models the underlying asset as a sequence of up and down moves with known probabilities.",
    "With an up factor of 1.1 and a down factor of 0.9, a two step tree already brackets most near term outcomes.",
    "Risk neutral valuation lets us discount expected payoffs at the risk free rate instead of guessing risk premiums.",
    "If the risk free rate is 5 percent per year, a payoff of 100 dollars in one year is worth about 95.24 dollars today.",
    "The Black Scholes formula emerges as the continuous limit of the binomial model when steps shrink to zero.",
    "Because the hedge is rebalanced continuously, the model treats volatility as the only unknown input.",
    "Delta measures how the option price responds to small moves in the underlying asset price.",
    "An at the money call has a delta near 0.5, so hedging 100 calls takes about 50 shares of stock.",
    "Hedging a short option with delta shares turns the position into a locally risk free portfolio.",
    "Gamma tells you how fast delta drifts, which is why hedges decay and need rebalancing every day.",
    "Theta is the rent you pay for gamma, and for short dated options it can consume 2 or 3 percent of value per day.",
    "Implied volatility inverts the pricing formula to recover the volatility the market is quoting.",
    "When implied volatility sits at 20 percent but realized volatility prints 12 percent, option sellers collect the spread.",
    "Volatility smiles show that traders price tail risk beyond what a single lognormal model captures.",
    "A 25 delta put often trades 4 or 5 volatility points above the at the money strike because crashes cluster.",
    "The volatility surface therefore maps strike and expiry to a price of risk, not to a forecast of variance.",
    "Monte Carlo pricing simulates thousands of paths and averages the discounted payoff across each path.",
    "With 100000 simulated paths the standard error of a vanilla option price falls below one tenth of a percent.",
    "Variance reduction techniques such as antithetic paths cut the simulation budget roughly in half.",
    "American options add an early exercise decision, so the tree compares continuation value to intrinsic value at every node.",
    "Dividends lower the forward price, which is why deep in the money calls get exercised the day before the ex date.",
    "Put call parity ties calls, puts, and forwards together so any two of the three prices imply the third.",
    "If parity drifts by more than transaction costs, arbitrage desks trade the basis until the gap closes again."
  ];
  const backlogTimedText = JSON.stringify({
    events: backlogTranscriptSentences.map((sentence, index) => ({
      tStartMs: index * 6000,
      dDurationMs: 6000,
      segs: [{ utf8: sentence }]
    }))
  });
  const backlogFeedFixture = `
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>Backlog Smoke Channel</title>
      <link rel="alternate" href="https://www.youtube.com/channel/${backlogChannelId}"/>
      <entry>
        <title>Backlog video four</title>
        <link rel="alternate" href="https://www.youtube.com/watch?v=viddddddddd"/>
        <published>2026-07-10T00:00:00+00:00</published>
      </entry>
    </feed>
  `;
  const backlogEmptyLegacyFeed = `
    <rss version="2.0"><channel><title>Legacy feed</title><link>https://feeds.local/</link></channel></rss>
  `;
  let backlogFeedShouldFail = false;
  let backlogUploadsPage1 = buildBacklogUploadsPage(["viddddddddd", "vidcccccccc"]);
  let backlogUploadsFetchCount = 0;
  const backlogPlayerResponse = (videoId) => ({
    videoDetails: {
      videoId,
      title: backlogVideoTitles[videoId] ?? `Video ${videoId}`,
      author: "Backlog Smoke Channel",
      lengthSeconds: "480"
    },
    ...(videoId === backlogNoCaptionsVideoId
      ? {}
      : {
          captions: {
            playerCaptionsTracklistRenderer: {
              captionTracks: [
                { baseUrl: `https://captions.local/${videoId}`, languageCode: "en", kind: "standard" }
              ]
            }
          }
        })
  });
  const backlogFetch = async (input, init) => {
    const url = getFetchUrl(input);

    if (url === backlogFeedUrl) {
      if (backlogFeedShouldFail) {
        return new Response("boom", { status: 500 });
      }
      return new Response(backlogFeedFixture, { status: 200, headers: { "content-type": "application/atom+xml" } });
    }

    if (url === backlogLegacyFeedUrl) {
      return new Response(backlogEmptyLegacyFeed, { status: 200, headers: { "content-type": "application/rss+xml" } });
    }

    if (url === backlogUploadsUrl) {
      backlogUploadsFetchCount += 1;
      return new Response(backlogUploadsPage1, { status: 200, headers: { "content-type": "text/html" } });
    }

    if (url.startsWith("https://www.youtube.com/youtubei/v1/browse")) {
      return Response.json(backlogUploadsPage2);
    }

    if (url.startsWith("https://www.youtube.com/youtubei/v1/player")) {
      const requestBody = JSON.parse(init?.body ?? "{}");
      return Response.json(backlogPlayerResponse(requestBody.videoId));
    }

    if (url.startsWith("https://captions.local/")) {
      return new Response(backlogTimedText, { status: 200, headers: { "content-type": "application/json" } });
    }

    throw new Error(`Unexpected backlog fetch: ${url}`);
  };

  await writeFile(
    backlogDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-07-19T00:00:00.000Z",
      subscriptions: [
        {
          id: "legacy-rss-sub",
          kind: "rss",
          feedUrl: backlogLegacyFeedUrl,
          title: "Legacy feed",
          filterMode: "relevant",
          createdAt: "2026-07-01T00:00:00.000Z"
        }
      ],
      sourceCandidates: [
        {
          ...makeSourceCandidateRecord({
            id: "legacy-imported-candidate",
            url: "https://sources.local/legacy-imported",
            score: 0.9,
            status: "imported"
          }),
          importedAt: "2026-07-02T00:00:00.000Z"
        }
      ],
      topicStates: [
        {
          topicId: "Options Pricing",
          interestScore: 0.8,
          fatigueScore: 0.1,
          comprehensionScore: 0.7,
          updatedAt: "2026-07-19T00:00:00.000Z"
        },
        {
          topicId: "Volatility",
          interestScore: 0.75,
          fatigueScore: 0.1,
          comprehensionScore: 0.6,
          updatedAt: "2026-07-19T00:00:00.000Z"
        }
      ],
      userSettings: { contentLanguage: "en" }
    })
  );

  const backlogServer = createApiServer({
    dataPath: backlogDataPath,
    curationDataPath: backlogCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider,
    feedFetch: backlogFetch,
    guardedFetch: backlogFetch
  });

  try {
    const backlogT0 = "2026-07-20T02:00:00.000Z";
    const backlogT1 = "2026-07-21T02:00:00.000Z";
    const backlogT2 = "2026-07-21T09:30:00.000Z";

    const legacyListed = await requestJsonFromServer(backlogServer, "/api/subscriptions");

    assert.equal(
      legacyListed.records.some((record) => record.id === "legacy-rss-sub" && record.backlog === undefined),
      true,
      "pre-backlog subscriptions should load unchanged from legacy snapshots"
    );

    const legacyCandidates = await requestJsonFromServer(backlogServer, "/api/source-candidates");

    assert.equal(
      legacyCandidates.records.some((record) => record.id === "legacy-imported-candidate"),
      true,
      "legacy source candidates without backlog fields should survive normalization"
    );

    const createdChannel = await requestJsonFromServer(backlogServer, "/api/subscriptions", {
      method: "POST",
      body: { url: backlogFeedUrl }
    });
    const channelSubscriptionId = createdChannel.record.id;

    assert.equal(createdChannel.record.kind, "youtube_channel", "channel subscription should normalize to youtube_channel");

    const rejectedCatalog = await dispatchToServer(backlogServer, `${baseUrl}/api/subscriptions/legacy-rss-sub/backlog`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ now: backlogT0 })
    });

    assert.equal(rejectedCatalog.status, 400, "backlog cataloging should reject non-YouTube subscriptions");

    const cataloged = await requestJsonFromServer(backlogServer, `/api/subscriptions/${channelSubscriptionId}/backlog`, {
      method: "POST",
      body: { now: backlogT0 }
    });

    assert.equal(cataloged.created, 4, "backlog cataloging should store one candidate per uploads video");
    assert.equal(cataloged.videoCount, 4, "backlog cataloging should count the full uploads playlist");
    assert.equal(cataloged.record.backlog?.videoCount, 4, "subscription record should keep the backlog state");

    const catalogView = await requestJsonFromServer(backlogServer, `/api/subscriptions/${channelSubscriptionId}/backlog`);

    assert.deepEqual(
      catalogView.entries.map((entry) => entry.order),
      [0, 1, 2, 3],
      "backlog catalog should order videos oldest first"
    );
    assert.equal(catalogView.entries[0].title, "Backlog video one", "oldest uploads video should sit at order 0");
    assert.equal(catalogView.summary.pending, 4, "all cataloged videos should start pending");

    const recataloged = await requestJsonFromServer(backlogServer, `/api/subscriptions/${channelSubscriptionId}/backlog`, {
      method: "POST",
      body: { now: backlogT0 }
    });

    assert.equal(recataloged.created, 0, "re-cataloging the same channel should be idempotent");

    const refillDuringBacklog = await requestJsonFromServer(backlogServer, "/api/supply/refill", {
      method: "POST",
      body: { now: backlogT0 }
    });

    assert.equal(
      refillDuringBacklog.queued,
      0,
      "drought refill must not grab backlog candidates away from their paced digest lane"
    );

    const prioritizeTarget = catalogView.entries.find((entry) => entry.order === 2);

    await requestJsonFromServer(backlogServer, "/api/source-candidates/prioritize", {
      method: "POST",
      body: { id: prioritizeTarget.candidateId }
    });

    const firstDigest = await requestJsonFromServer(
      backlogServer,
      `/api/subscriptions/${channelSubscriptionId}/backlog/digest`,
      { method: "POST", body: { now: backlogT0 } }
    );

    assert.equal(firstDigest.queued, 3, "manual digest should queue up to the shared daily budget");
    assert.equal(firstDigest.skipped, 1, "manual digest should report budget-skipped backlog candidates");
    assert.equal(firstDigest.budgetRemaining, 0, "manual digest should consume the shared daily auto budget");

    const queuedBacklogJobs = (await requestJsonFromServer(backlogServer, "/api/curation/jobs?status=queued")).jobs
      .filter((record) => record.job.id.startsWith("subscription-backlog-import-"));

    assert.equal(queuedBacklogJobs.length, 3, "manual digest should enqueue import jobs for accepted candidates");
    assert.equal(
      queuedBacklogJobs[0].job.sourceCandidate.source.url.includes("vidcccccccc"),
      true,
      "prioritized backlog videos should enter the batch first"
    );

    const exhaustedDigest = await requestJsonFromServer(
      backlogServer,
      `/api/subscriptions/${channelSubscriptionId}/backlog/digest`,
      { method: "POST", body: { now: backlogT0 } }
    );

    assert.equal(exhaustedDigest.queued, 0, "digest with an exhausted budget should queue nothing");
    assert.equal(exhaustedDigest.skipped, 1, "digest with an exhausted budget should report the skipped candidate");

    await requestJsonFromServer(backlogServer, "/api/curation/run", {
      method: "POST",
      body: { now: "2026-07-20T02:05:00.000Z", kinds: ["import_source"], limit: 10 }
    });

    const afterFirstRun = await requestJsonFromServer(backlogServer, `/api/subscriptions/${channelSubscriptionId}/backlog`);

    assert.equal(afterFirstRun.summary.imported, 2, "captioned backlog videos should import into cards");
    assert.equal(afterFirstRun.summary.skipped, 1, "the captionless backlog video should be marked skipped");
    assert.equal(afterFirstRun.summary.pending, 1, "budget-deferred backlog video should stay pending");

    const skippedRecords = await requestJsonFromServer(backlogServer, "/api/source-candidates?status=skipped");

    assert.equal(skippedRecords.records.length, 1, "captionless import should downgrade the candidate to skipped");
    assert.equal(
      skippedRecords.records[0].rejectionReasons.includes("Source has no usable transcript."),
      true,
      "skipped candidates should carry the transcript-unavailable reason"
    );

    const backlogSnapshot = await requestJsonFromServer(backlogServer, "/api/snapshot");
    const backlogPosts = backlogSnapshot.posts.filter((post) =>
      post.sources?.some((source) => source.url?.includes("youtube.com/watch"))
    );

    assert.equal(backlogPosts.length > 0, true, "backlog imports should materialize timeline cards with YouTube sources");

    const nextDayDigest = await requestJsonFromServer(
      backlogServer,
      `/api/subscriptions/${channelSubscriptionId}/backlog/digest`,
      { method: "POST", body: { now: backlogT1 } }
    );

    assert.equal(nextDayDigest.queued, 1, "the next day should queue the remaining pending video only");

    await requestJsonFromServer(backlogServer, "/api/curation/run", {
      method: "POST",
      body: { now: "2026-07-21T02:05:00.000Z", kinds: ["import_source"], limit: 10 }
    });

    const afterSecondRun = await requestJsonFromServer(backlogServer, `/api/subscriptions/${channelSubscriptionId}/backlog`);

    assert.equal(afterSecondRun.summary.imported, 3, "the deferred backlog video should import on the next day");
    assert.equal(afterSecondRun.summary.pending, 0, "no backlog videos should stay pending once digested");
    assert.equal(afterSecondRun.summary.skipped, 1, "skipped videos must not be retried by later digests");

    backlogFeedShouldFail = true;
    backlogUploadsPage1 = buildBacklogUploadsPage(["videeeeeeee", "viddddddddd", "vidcccccccc"]);
    const uploadsFetchesBeforeFallback = backlogUploadsFetchCount;

    await requestJsonFromServer(backlogServer, "/api/curation/run", {
      method: "POST",
      body: { now: backlogT2, kinds: [] }
    });

    const fallbackSnapshot = await requestJsonFromServer(backlogServer, "/api/snapshot");
    const fallbackSubscription = fallbackSnapshot.subscriptions.find((record) => record.id === channelSubscriptionId);
    const fallbackCandidate = fallbackSnapshot.sourceCandidates.find((record) =>
      record.candidate.source.url.includes("videeeeeeee")
    );

    assert.equal(
      backlogUploadsFetchCount,
      uploadsFetchesBeforeFallback + 1,
      "a failing YouTube feed should fall back to the uploads playlist page"
    );
    assert.equal(fallbackSubscription.lastError, undefined, "a successful uploads fallback should clear lastError");
    assert.equal(fallbackSubscription.lastPolledAt, backlogT2, "the uploads fallback should still advance lastPolledAt");
    assert.equal(Boolean(fallbackCandidate), true, "new videos found through the uploads fallback should become candidates");
    assert.equal(fallbackCandidate.status, "pending", "fallback-discovered videos should wait as pending candidates");
  } finally {
    await closeServer(backlogServer);
    if (previousBacklogBudget === undefined) {
      delete process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET;
    } else {
      process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET = previousBacklogBudget;
    }
  }

  // Agent learning captures: conversation excerpts become self-grounded cards
  // (content-addressed, idempotent), URL captures join the candidate pool
  // without relevance filtering, while the shared daily budget and the source
  // quality gate still hold the line.
  const captureDataPath = join(tempDir, "agent-capture.json");
  const captureCurationPath = join(tempDir, "agent-capture-curation.json");
  const captureThinUrl = "https://capture-smoke.local/thin-article";
  const captureSecondUrl = "https://capture-smoke.local/thin-article-2";
  const captureFetch = async (input) => {
    const url = getFetchUrl(input);

    if (url.startsWith("https://capture-smoke.local/")) {
      return new Response(
        "<html><head><title>Thin capture fixture</title></head><body><p>Too thin to pass the quality gate.</p></body></html>",
        { status: 200, headers: { "content-type": "text/html" } }
      );
    }

    throw new Error(`Unexpected fetch during agent capture smoke: ${url}`);
  };
  const previousCaptureBudget = process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET;

  process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET = "1";

  const captureServer = createApiServer({
    dataPath: captureDataPath,
    curationDataPath: captureCurationPath,
    mediaRootDir,
    feedFetch: captureFetch,
    guardedFetch: captureFetch
  });

  try {
    const captureExcerpt = [
      "User asked: what do the option Greeks actually measure?",
      "Explanation: delta measures how much the option price moves per unit move in the underlying,",
      "gamma measures how fast delta itself changes, theta is the time decay of the option value,",
      "and vega measures sensitivity to implied volatility changes."
    ].join(" ");
    const captured = await requestJsonFromServer(captureServer, "/api/captures/conversation", {
      method: "POST",
      body: { topic: "Option Greeks", excerpt: captureExcerpt, agentName: "smoke-agent" }
    });

    assert.equal(captured.alreadyCaptured, false, "a fresh conversation capture should create a new card");
    assert.equal(captured.post.id.startsWith("conversation-"), true, "conversation captures should mint conversation ids");

    const captureSnapshot = await requestJsonFromServer(captureServer, "/api/snapshot");
    const conversationPost = captureSnapshot.posts.find((post) => post.id === captured.post.id);

    assert.equal(Boolean(conversationPost), true, "the conversation card should be persisted");
    assert.equal(conversationPost.sources[0].type, "conversation", "the card source should be a conversation source");
    assert.equal(conversationPost.sources[0].author, "smoke-agent", "the capturing agent should be recorded as author");
    assert.equal(conversationPost.citations.length, 1, "the conversation card should cite its own excerpt");
    assert.equal(
      captureSnapshot.sourceRegistries.some((record) => record.sourceId === conversationPost.sources[0].id),
      true,
      "the excerpt should be registered as a citable source"
    );

    const captureEvidence = await requestJsonFromServer(captureServer, `/api/evidence/${captured.post.id}`);

    assert.equal(
      captureEvidence.ledger.summary.citedChunks,
      1,
      "the evidence ledger should resolve the conversation excerpt chunk"
    );

    const recaptured = await requestJsonFromServer(captureServer, "/api/captures/conversation", {
      method: "POST",
      body: { topic: "Option Greeks", excerpt: captureExcerpt }
    });

    assert.equal(recaptured.alreadyCaptured, true, "re-capturing the same excerpt should be idempotent");
    assert.equal(recaptured.post.id, captured.post.id, "idempotent captures should return the original card");

    const postsAfterRecapture = (await requestJsonFromServer(captureServer, "/api/snapshot")).posts.length;

    assert.equal(postsAfterRecapture, captureSnapshot.posts.length, "idempotent captures must not add cards");

    const tooShortCapture = await dispatchToServer(captureServer, `${baseUrl}/api/captures/conversation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic: "Option Greeks", excerpt: "way too short" })
    });

    assert.equal(tooShortCapture.status, 400, "a too-short excerpt should be rejected");

    // Fresh library, no confirmed concepts: a subscription-lane candidate
    // would be relevance-filtered, but captures queue anyway (explicit intent).
    const firstSourceCapture = await requestJsonFromServer(captureServer, "/api/captures/source", {
      method: "POST",
      body: { url: captureThinUrl, topic: "Option Greeks", reason: "Cited in the conversation." }
    });

    assert.equal(firstSourceCapture.status, "queued", "the first URL capture should queue an import job");
    assert.equal(firstSourceCapture.queued, 1, "the first URL capture should consume budget");
    assert.equal(firstSourceCapture.record.intakeKind, "agent_capture", "URL captures should use the agent_capture intake");

    const duplicateSourceCapture = await requestJsonFromServer(captureServer, "/api/captures/source", {
      method: "POST",
      body: { url: captureThinUrl }
    });

    assert.equal(duplicateSourceCapture.alreadyKnown, true, "capturing a known URL should be idempotent");
    assert.equal(duplicateSourceCapture.queued, 0, "idempotent URL captures must not consume budget");

    const exhaustedSourceCapture = await requestJsonFromServer(captureServer, "/api/captures/source", {
      method: "POST",
      body: { url: captureSecondUrl, topic: "Option Greeks" }
    });

    assert.equal(exhaustedSourceCapture.status, "pending", "beyond the daily budget a capture should stay pending");
    assert.equal(exhaustedSourceCapture.queued, 0, "budget-exhausted captures must not queue jobs");

    // Captures above are stamped with the real current time, so the "next day"
    // run clock must stay relative: +24h is always after the capture moment and
    // always lands on the next UTC day, refreshing the daily budget.
    const captureRun = await requestJsonFromServer(captureServer, "/api/curation/run", {
      method: "POST",
      body: { now: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }
    });

    assert.equal(
      captureRun.agentCaptureQueue.queued >= 1,
      true,
      "the next curation run should drain pending agent captures within the fresh budget"
    );

    const drainedSnapshot = await requestJsonFromServer(captureServer, "/api/snapshot");
    const thinCandidate = drainedSnapshot.sourceCandidates.find(
      (record) => record.candidate.source.url === captureThinUrl
    );
    const drainedCandidate = drainedSnapshot.sourceCandidates.find(
      (record) => record.candidate.source.url === captureSecondUrl
    );

    assert.equal(
      thinCandidate.status,
      "rejected_source",
      "the source quality gate should still reject thin sources on the capture lane"
    );
    assert.equal(
      ["queued", "rejected_source"].includes(drainedCandidate.status),
      true,
      "the previously pending capture should have been queued (and possibly gate-rejected) by the run"
    );

    const captureContext = await requestJsonFromServer(captureServer, "/api/captures/context");

    assert.equal(captureContext.cardCount >= 1, true, "the learning context should count existing cards");
    assert.equal(
      captureContext.recentCards.some((cardInfo) => cardInfo.title === "Option Greeks"),
      true,
      "the learning context should list the captured card title"
    );
    assert.equal(
      captureContext.recentCards.every((cardInfo) => cardInfo.summary === undefined && cardInfo.body === undefined),
      true,
      "the learning context must not leak card bodies"
    );
  } finally {
    await closeServer(captureServer);
    if (previousCaptureBudget === undefined) {
      delete process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET;
    } else {
      process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET = previousCaptureBudget;
    }
  }

  // Browser-extension tweet clipping: a capture that carries its own body text
  // must become a card with zero fetches (x.com is login-walled, so the capture
  // is the only copy), the tweet URL must be registered as a citable source,
  // and pending browser captures must drain on a later run like agent captures.
  // The body is a realistic ~280-character tweet with no topic attached — the
  // payload the extension actually sends. Text this short fails the source
  // quality gate on every other lane (see backgroundCurationQueue.test.ts), so
  // importing it proves the browser_share exemption: the user's explicit save
  // is the quality signal.
  const clipDataPath = join(tempDir, "browser-clip.json");
  const clipCurationPath = join(tempDir, "browser-clip-curation.json");
  const clipTweetUrl = "https://x.com/karpathy/status/1900000000000000001";
  const clipSecondTweetUrl = "https://x.com/karpathy/status/1900000000000000002";
  const clipTweetText = [
    "hot take after a month of daily agent use: the bottleneck is not the model, it is what you feed it.",
    "give the agent the three files that matter and it one-shots the change;",
    "dump the whole repo in and it drowns. curation is the real skill now."
  ].join(" ");
  // 剪藏随文带图:唯一放行的 fetch 是首条推文的配图(服务端下载进媒体库);
  // 其余任何请求(含第二条故意给的坏图 URL)照旧必须失败,验证配图失败不阻塞出卡。
  const clipImageUrl = "https://pbs.twimg.com/media/clip-smoke-1?format=png&name=large";
  const clipBrokenImageUrl = "https://pbs.twimg.com/media/clip-smoke-broken?format=png&name=large";
  const clipImageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const clipFetch = async (input) => {
    if (getFetchUrl(input) === clipImageUrl) {
      return new Response(clipImageBytes, { status: 200, headers: { "content-type": "image/png" } });
    }

    throw new Error(`Browser clip smoke must not fetch anything, but requested: ${getFetchUrl(input)}`);
  };
  const previousClipBudget = process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET;

  process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET = "1";

  const clipServer = createApiServer({
    dataPath: clipDataPath,
    curationDataPath: clipCurationPath,
    mediaRootDir,
    feedFetch: clipFetch,
    guardedFetch: clipFetch
  });

  try {
    const clipCapture = await requestJsonFromServer(clipServer, "/api/captures/source", {
      method: "POST",
      body: {
        url: clipTweetUrl,
        capturedText: clipTweetText,
        title: "Andrej Karpathy (@karpathy) on X",
        author: "Andrej Karpathy",
        publishedAt: "2026-08-01T09:00:00.000Z",
        capturedMedia: [
          { kind: "image", url: clipImageUrl },
          { kind: "image", url: "javascript:alert(1)" }
        ],
        intakeKind: "browser_share",
        reason: "Saved from X via the AITimeline extension."
      }
    });

    assert.deepEqual(
      clipCapture.record.candidate.capturedMedia,
      [{ kind: "image", url: clipImageUrl }],
      "capture should keep the http image reference and drop the non-http one"
    );

    assert.equal(clipCapture.status, "queued", "a clipped tweet should queue an import job immediately");
    assert.equal(clipCapture.record.intakeKind, "browser_share", "extension captures should use the browser_share intake");
    assert.equal(
      clipCapture.record.candidate.source.author,
      "Andrej Karpathy",
      "the captured author should be registered on the source"
    );

    const clipSecondCapture = await requestJsonFromServer(clipServer, "/api/captures/source", {
      method: "POST",
      body: {
        url: clipSecondTweetUrl,
        // 与首条不同的正文:同文导入会按去重合并进已有卡(零新卡成功),
        // 这里要一张独立的卡来验证坏图不阻塞出卡。
        capturedText:
          "counterpoint from a week of pair-writing evals: grading rubrics beat vibes. " +
          "write the failure modes down first, score against them, and disagreements between " +
          "reviewers drop by half. the rubric is the product, the model is just the pen.",
        capturedMedia: [{ kind: "image", url: clipBrokenImageUrl }],
        intakeKind: "browser_share",
        reason: "Saved from X via the AITimeline extension."
      }
    });

    assert.equal(clipSecondCapture.status, "pending", "beyond the daily budget a clipped tweet should stay pending");

    await requestJsonFromServer(clipServer, "/api/curation/run", {
      method: "POST",
      body: { now: new Date().toISOString() }
    });

    const clipSnapshot = await requestJsonFromServer(clipServer, "/api/snapshot");
    const clipCandidate = clipSnapshot.sourceCandidates.find(
      (record) => record.candidate.source.url === clipTweetUrl
    );

    assert.equal(clipCandidate.status, "imported", "the clipped tweet should import without any fetch");

    const clipPost = clipSnapshot.posts.find((post) =>
      (post.sources ?? []).some((source) => source.url === clipTweetUrl)
    );

    assert.equal(Boolean(clipPost), true, "the clipped tweet should become a knowledge card");
    assert.equal(clipPost.citations.length >= 1, true, "the tweet card should carry citations");
    assert.equal(
      clipSnapshot.sourceRegistries.some((record) => record.sourceId === clipPost.sources[0].id),
      true,
      "the tweet should be registered as a citable source"
    );

    // capturedMedia 通路:配图下载成媒体库资产、进 registry、挂上首卡。
    const clipSourceId = clipPost.sources[0].id;
    const clipRegistry = clipSnapshot.sourceRegistries.find((record) => record.sourceId === clipSourceId);
    const clipImageAsset = (clipRegistry?.registry?.assets ?? []).find((asset) => asset.kind === "image");

    assert.equal(Boolean(clipImageAsset), true, "the clipped image should be registered as an image asset");
    assert.equal(
      clipImageAsset.url,
      `/media/${clipSourceId}/lead.png`,
      "the clipped image asset should point into the media library"
    );
    assert.deepEqual(
      clipPost.media,
      [{ assetId: clipImageAsset.id, caption: clipImageAsset.caption, origin: "article" }],
      "the clipped image should be attached to the card"
    );
    assert.deepEqual(
      new Uint8Array(await readFile(join(mediaRootDir, clipSourceId, "lead.png"))),
      clipImageBytes,
      "the clipped image bytes should be cached on disk"
    );

    const clipEvidence = await requestJsonFromServer(clipServer, `/api/evidence/${clipPost.id}`);

    assert.equal(
      clipEvidence.ledger.summary.citedChunks >= 1,
      true,
      "the evidence ledger should resolve the tweet's captured chunks"
    );

    const clipRecapture = await requestJsonFromServer(clipServer, "/api/captures/source", {
      method: "POST",
      body: { url: clipTweetUrl, capturedText: clipTweetText, intakeKind: "browser_share" }
    });

    assert.equal(clipRecapture.alreadyKnown, true, "re-clipping an imported tweet should be idempotent");
    assert.equal(clipRecapture.postId, clipPost.id, "re-clipping should point at the existing card");

    // Next day: the fresh budget must drain the pending browser_share capture
    // exactly like agent captures, and it must import from its captured text.
    await requestJsonFromServer(clipServer, "/api/curation/run", {
      method: "POST",
      body: { now: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }
    });

    const clipDrainedSnapshot = await requestJsonFromServer(clipServer, "/api/snapshot");
    const clipSecondCandidate = clipDrainedSnapshot.sourceCandidates.find(
      (record) => record.candidate.source.url === clipSecondTweetUrl
    );

    assert.equal(
      clipSecondCandidate.status,
      "imported",
      "the pending browser_share capture should drain and import on the next run"
    );

    // 坏图 URL(fetch 直接抛)不阻塞出卡:卡照常出,只是没配图。
    const clipSecondPost = clipDrainedSnapshot.posts.find((post) =>
      (post.sources ?? []).some((source) => source.url === clipSecondTweetUrl)
    );

    assert.equal(Boolean(clipSecondPost), true, "a failing clipped image must not block the card");
    assert.equal(clipSecondPost.media, undefined, "the card with a failing image should ship without media");
  } finally {
    await closeServer(clipServer);
    if (previousClipBudget === undefined) {
      delete process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET;
    } else {
      process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET = previousClipBudget;
    }
  }

  // YouTube answers the handle page and the RSS feed with transient 404s;
  // creating a subscription must survive one such blip per request instead of
  // failing the whole POST (observed live on 2026-07-14).
  const retryCreateDataPath = join(tempDir, "subscription-create-retry.json");
  const retryCreateCurationPath = join(tempDir, "subscription-create-retry-curation.json");
  const retryCreateChannelId = "UCretrySmokeChannel000001";
  const retryCreateHandleUrl = "https://www.youtube.com/@RetrySmoke";
  const retryCreateFeedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${retryCreateChannelId}`;
  const retryCreateFeedXml = `
    <feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015">
      <title>Retry Smoke Channel</title>
      <link rel="alternate" href="https://www.youtube.com/channel/${retryCreateChannelId}" />
    </feed>
  `;
  const retryCreateCounts = { handle: 0, feed: 0 };
  let retryCreateHandleUserAgent;
  const retryCreateFetch = async (input, init = {}) => {
    const url = getFetchUrl(input);

    if (url === retryCreateHandleUrl) {
      retryCreateCounts.handle += 1;
      retryCreateHandleUserAgent = new Headers(init.headers ?? {}).get("user-agent") ?? undefined;

      if (retryCreateCounts.handle === 1) {
        return new Response("not found", { status: 404 });
      }

      return new Response(`<html>"externalId":"${retryCreateChannelId}"</html>`, {
        status: 200,
        headers: { "content-type": "text/html" }
      });
    }

    if (url === retryCreateFeedUrl) {
      retryCreateCounts.feed += 1;

      if (retryCreateCounts.feed === 1) {
        return new Response("not found", { status: 404 });
      }

      return new Response(retryCreateFeedXml, { status: 200, headers: { "content-type": "application/xml" } });
    }

    throw new Error(`Unexpected fetch during subscription create retry smoke: ${url}`);
  };
  const retryCreateServer = createApiServer({
    dataPath: retryCreateDataPath,
    curationDataPath: retryCreateCurationPath,
    mediaRootDir,
    feedFetch: retryCreateFetch,
    guardedFetch: retryCreateFetch
  });

  try {
    const retryCreated = await requestJsonFromServer(retryCreateServer, "/api/subscriptions", {
      method: "POST",
      body: { url: retryCreateHandleUrl }
    });

    assert.equal(retryCreated.record.kind, "youtube_channel", "retried creation should resolve the channel kind");
    assert.equal(retryCreated.record.feedUrl, retryCreateFeedUrl, "retried creation should resolve the channel feed URL");
    assert.equal(retryCreated.record.title, "Retry Smoke Channel", "retried creation should read the feed title");
    assert.equal(retryCreateCounts.handle, 2, "a transient handle page 404 should be retried exactly once");
    assert.equal(retryCreateCounts.feed, 2, "a transient feed 404 should be retried exactly once");
    assert.match(
      retryCreateHandleUserAgent ?? "",
      /Mozilla/,
      "the handle page request should send a browser-like user-agent"
    );
  } finally {
    await closeServer(retryCreateServer);
  }

  const supplyRecoveredDataPath = join(tempDir, "supply-recovered.json");
  const supplyRecoveredCurationPath = join(tempDir, "supply-recovered-curation.json");
  await writeFile(
    supplyRecoveredDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: supplyNow,
      posts: [
        makeApiSmokePost({
          id: "supply-new-1",
          title: "Supply new card 1",
          concepts: ["Supply"],
          createdAt: "2026-07-08T10:00:00.000Z"
        }),
        makeApiSmokePost({
          id: "supply-new-2",
          title: "Supply new card 2",
          concepts: ["Supply"],
          createdAt: "2026-07-08T11:00:00.000Z"
        }),
        makeApiSmokePost({
          id: "supply-new-3",
          title: "Supply new card 3",
          concepts: ["Supply"],
          createdAt: "2026-07-08T12:00:00.000Z"
        })
      ]
    })
  );
  const supplyRecoveredServer = createApiServer({
    dataPath: supplyRecoveredDataPath,
    curationDataPath: supplyRecoveredCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const recoveredTimeline = await requestJsonFromServer(
      supplyRecoveredServer,
      `/api/timeline?now=${encodeURIComponent(supplyNow)}`
    );

    assert.equal(recoveredTimeline.supplyStatus.newCards48h, 3, "three recent cards should count as sufficient supply");
    assert.equal(recoveredTimeline.supplyStatus.drought, false, "supplyStatus drought should turn false at the threshold");
  } finally {
    await closeServer(supplyRecoveredServer);
  }

  const legacySupplyDataPath = join(tempDir, "supply-legacy-compatible.json");
  const legacySupplyCurationPath = join(tempDir, "supply-legacy-compatible-curation.json");
  const legacyCandidate = makeSourceCandidateRecord({
    id: "legacy-candidate-without-status",
    url: `${baseUrl}/fixtures/article-background?query=legacy-supply`,
    score: 0.6
  });
  const { status: _status, ...legacyCandidateWithoutStatus } = legacyCandidate;

  await writeFile(
    legacySupplyDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: supplyNow,
      sourceCandidates: [legacyCandidateWithoutStatus]
    })
  );
  const legacySupplyServer = createApiServer({
    dataPath: legacySupplyDataPath,
    curationDataPath: legacySupplyCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const legacySupplySnapshot = await requestJsonFromServer(legacySupplyServer, "/api/snapshot");

    assert.equal(
      legacySupplySnapshot.sourceCandidates[0]?.status,
      "pending",
      "legacy source candidates without unreachable-era status should normalize to pending"
    );
  } finally {
    await closeServer(legacySupplyServer);
  }

  const weeklyDataPath = join(tempDir, "weekly-recap.json");
  const weeklyCurationPath = join(tempDir, "weekly-recap-curation-jobs.json");
  const weeklyPosts = [
    makeApiSmokePost({
      id: "weekly-api-old",
      title: "Old RAG API card",
      concepts: ["RAG", "Evaluation"],
      createdAt: "2026-06-23T00:00:00.000Z"
    }),
    makeApiSmokePost({
      id: "weekly-api-new-rag",
      title: "New RAG API card",
      concepts: ["RAG", "Retrieval"],
      createdAt: "2026-06-29T00:00:00.000Z"
    }),
    makeApiSmokePost({
      id: "weekly-api-new-agent",
      title: "New Agent API card",
      concepts: ["Agent Memory"],
      createdAt: "2026-07-02T00:00:00.000Z"
    })
  ];

  await writeFile(
    weeklyDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-07-06T00:00:00.000Z",
      posts: weeklyPosts,
      reviewStates: [
        {
          postId: "weekly-api-old",
          intervalDays: 3,
          dueAt: "2026-07-03T00:00:00.000Z",
          lastReviewedAt: "2026-07-04T00:00:00.000Z"
        },
        {
          postId: "weekly-api-new-rag",
          intervalDays: 1,
          dueAt: "2026-07-05T00:00:00.000Z"
        }
      ],
      interactionSignals: [
        {
          id: "weekly-api-signal",
          signal: {
            postId: "weekly-api-new-agent",
            topicId: "Agent Memory",
            conceptIds: ["Agent Memory"],
            impression: true,
            dwellTimeMs: 9000,
            openedThread: true,
            liked: false,
            saved: true,
            askedQuestion: false,
            reviewed: true,
            skippedQuickly: false,
            createdAt: "2026-07-02T00:00:00.000Z"
          },
          feedback: {
            postId: "weekly-api-new-agent",
            topicId: "Agent Memory",
            conceptIds: ["Agent Memory"],
            signalStrength: 1,
            inferredState: "needs_review",
            nextAction: "schedule_review",
            reason: "Weekly recap smoke."
          },
          createdAt: "2026-07-02T00:00:00.000Z"
        }
      ],
      userSettings: { contentLanguage: "en" }
    })
  );

  const weeklyServer = createApiServer({
    dataPath: weeklyDataPath,
    curationDataPath: weeklyCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const weeklyFirst = await requestJsonFromServer(
      weeklyServer,
      `/api/recap/weekly?now=${encodeURIComponent("2026-07-07T12:00:00.000Z")}`
    );
    const weeklySecond = await requestJsonFromServer(
      weeklyServer,
      `/api/recap/weekly?now=${encodeURIComponent("2026-07-07T12:00:00.000Z")}`
    );
    const weeklySnapshot = await requestJsonFromServer(weeklyServer, "/api/snapshot");

    assert.ok(weeklyFirst.recap, "weekly recap API should lazily generate the latest completed week");
    assert.equal(weeklyFirst.recap.id, weeklySecond.recap.id, "weekly recap API should return the same id on repeat");
    assert.equal(weeklyFirst.recap.stats.newCardCount, 2, "weekly recap API should expose correct new-card count");
    assert.equal(weeklyFirst.recap.stats.newConceptCount, 2, "weekly recap API should expose correct new-concept count");
    assert.equal(weeklyFirst.recap.stats.reviewCompletedCount, 2, "weekly recap API should expose correct review completion count");
    assert.equal(weeklySnapshot.weeklyRecaps.length, 1, "weekly recap API should not duplicate same-week records");

    const weeklySeen = await requestJsonFromServer(weeklyServer, "/api/recap/weekly/seen", {
      method: "POST",
      body: {
        dismissed: true,
        id: weeklyFirst.recap.id,
        seenAt: "2026-07-07T12:30:00.000Z"
      }
    });

    assert.equal(weeklySeen.recap.seenAt, "2026-07-07T12:30:00.000Z", "weekly recap seen endpoint should mark seenAt");
    assert.equal(
      weeklySeen.recap.dismissedAt,
      "2026-07-07T12:30:00.000Z",
      "weekly recap seen endpoint should persist dismissals"
    );
  } finally {
    await closeServer(weeklyServer);
  }

  const shortWeeklyDataPath = join(tempDir, "weekly-recap-short.json");
  const shortWeeklyCurationPath = join(tempDir, "weekly-recap-short-curation-jobs.json");

  await writeFile(
    shortWeeklyDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-07-06T00:00:00.000Z",
      posts: [
        makeApiSmokePost({
          id: "weekly-api-too-new",
          title: "Too new API card",
          concepts: ["Fresh"],
          createdAt: "2026-07-02T00:00:00.000Z"
        })
      ]
    })
  );

  const shortWeeklyServer = createApiServer({
    dataPath: shortWeeklyDataPath,
    curationDataPath: shortWeeklyCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const shortWeekly = await requestJsonFromServer(
      shortWeeklyServer,
      `/api/recap/weekly?now=${encodeURIComponent("2026-07-07T12:00:00.000Z")}`
    );

    assert.equal(shortWeekly.recap, null, "weekly recap API should return null when data is younger than a full week");
  } finally {
    await closeServer(shortWeeklyServer);
  }

  const connectionDataPath = join(tempDir, "connection-note.json");
  const connectionCurationPath = join(tempDir, "connection-curation-jobs.json");
  const dismissedConnectionPost = makeApiSmokePost({
    id: "old-dismissed-kg-eval",
    title: "Old dismissed Knowledge Graph card",
    concepts: ["Knowledge Graph", "Evaluation"],
    createdAt: "2026-06-01T00:00:00.000Z"
  });
  const seededConnectionPosts = [
    dismissedConnectionPost,
    makeApiSmokePost({ id: "old-hub-rag", title: "Hub RAG", concepts: ["Memory", "RAG"] }),
    makeApiSmokePost({ id: "old-hub-rec", title: "Hub Recommendation", concepts: ["Memory", "Recommendation"] }),
    makeApiSmokePost({ id: "old-hub-notebook", title: "Hub NotebookLM", concepts: ["Memory", "NotebookLM"] }),
    makeApiSmokePost({ id: "old-hub-youtube", title: "Hub YouTube", concepts: ["Memory", "YouTube"] })
  ];

  await writeFile(
    connectionDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-07-06T00:00:00.000Z",
      posts: seededConnectionPosts,
      dismissedPosts: [
        {
          postId: dismissedConnectionPost.id,
          dismissedAt: "2026-07-05T00:00:00.000Z",
          mode: "soft"
        }
      ],
      userSettings: { contentLanguage: "zh" }
    })
  );

  const connectionServer = createApiServer({
    dataPath: connectionDataPath,
    curationDataPath: connectionCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const suggestion = await requestJsonFromServer(connectionServer, "/api/concept-merge-suggestions", {
      method: "POST",
      body: {
        left: "Speculative Decoding",
        right: "speculative decoding",
        leftExcerpt: "Speculative Decoding speeds inference.",
        rightExcerpt: "speculative decoding speeds inference too."
      }
    });

    assert.equal(suggestion.suggestion.status, "pending", "concept merge suggestion endpoint should persist pending suggestions");

    const resolvedSuggestion = await requestJsonFromServer(
      connectionServer,
      `/api/concept-merge-suggestions/${encodeURIComponent(suggestion.suggestion.id)}/resolve`,
      {
        method: "POST",
        body: {
          decision: "merge",
          canonical: "Speculative Decoding"
        }
      }
    );

    assert.equal(resolvedSuggestion.suggestion.status, "merged", "merge decision should resolve the suggestion");
    assert.ok(
      resolvedSuggestion.conceptAliases.some(
        (record) => record.canonical === "Speculative Decoding" && record.aliases.includes("speculative decoding")
      ),
      "merge decision should write a user concept alias"
    );

    const unmerged = await requestJsonFromServer(connectionServer, "/api/concept-aliases/unmerge", {
      method: "POST",
      body: {
        canonical: "Speculative Decoding",
        alias: "speculative decoding"
      }
    });

    assert.equal(unmerged.conceptAliases.length, 0, "unmerge endpoint should remove the selected alias");

    const separateSuggestion = await requestJsonFromServer(connectionServer, "/api/concept-merge-suggestions", {
      method: "POST",
      body: {
        left: "RAG",
        right: "RAG evaluation"
      }
    });
    await requestJsonFromServer(
      connectionServer,
      `/api/concept-merge-suggestions/${encodeURIComponent(separateSuggestion.suggestion.id)}/resolve`,
      {
        method: "POST",
        body: { decision: "separate" }
      }
    );
    const repeatedSeparate = await requestJsonFromServer(connectionServer, "/api/concept-merge-suggestions", {
      method: "POST",
      body: {
        left: "RAG",
        right: "RAG evaluation"
      }
    });

    assert.equal(repeatedSeparate.suggestion.status, "separate", "separated concept pairs should not be asked again");

    const connectionImport = await requestJsonFromServer(connectionServer, "/api/import/article", {
      method: "POST",
      body: {
        url: `${baseUrl}/fixtures/connection-note`,
        createdAt: "2026-07-06T00:00:00.000Z",
        recommendedBecause: "Smoke import should create a connection note."
      }
    });

    assert.equal(connectionImport.importRecord.status, "ready", "connection smoke import should be ready");

    const connectionSnapshot = await requestJsonFromServer(connectionServer, "/api/snapshot");
    const connectionNote = connectionSnapshot.posts.find((post) => post.kind === "connection_note");

    assert.ok(connectionNote, "import should persist a connection_note card into the snapshot");
    assert.equal(
      connectionNote.connectionNote.restorePostId,
      dismissedConnectionPost.id,
      "connection note should carry undismiss target data when waking a dismissed card"
    );
    assert.equal(
      connectionNote.connectionNote.oldPostId,
      dismissedConnectionPost.id,
      "connection note should reference the old card"
    );
    assert.ok(connectionNote.connectionNote.newPostId, "connection note should reference the new card");
    assert.ok(
      connectionNote.summary.includes(connectionNote.connectionNote.evidence),
      "connection note card text should include existing graph edge evidence"
    );
  } finally {
    await closeServer(connectionServer);
  }

  const mediaResponse = await fetch(`${baseUrl}/media/smoke-source/1.png`);
  const mediaBytes = new Uint8Array(await mediaResponse.arrayBuffer());

  assert.equal(mediaResponse.status, 200, "media route should serve files from the configured media root");
  assert.equal(mediaResponse.headers.get("content-type"), "image/png", "media route should set image content-type");
  assert.equal(mediaBytes.byteLength, 8, "media route should return the written image bytes");

  const traversalResponse = await fetch(`${baseUrl}/media/smoke-source/%2e%2e/aitimeline.json`);
  const plainTraversalResponse = await fetch(`${baseUrl}/media/../aitimeline.json`);

  assert.notEqual(traversalResponse.status, 200, "media route must reject path traversal");
  assert.notEqual(plainTraversalResponse.status, 200, "media route must not serve normalized traversal paths");

  const importResult = await requestJson("/api/import/article", {
    method: "POST",
    body: {
      url: `${baseUrl}/fixtures/article`,
      createdAt: "2026-06-10T00:00:00.000Z",
      recommendedBecause: "Smoke imported this article through the API."
    }
  });

  assert.equal(importResult.importRecord.status, "ready", "article API import should be ready");
  assert.ok(importResult.posts.length > 0, "article API import should create posts");
  assert.equal(importResult.releasePlan.immediatePostIds.length, importResult.posts.length, "new posts should be ready");

  const timeline = await requestJson("/api/timeline?now=2026-06-10T00:00:00.000Z");

  assert.ok(timeline.posts.length > 0, "timeline API should expose imported posts");
  assert.equal(typeof timeline.posts[0].score, "number", "timeline API should rank posts");
  assert.ok(Array.isArray(timeline.posts[0].scoreReasons), "timeline API should explain ranking scores");

  const firstPost = timeline.posts[0];
  const dismissedPost = timeline.posts.find((post) => post.id !== firstPost.id);

  assert.ok(dismissedPost, "article smoke should have a second post for dismiss lifecycle coverage");

  const boundarySnapshotBefore = await requestJson("/api/snapshot");
  const validBoundarySignal = {
    postId: firstPost.id,
    topicId: firstPost.concepts[0] ?? firstPost.id,
    conceptIds: firstPost.concepts,
    impression: true,
    dwellTimeMs: 1000,
    openedThread: false,
    liked: false,
    saved: false,
    askedQuestion: false,
    reviewed: false,
    skippedQuickly: false,
    createdAt: "2026-06-10T00:00:00.000Z"
  };
  const nullBodyResponse = await dispatchToServer(server, `${baseUrl}/api/signals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "null"
  });
  const nullBodyPayload = await nullBodyResponse.json();

  assert.equal(nullBodyResponse.status, 400, "JSON null request bodies should be rejected as client errors");
  assert.equal(nullBodyPayload.error, "Request body must be an object.", "null body errors should be stable");

  for (const invalidObjectBody of ["[]", "42", '"scalar"']) {
    const invalidObjectBodyResponse = await dispatchToServer(server, `${baseUrl}/api/signals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: invalidObjectBody
    });

    assert.equal(invalidObjectBodyResponse.status, 400, "array and scalar JSON bodies should return 400");
  }

  const invalidSignals = [
    { ...validBoundarySignal, createdAt: "not-a-date" },
    { ...validBoundarySignal, createdAt: "2026/06/10 00:00:00" },
    { ...validBoundarySignal, createdAt: "2026-02-30T00:00:00.000Z" },
    { ...validBoundarySignal, dwellTimeMs: -1 },
    { ...validBoundarySignal, dwellSeconds: -1 },
    { ...validBoundarySignal, liked: "yes" },
    { ...validBoundarySignal, conceptIds: "not-an-array" },
    { ...validBoundarySignal, postId: "missing-post" }
  ];

  for (const invalidSignal of invalidSignals) {
    const invalidSignalResponse = await dispatchToServer(server, `${baseUrl}/api/signals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signal: invalidSignal })
    });

    assert.equal(invalidSignalResponse.status, 400, "invalid signals should return 400");
  }

  const nonFiniteDwellResponse = await dispatchToServer(server, `${baseUrl}/api/signals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signal: validBoundarySignal }).replace('"dwellTimeMs":1000', '"dwellTimeMs":1e999')
  });

  assert.equal(nonFiniteDwellResponse.status, 400, "non-finite signal dwell should return 400");

  const declaredOversizeResponse = await dispatchToServer(server, `${baseUrl}/api/signals`, {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(1024 * 1024 + 1) },
    body: "{}"
  });
  const declaredOversizePayload = await declaredOversizeResponse.json();

  assert.equal(declaredOversizeResponse.status, 413, "oversized Content-Length should be rejected before reading");
  assert.equal(declaredOversizePayload.error, "Request body is too large.", "413 should return a JSON error");

  let streamedRequestDestroyed = false;
  let streamedRequestResumed = false;
  const streamedOversizeResponse = await dispatchToServer(server, `${baseUrl}/api/signals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: Buffer.alloc(1024 * 1024 + 1, 97),
    onDestroy: () => {
      streamedRequestDestroyed = true;
    },
    onResume: () => {
      streamedRequestResumed = true;
    }
  });
  const streamedOversizePayload = await streamedOversizeResponse.json();

  assert.equal(streamedOversizeResponse.status, 413, "chunked oversized bodies should return 413");
  assert.equal(streamedOversizePayload.error, "Request body is too large.", "streamed 413 should stay JSON");
  assert.equal(streamedRequestDestroyed, false, "streamed body rejection must not destroy the request before 413");
  assert.equal(streamedRequestResumed, true, "streamed body rejection should safely drain the remaining request");

  const boundarySnapshotAfter = await requestJson("/api/snapshot");
  const timelineAfterInvalidSignals = await dispatchToServer(
    server,
    `${baseUrl}/api/timeline?now=2026-06-10T00:00:00.000Z`
  );

  assert.equal(
    boundarySnapshotAfter.interactionSignals.length,
    boundarySnapshotBefore.interactionSignals.length,
    "invalid signals must not be persisted"
  );
  assert.equal(timelineAfterInvalidSignals.status, 200, "timeline should remain healthy after invalid signal attempts");

  const originalConsoleError = console.error;
  const loggedInternalErrors = [];
  let redactedErrorResponse;

  console.error = (...args) => loggedInternalErrors.push(args);

  try {
    redactedErrorResponse = await dispatchToServer(server, `${baseUrl}/api/import/article`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://network-fail.local/private-provider-path" })
    });
  } finally {
    console.error = originalConsoleError;
  }

  const redactedErrorPayload = await redactedErrorResponse.json();

  assert.equal(redactedErrorResponse.status, 500, "unexpected provider failures should return 500");
  assert.equal(redactedErrorPayload.error, "Internal server error.", "500 responses should use a stable message");
  assert.equal(
    JSON.stringify(redactedErrorPayload).includes("network-fail.local"),
    false,
    "500 responses must not expose internal upstream URLs"
  );
  assert.ok(loggedInternalErrors.length > 0, "unexpected error causes should be written to the server log");
  assert.ok(
    loggedInternalErrors.flat().some((value) => String(value).includes("fetch failed")),
    "server logs should retain the detailed unexpected error cause"
  );

  const legacyNotificationDataPath = join(tempDir, "legacy-error-notification.json");
  const legacyNotificationCurationPath = join(tempDir, "legacy-error-notification-curation.json");
  const legacyProviderDetail = "provider body from https://internal-provider.local/private/research";
  const legacyNotification = {
    id: "legacy-research-error-notification",
    kind: "research_progress",
    turnId: "legacy-research-turn",
    question: "What failed?",
    postIds: [],
    body: `Research finished, but every imported source failed or was blocked by validation: ${legacyProviderDetail}`,
    createdAt: "2026-06-10T04:00:00.000Z"
  };
  const legacyFallbackPost = {
    ...makeApiSmokePost({
      id: "legacy-fallback-provider-error",
      title: "Legacy fallback provider error",
      concepts: ["Fallback Redaction"],
      createdAt: legacyNotification.createdAt
    }),
    recommendedBecause:
      `No better source was found, so this same-source follow-up was generated after "Seed card". ${legacyProviderDetail}`
  };

  await writeFile(
    legacyNotificationDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: legacyNotification.createdAt,
      posts: [legacyFallbackPost],
      notifications: [legacyNotification]
    })
  );

  const legacyNotificationServer = createApiServer({
    dataPath: legacyNotificationDataPath,
    curationDataPath: legacyNotificationCurationPath,
    mediaRootDir
  });

  try {
    const listedLegacyNotifications = await requestJsonFromServer(legacyNotificationServer, "/api/notifications");
    const legacyNotificationSnapshot = await requestJsonFromServer(legacyNotificationServer, "/api/snapshot");
    const legacyFallbackTimeline = await requestJsonFromServer(
      legacyNotificationServer,
      "/api/timeline?now=2026-06-10T04:00:00.000Z"
    );
    const readLegacyNotification = await requestJsonFromServer(
      legacyNotificationServer,
      `/api/notifications/${encodeURIComponent(legacyNotification.id)}/read`,
      { method: "POST", body: {} }
    );
    const responseBodies = [
      listedLegacyNotifications.records[0]?.body,
      legacyNotificationSnapshot.notifications[0]?.body,
      readLegacyNotification.record?.body
    ];

    assert.deepEqual(
      responseBodies,
      Array(3).fill(
        "Research finished, but every imported source failed or was blocked by validation: Source import failed."
      ),
      "legacy research failure notifications should expose only a stable failure detail"
    );
    assert.equal(
      JSON.stringify({
        listedLegacyNotifications,
        legacyNotificationSnapshot,
        legacyFallbackTimeline,
        readLegacyNotification
      }).includes(legacyProviderDetail),
      false,
      "notification, snapshot, and timeline APIs must not expose historical provider error text"
    );
    assert.equal(
      legacyFallbackTimeline.posts[0]?.recommendedBecause,
      "[beyond source] No better source was found, so this same-source follow-up was generated.",
      "historical same-source fallback posts should expose only a stable reason"
    );
  } finally {
    await closeServer(legacyNotificationServer);
  }

  const fallbackLeakDataPath = join(tempDir, "deep-dive-fallback-redaction.json");
  const fallbackLeakCurationPath = join(tempDir, "deep-dive-fallback-redaction-curation.json");
  const fallbackLeakNow = "2026-06-10T05:00:00.000Z";
  const fallbackLeakProviderDetail = "https://internal-provider.local/private/deep-dive";
  const fallbackLeakOriginalPostIds = new Set(boundarySnapshotAfter.posts.map((post) => post.id));

  await writeFile(
    fallbackLeakDataPath,
    JSON.stringify({
      ...boundarySnapshotAfter,
      updatedAt: fallbackLeakNow,
      interactionSignals: [],
      topicStates: [],
      sourceCandidates: [],
      autoJobBudget: []
    })
  );
  await writeFile(fallbackLeakCurationPath, JSON.stringify({ version: 1, records: [] }));

  const previousModelName = process.env.AITIMELINE_MODEL_NAME;
  const previousOpenAiModel = process.env.OPENAI_MODEL;
  delete process.env.AITIMELINE_MODEL_NAME;
  delete process.env.OPENAI_MODEL;

  const fallbackLeakServer = createApiServer({
    dataPath: fallbackLeakDataPath,
    curationDataPath: fallbackLeakCurationPath,
    mediaRootDir,
    searchProvider: {
      id: "fallback-leak-smoke",
      async search() {
        return [
          {
            url: "https://fallback-leak.local/new-source",
            title: "Deep-dive source that fails upstream",
            snippet: "A source candidate whose provider failure must never reach a successful fallback card."
          }
        ];
      }
    }
  });

  if (previousModelName === undefined) {
    delete process.env.AITIMELINE_MODEL_NAME;
  } else {
    process.env.AITIMELINE_MODEL_NAME = previousModelName;
  }

  if (previousOpenAiModel === undefined) {
    delete process.env.OPENAI_MODEL;
  } else {
    process.env.OPENAI_MODEL = previousOpenAiModel;
  }

  try {
    const fallbackLeakSignal = await requestJsonFromServer(fallbackLeakServer, "/api/signals", {
      method: "POST",
      body: {
        generatedAt: fallbackLeakNow,
        signal: {
          postId: firstPost.id,
          topicId: firstPost.concepts[0] ?? firstPost.id,
          conceptIds: firstPost.concepts,
          impression: true,
          dwellTimeMs: 12000,
          openedThread: true,
          liked: true,
          saved: false,
          askedQuestion: false,
          reviewed: false,
          skippedQuickly: false,
          createdAt: fallbackLeakNow
        },
        topicState: {
          topicId: firstPost.concepts[0] ?? firstPost.id,
          interestScore: 0.9,
          fatigueScore: 0.1,
          comprehensionScore: 0.5
        },
        sourceCandidates: []
      }
    });
    const queuedDeepDiveJob = fallbackLeakSignal.plan.jobs.find(
      (job) => job.kind === "discover_sources" && job.nextAction === "continue_deeper"
    );

    assert.ok(queuedDeepDiveJob, "an interested signal should queue a deep-dive follow-up job");

    const previousFallbackConsoleError = console.error;
    const fallbackErrorLogs = [];
    let fallbackLeakBatch;

    console.error = (...args) => fallbackErrorLogs.push(args);

    try {
      fallbackLeakBatch = await requestJsonFromServer(fallbackLeakServer, "/api/curation/run", {
        method: "POST",
        body: { now: "2026-06-10T06:00:00.000Z", kinds: ["discover_sources"] }
      });
    } finally {
      console.error = previousFallbackConsoleError;
    }

    const fallbackLeakSnapshot = await requestJsonFromServer(fallbackLeakServer, "/api/snapshot");
    const safeFallbackPost = fallbackLeakSnapshot.posts.find(
      (post) =>
        !fallbackLeakOriginalPostIds.has(post.id) &&
        typeof post.recommendedBecause === "string" &&
        post.recommendedBecause === "[超出来源] 没找到可用的新来源,所以生成了同源跟进卡。"
    );
    const fallbackPayload = JSON.stringify({ fallbackLeakBatch, fallbackLeakSnapshot });

    assert.ok(safeFallbackPost, "a failed deep-dive source should produce a same-source fallback with a stable reason");
    assert.equal(
      fallbackPayload.includes(fallbackLeakProviderDetail),
      false,
      "successful fallback cards and job responses must not expose the original provider failure"
    );
    assert.ok(
      fallbackErrorLogs.flat().some((value) => String(value).includes(fallbackLeakProviderDetail)),
      "deep-dive fallback failures should retain the provider detail in server logs"
    );
  } finally {
    await closeServer(fallbackLeakServer);
  }

  const firstConcept = firstPost.concepts[0];
  const deepReadEnvDataPath = join(tempDir, "deepread-env-fallback.json");
  const deepReadEnvCurationPath = join(tempDir, "deepread-env-fallback-curation.json");
  const deepReadEnvKeys = [
    "AITIMELINE_MODEL_NAME",
    "AITIMELINE_MODEL_API_KEY",
    "AITIMELINE_MODEL_BASE_URL",
    "AITIMELINE_MODEL_DEEPREAD_NAME",
    "AITIMELINE_MODEL_DEEPREAD_API_KEY",
    "AITIMELINE_MODEL_DEEPREAD_BASE_URL"
  ];
  const previousDeepReadEnv = Object.fromEntries(deepReadEnvKeys.map((key) => [key, process.env[key]]));
  let deepReadEnvServer;

  observedDeepReadFallbackRequests.length = 0;

  try {
    process.env.AITIMELINE_MODEL_NAME = "fallback-deepread-model";
    process.env.AITIMELINE_MODEL_API_KEY = "fallback-deepread-key";
    process.env.AITIMELINE_MODEL_BASE_URL = "https://deepread-fallback.local/v1";
    process.env.AITIMELINE_MODEL_DEEPREAD_NAME = "deepread-override-model";
    process.env.AITIMELINE_MODEL_DEEPREAD_API_KEY = "";
    process.env.AITIMELINE_MODEL_DEEPREAD_BASE_URL = "   ";

    await writeFile(
      deepReadEnvDataPath,
      JSON.stringify({
        ...boundarySnapshotAfter,
        updatedAt: "2026-06-15T00:00:00.000Z",
        deepReadArticles: [],
        autoJobBudget: []
      })
    );

    deepReadEnvServer = createApiServer({
      dataPath: deepReadEnvDataPath,
      curationDataPath: deepReadEnvCurationPath,
      mediaRootDir,
      enableFixtures: true,
      searchProvider: fakeSearchProvider
    });
  } finally {
    for (const key of deepReadEnvKeys) {
      if (previousDeepReadEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousDeepReadEnv[key];
      }
    }
  }

  try {
    await requestJsonFromServer(deepReadEnvServer, "/api/deepread", {
      method: "POST",
      body: { topic: firstConcept, now: "2026-06-15T00:00:00.000Z" }
    });
    await requestJsonFromServer(deepReadEnvServer, "/api/curation/run", {
      method: "POST",
      body: {
        now: "2026-06-15T00:01:00.000Z",
        limit: 1,
        kinds: ["deep_read_article"]
      }
    });

    assert.ok(
      observedDeepReadFallbackRequests.length > 0,
      "blank deep-read base URL should fall back to the configured default model endpoint"
    );
    assert.equal(
      observedDeepReadFallbackRequests[0].headers.get("authorization"),
      "Bearer fallback-deepread-key",
      "blank deep-read API key should fall back to the configured default model key"
    );
  } finally {
    await closeServer(deepReadEnvServer);
  }

  const briefOpen = await requestJson(`/api/concepts/${encodeURIComponent(firstConcept)}/brief`, {
    method: "POST",
    body: {
      now: "2026-06-10T00:05:00.000Z"
    }
  });

  assert.equal(briefOpen.brief.concept, firstConcept, "concept brief endpoint should return a fallback brief for the concept");
  assert.equal(briefOpen.queued, true, "concept brief endpoint should lazily enqueue a metered job");
  assert.ok(
    briefOpen.brief.sentences.every((sentence) => sentence.cardId),
    "concept brief fallback should keep every sentence traceable to a card"
  );

  const briefBatch = await requestJson("/api/curation/run", {
    method: "POST",
    body: {
      now: "2026-06-10T00:06:00.000Z",
      limit: 2,
      kinds: ["concept_brief"]
    }
  });
  const briefSnapshot = await requestJson("/api/snapshot");
  const persistedBrief = briefSnapshot.conceptBriefs.find((brief) => brief.concept === firstConcept);

  assert.ok(
    briefBatch.records.some((record) => record.job.kind === "concept_brief"),
    "curation run should execute queued concept_brief jobs"
  );
  assert.ok(persistedBrief, "concept_brief curation job should persist the generated brief");
  assert.ok(
    persistedBrief.sentences.every((sentence) => persistedBrief.sourceCardIds.includes(sentence.cardId)),
    "persisted concept brief should keep every sentence sourced to a card id"
  );

  const deepReadQueue = await requestJson("/api/deepread", {
    method: "POST",
    body: {
      topic: firstConcept,
      userId: "local-user",
      now: "2026-06-10T00:07:00.000Z"
    }
  });

  assert.equal(deepReadQueue.queued, true, "deep-read endpoint should enqueue a background job");
  assert.ok(
    deepReadQueue.records.some((record) => record.job.kind === "deep_read_article"),
    "deep-read queue response should expose the deep_read_article job"
  );

  let deepReadFrequencyBlocked = false;

  try {
    await requestJson("/api/deepread", {
      method: "POST",
      body: {
        topic: firstConcept,
        userId: "local-user",
        now: "2026-06-10T00:08:00.000Z"
      }
    });
  } catch {
    deepReadFrequencyBlocked = true;
  }

  assert.equal(deepReadFrequencyBlocked, true, "deep-read endpoint should frequency-control to one article per day");

  const deepReadBatch = await requestJson("/api/curation/run", {
    method: "POST",
    body: {
      now: "2026-06-10T00:09:00.000Z",
      limit: 1,
      kinds: ["deep_read_article"]
    }
  });
  const generatedDeepRead = deepReadBatch.records.flatMap((record) => record.result?.deepReadArticle ?? [])[0];

  assert.ok(generatedDeepRead, "deep-read worker should generate a fallback article without model config");
  assert.equal(
    generatedDeepRead.runnerKind,
    "deterministic_fallback",
    "network-isolated deep-read worker should use deterministic fallback"
  );
  assert.ok(Array.isArray(generatedDeepRead.discardedMaterials), "deep-read article should include discard list field");
  assert.ok(Array.isArray(generatedDeepRead.deletedParagraphLog), "deep-read article should include deletion log field");

  const deepReadList = await requestJson("/api/deepread");
  const deepReadGet = await requestJson(`/api/deepread/${encodeURIComponent(generatedDeepRead.id)}`);

  assert.ok(
    deepReadList.records.some((record) => record.id === generatedDeepRead.id),
    "deep-read list endpoint should return generated articles"
  );
  assert.equal(deepReadGet.record.id, generatedDeepRead.id, "deep-read detail endpoint should return one article");

  const deepReadSnapshot = await requestJson("/api/snapshot");
  const deepReadRegistryCitations = new Set(
    deepReadSnapshot.sourceRegistries.flatMap((record) =>
      record.registry.chunks.map((chunk) => `${chunk.sourceId}|${chunk.id}`)
    )
  );
  const deepReadParagraphCitations = generatedDeepRead.chapters.flatMap((chapter) =>
    chapter.paragraphs.flatMap((paragraph) => paragraph.citations)
  );
  const deepReadFactParagraphs = generatedDeepRead.chapters.flatMap((chapter) =>
    chapter.paragraphs.filter((paragraph) => paragraph.kind === "fact")
  );

  assert.ok(deepReadFactParagraphs.length > 0, "deep-read smoke should generate at least one factual paragraph");
  assert.ok(
    deepReadFactParagraphs.every((paragraph) => paragraph.citations.length > 0),
    "every factual deep-read paragraph must carry at least one citation"
  );

  assert.ok(
    deepReadParagraphCitations.every((citation) =>
      deepReadRegistryCitations.has(`${citation.sourceId}|${citation.chunkId}`)
    ),
    "every deep-read paragraph citation should resolve to a source registry chunk"
  );

  const dismissResult = await requestJson(`/api/posts/${encodeURIComponent(dismissedPost.id)}/dismiss`, {
    method: "POST"
  });
  const repeatedDismissResult = await requestJson(`/api/posts/${encodeURIComponent(dismissedPost.id)}/dismiss`, {
    method: "POST"
  });

  assert.equal(dismissResult.dismissed, true, "dismiss endpoint should mark a post dismissed");
  assert.equal(repeatedDismissResult.dismissed, true, "dismiss endpoint should be idempotent");
  assert.equal(dismissResult.record.mode, "soft", "dismiss endpoint should default to soft mode");
  assert.equal(repeatedDismissResult.record.mode, "soft", "repeated default dismiss should remain soft");

  const dismissedList = await requestJson("/api/dismissed");
  const dismissedListRecord = dismissedList.records.find((record) => record.postId === dismissedPost.id);

  assert.ok(dismissedListRecord, "dismissed list endpoint should return the dismissed post");
  assert.equal(dismissedListRecord.title, dismissedPost.title, "dismissed list endpoint should include the post title");
  assert.equal(dismissedListRecord.mode, "soft", "dismissed list endpoint should expose soft mode");
  assert.equal(
    dismissedListRecord.dismissedAt,
    repeatedDismissResult.record.dismissedAt,
    "repeated dismiss should refresh the dismissedAt timestamp without duplicating the record"
  );

  const dismissedTimeline = await requestJson("/api/timeline?now=2026-06-10T00:00:00.000Z");

  assert.equal(
    dismissedTimeline.posts.some((post) => post.id === dismissedPost.id),
    false,
    "dismissed posts should leave the timeline"
  );

  const softReturnAt = new Date(repeatedDismissResult.record.dismissedAt);
  softReturnAt.setUTCDate(softReturnAt.getUTCDate() + 31);
  const expiredSoftTimeline = await requestJson(`/api/timeline?now=${encodeURIComponent(softReturnAt.toISOString())}`);

  assert.equal(
    expiredSoftTimeline.posts.some((post) => post.id === dismissedPost.id),
    true,
    "soft dismissed posts should return to the timeline after 30 days"
  );

  await closeServer(server);
  server = createApiServer({
    dataPath,
    curationDataPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  const reloadedResponse = await dispatchToServer(
    server,
    `${baseUrl}/api/timeline?now=2026-06-10T00:00:00.000Z`
  );
  const reloadedTimeline = await reloadedResponse.json();

  assert.equal(reloadedResponse.ok, true, "reloaded API server should read the persisted snapshot");
  assert.equal(
    reloadedTimeline.posts.some((post) => post.id === dismissedPost.id),
    false,
    "dismissed posts should stay dismissed after recreating the store"
  );

  const legacyDataPath = join(tempDir, "legacy-dismissed.json");
  const legacyCurationPath = join(tempDir, "legacy-curation-jobs.json");
  await writeFile(
    legacyDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-06-10T00:00:00.000Z",
      posts: [dismissedPost],
      dismissedPostIds: [dismissedPost.id],
      reviewStates: [
        {
          postId: dismissedPost.id,
          intervalDays: 1,
          dueAt: "2026-06-11T00:00:00.000Z"
        }
      ]
    })
  );
  const legacyServer = createApiServer({
    dataPath: legacyDataPath,
    curationDataPath: legacyCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const legacySnapshotResponse = await dispatchToServer(legacyServer, `${baseUrl}/api/snapshot`);
    const legacySnapshot = await legacySnapshotResponse.json();
    const legacyTimelineResponse = await dispatchToServer(
      legacyServer,
      `${baseUrl}/api/timeline?now=2026-06-11T00:00:00.000Z`
    );
    const legacyTimeline = await legacyTimelineResponse.json();
    const legacyDueResponse = await dispatchToServer(
      legacyServer,
      `${baseUrl}/api/review/due?now=2026-06-11T00:00:00.000Z`
    );
    const legacyDue = await legacyDueResponse.json();

    assert.equal(legacySnapshotResponse.ok, true, "legacy dismissed snapshot should load");
    assert.deepEqual(legacySnapshot.weeklyRecaps, [], "legacy snapshots without weeklyRecaps should load with an empty array");
    assert.deepEqual(
      legacySnapshot.dismissedPosts,
      [
        {
          postId: dismissedPost.id,
          dismissedAt: "2026-06-10T00:00:00.000Z",
          mode: "hard"
        }
      ],
      "legacy dismissedPostIds should migrate to hard dismissedPosts using snapshot updatedAt"
    );
    assert.equal(
      Object.hasOwn(legacySnapshot, "dismissedPostIds"),
      false,
      "loaded snapshots should expose only the new dismissedPosts field"
    );
    assert.equal(
      legacyTimeline.posts.some((post) => post.id === dismissedPost.id),
      false,
      "legacy hard dismissal should keep the post out of the timeline"
    );
    assert.equal(
      legacyDue.due.some((state) => state.postId === dismissedPost.id),
      false,
      "legacy hard dismissal should keep the post out of due review"
    );
  } finally {
    await closeServer(legacyServer);
  }

  const firstTopic = firstPost.concepts[0] ?? "agentic-learning";
  const reviewSeedSignal = {
    postId: firstPost.id,
    topicId: firstTopic,
    conceptIds: firstPost.concepts,
    impression: true,
    dwellTimeMs: 0,
    openedThread: false,
    liked: false,
    saved: true,
    askedQuestion: false,
    reviewed: false,
    skippedQuickly: false,
    createdAt: "2026-06-10T00:00:00.000Z"
  };
  const reviewSeedResult = await requestJson("/api/signals", {
    method: "POST",
    body: {
      generatedAt: "2026-06-10T00:00:00.000Z",
      signal: reviewSeedSignal
    }
  });

  assert.equal(reviewSeedResult.snapshotSummary.reviewStates, 1, "first save should create a review state");

  const reviewSnapshot = await requestJson("/api/snapshot");
  const firstReviewState = reviewSnapshot.reviewStates.find((state) => state.postId === firstPost.id);

  assert.ok(firstReviewState, "review state should persist in the snapshot");
  assert.equal(firstReviewState.intervalDays, 1, "initial review interval should be one day");
  assert.equal(firstReviewState.dueAt, "2026-06-11T00:00:00.000Z", "initial review dueAt should be signal time + one day");

  const softReviewDismiss = await requestJson(`/api/posts/${encodeURIComponent(firstPost.id)}/dismiss`, {
    method: "POST"
  });
  const softReviewTimeline = await requestJson("/api/timeline?now=2026-06-10T00:00:00.000Z");
  const softDueReview = await requestJson(`/api/review/due?now=${encodeURIComponent(firstReviewState.dueAt)}`);

  assert.equal(softReviewDismiss.record.mode, "soft", "review-card dismiss should default to soft");
  assert.equal(
    softReviewTimeline.posts.some((post) => post.id === firstPost.id),
    false,
    "soft dismissed review cards should leave the regular timeline"
  );
  assert.equal(
    softDueReview.due.some((state) => state.postId === firstPost.id),
    true,
    "soft dismissed review cards should stay in the due review endpoint"
  );

  const undismissResult = await requestJson(`/api/posts/${encodeURIComponent(firstPost.id)}/dismiss`, {
    method: "DELETE"
  });
  const restoredTimeline = await requestJson("/api/timeline?now=2026-06-10T00:00:00.000Z");

  assert.equal(undismissResult.restored, true, "undismiss endpoint should report a restored post");
  assert.equal(
    restoredTimeline.posts.some((post) => post.id === firstPost.id),
    true,
    "undismiss should restore the post to the timeline"
  );

  const hardReviewSeedSignal = {
    ...reviewSeedSignal,
    postId: dismissedPost.id,
    conceptIds: dismissedPost.concepts,
    createdAt: "2026-06-10T00:01:00.000Z"
  };
  const hardReviewSeedResult = await requestJson("/api/signals", {
    method: "POST",
    body: {
      generatedAt: "2026-06-10T00:01:00.000Z",
      signal: hardReviewSeedSignal
    }
  });
  const hardDismissResult = await requestJson(`/api/posts/${encodeURIComponent(dismissedPost.id)}/dismiss`, {
    method: "POST",
    body: { mode: "hard" }
  });
  const hardDueReview = await requestJson(`/api/review/due?now=${encodeURIComponent(firstReviewState.dueAt)}`);
  const hardDismissedList = await requestJson("/api/dismissed");
  const hardDismissedListRecord = hardDismissedList.records.find((record) => record.postId === dismissedPost.id);

  assert.equal(hardReviewSeedResult.snapshotSummary.reviewStates, 2, "second saved post should create a review state");
  assert.equal(hardDismissResult.record.mode, "hard", "dismiss endpoint should hard-dismiss when requested");
  assert.equal(
    hardDueReview.due.some((state) => state.postId === dismissedPost.id),
    false,
    "hard dismissed cards should be excluded from due review"
  );
  assert.equal(hardDismissedListRecord?.mode, "hard", "dismissed list should reflect hard dismissal upgrades");

  const topicSnapshotBeforePureExposure = await requestJson("/api/snapshot");
  const topicStateBeforePureExposure = topicSnapshotBeforePureExposure.topicStates.find((state) => state.topicId === firstTopic);
  const pureExposureResult = await requestJson("/api/signals", {
    method: "POST",
    body: {
      generatedAt: "2026-06-10T00:05:00.000Z",
      signal: {
        ...reviewSeedSignal,
        saved: false,
        createdAt: "2026-06-10T00:05:00.000Z"
      }
    }
  });
  const pureExposureSnapshot = await requestJson("/api/snapshot");
  const topicStateAfterPureExposure = pureExposureSnapshot.topicStates.find((state) => state.topicId === firstTopic);

  assert.equal(pureExposureResult.records.length, 0, "pure exposure should not enqueue curation records");
  assert.deepEqual(
    topicStateAfterPureExposure,
    topicStateBeforePureExposure,
    "pure exposure should not change topic state"
  );

  const previousBudget = process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET;
  const signalIdempotencyDataPath = join(tempDir, "signal-idempotency.json");
  const signalIdempotencyCurationPath = join(tempDir, "signal-idempotency-curation.json");
  const signalIdempotencyPost = makeApiSmokePost({
    id: "signal-idempotency-post",
    title: "Signal idempotency post",
    concepts: ["Idempotency Budget"],
    createdAt: "2026-06-09T00:00:00.000Z"
  });

  await writeFile(
    signalIdempotencyDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-06-09T00:00:00.000Z",
      posts: [signalIdempotencyPost]
    })
  );

  process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET = "20";
  const signalIdempotencyServer = createApiServer({
    dataPath: signalIdempotencyDataPath,
    curationDataPath: signalIdempotencyCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const idempotencyBudgetBody = {
      generatedAt: "2026-06-09T03:00:00.000Z",
      topicState: {
        topicId: "Idempotency Budget",
        interestScore: 0.8,
        fatigueScore: 0.1,
        comprehensionScore: 0.5
      },
      signal: {
        postId: signalIdempotencyPost.id,
        topicId: "Idempotency Budget",
        conceptIds: ["Idempotency Budget"],
        impression: true,
        dwellTimeMs: 18000,
        openedThread: true,
        liked: true,
        saved: false,
        askedQuestion: false,
        reviewed: false,
        skippedQuickly: false,
        createdAt: "2026-06-09T03:00:00.000Z"
      }
    };
    await requestJsonFromServer(signalIdempotencyServer, "/api/signals", {
      method: "POST",
      body: idempotencyBudgetBody
    });
    const firstIdempotencySnapshot = await requestJsonFromServer(signalIdempotencyServer, "/api/snapshot");
    const repeatedBudgetSignal = await requestJsonFromServer(signalIdempotencyServer, "/api/signals", {
      method: "POST",
      body: idempotencyBudgetBody
    });
    const repeatedIdempotencySnapshot = await requestJsonFromServer(signalIdempotencyServer, "/api/snapshot");
    const firstIdempotencyBudgetRecord = firstIdempotencySnapshot.autoJobBudget.find(
      (record) => record.date === "2026-06-09"
    );
    const repeatedIdempotencyBudgetRecord = repeatedIdempotencySnapshot.autoJobBudget.find(
      (record) => record.date === "2026-06-09"
    );

    assert.equal(repeatedBudgetSignal.idempotentReplay, true, "identical signal retries should short-circuit");
    assert.equal(firstIdempotencyBudgetRecord?.used, 1, "first signal should consume one automatic-job budget slot");
    assert.equal(repeatedIdempotencyBudgetRecord?.used, 1, "identical signal retry should not consume budget twice");
    assert.equal(
      repeatedIdempotencyBudgetRecord?.discarded,
      firstIdempotencyBudgetRecord?.discarded,
      "identical signal retry should not count as a discarded budget attempt"
    );
    assert.deepEqual(
      repeatedIdempotencySnapshot.topicStates,
      firstIdempotencySnapshot.topicStates,
      "identical signal retry should not update topic state twice"
    );
    assert.equal(
      repeatedIdempotencySnapshot.interactionSignals.length,
      firstIdempotencySnapshot.interactionSignals.length,
      "identical signal retry should keep one signal record"
    );
  } finally {
    await closeServer(signalIdempotencyServer);
  }

  const budgetDataPath = join(tempDir, "budget-aitimeline.json");
  const budgetCurationPath = join(tempDir, "budget-curation-jobs.json");
  const budgetPosts = [
    makeApiSmokePost({
      id: "budget-post",
      title: "Budget post",
      concepts: ["Budget Concept"],
      createdAt: "2026-06-10T00:00:00.000Z"
    }),
    makeApiSmokePost({
      id: "budget-post-2",
      title: "Budget post 2",
      concepts: ["Budget Concept"],
      createdAt: "2026-06-10T00:00:00.000Z"
    })
  ];

  await writeFile(
    budgetDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: "2026-06-10T00:00:00.000Z",
      posts: budgetPosts
    })
  );

  process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET = "1";
  const budgetServer = createApiServer({
    dataPath: budgetDataPath,
    curationDataPath: budgetCurationPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const budgetSignal = {
      postId: "budget-post",
      topicId: "Budget Concept",
      conceptIds: ["Budget Concept"],
      impression: true,
      dwellTimeMs: 18000,
      openedThread: true,
      liked: true,
      saved: false,
      askedQuestion: false,
      reviewed: false,
      skippedQuickly: false,
      createdAt: "2026-06-10T03:00:00.000Z"
    };
    const firstBudgetBody = {
      generatedAt: "2026-06-10T03:00:00.000Z",
      topicState: {
        topicId: "Budget Concept",
        interestScore: 0.8,
        fatigueScore: 0.1,
        comprehensionScore: 0.8
      },
      signal: budgetSignal
    };
    const firstBudgetSignal = await requestJsonFromServer(budgetServer, "/api/signals", {
      method: "POST",
      body: firstBudgetBody
    });
    const secondBudgetSignal = await requestJsonFromServer(budgetServer, "/api/signals", {
      method: "POST",
      body: {
        generatedAt: "2026-06-10T03:01:00.000Z",
        topicState: {
          topicId: "Budget Concept",
          interestScore: 0.82,
          fatigueScore: 0.1,
          comprehensionScore: 0.8
        },
        signal: {
          ...budgetSignal,
          postId: "budget-post-2",
          createdAt: "2026-06-10T03:01:00.000Z"
        }
      }
    });
    const budgetJobs = await requestJsonFromServer(budgetServer, "/api/curation/jobs?status=queued");
    const budgetSnapshot = await requestJsonFromServer(budgetServer, "/api/snapshot");
    const budgetRecord = budgetSnapshot.autoJobBudget.find((record) => record.date === "2026-06-10");

    assert.equal(firstBudgetSignal.records.length, 1, "budget limit should allow the first automatic job");
    assert.equal(secondBudgetSignal.records.length, 0, "budget limit should discard later automatic jobs");
    assert.equal(budgetJobs.jobs.length, 1, "discarded automatic jobs should not accumulate in the queue");
    assert.equal(budgetRecord?.used, 1, "budget snapshot should count the accepted automatic job");
    assert.ok((budgetRecord?.discarded ?? 0) >= 1, "budget snapshot should count discarded automatic jobs");
  } finally {
    if (previousBudget === undefined) {
      delete process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET;
    } else {
      process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET = previousBudget;
    }

    await closeServer(budgetServer);
  }

  const dueReview = await requestJson(`/api/review/due?now=${encodeURIComponent(firstReviewState.dueAt)}`);

  assert.deepEqual(
    dueReview.due.map((state) => state.postId),
    [firstPost.id],
    "due review endpoint should return due review states sorted by dueAt"
  );

  const dueTimeline = await requestJson(`/api/timeline?now=${encodeURIComponent(firstReviewState.dueAt)}`);
  const dueTimelinePost = dueTimeline.posts.find((post) => post.id === firstPost.id);

  assert.ok(dueTimelinePost, "due review post should appear in the timeline");
  assert.equal(dueTimelinePost.reviewDueAt, firstReviewState.dueAt, "due review timeline post should expose reviewDueAt");
  assert.equal(dueTimelinePost.recommendationIntent, "review", "due review timeline post should use review intent");


  const evidenceResult = await requestJson(`/api/evidence/${encodeURIComponent(firstPost.id)}`);

  assert.equal(evidenceResult.ledger.postId, firstPost.id, "evidence API should return the requested post ledger");
  assert.ok(evidenceResult.ledger.summary.totalClaims > 0, "evidence API should expose grounded claims");
  assert.ok(evidenceResult.ledger.claims[0].evidence.length > 0, "evidence API should resolve source chunks");

  const askResult = await requestJson("/api/ask", {
    method: "POST",
    body: { postId: importResult.posts[0].id, question: "What is the main point of this source?" }
  });

  // No model env in the smoke run, so /api/ask uses the deterministic grounded answer.
  assert.equal(askResult.runnerKind, "deterministic", "ask API should fall back to the deterministic answer without a model");
  assert.ok(typeof askResult.answer === "string" && askResult.answer.length > 0, "ask API should return an answer");
  assert.ok(askResult.citations.length > 0, "ask API should resolve grounded citations from the source registry");
  assert.equal(askResult.grounded, true, "ask API answer should be grounded in source chunks");

  const memoryResult = await requestJson("/api/memory", {
    method: "POST",
    body: {
      userId: "smoke-user",
      edits: [
        { kind: "add", field: "profile.interests", value: "AI Agents" },
        { kind: "add", field: "knowledge.savedConcepts", value: firstTopic },
        { kind: "set", field: "profile.explanationStyle", value: "example-first" }
      ]
    }
  });

  assert.deepEqual(memoryResult.memory.profile.interests, ["AI Agents"], "memory API should add interests");
  assert.equal(memoryResult.memory.profile.explanationStyle, "example-first", "memory API should set style");

  const memorySnapshotBeforeNoop = await requestJson("/api/snapshot");
  const ignoredMemoryReplacement = await requestJson("/api/memory", {
    method: "POST",
    body: {
      userId: "smoke-user",
      memory: {
        profile: { interests: ["Injected replacement"], goals: [] },
        knowledge: { knownConcepts: ["Injected mastery"], weakConcepts: [], savedConcepts: [] },
        interaction: { recentCardIds: [], recentQuestions: [] },
        agent: { topicAgents: [], preferredSourceTypes: [] }
      },
      edits: []
    }
  });
  const memorySnapshotAfterNoop = await requestJson("/api/snapshot");

  assert.deepEqual(
    ignoredMemoryReplacement.memory,
    memoryResult.memory,
    "memory API should ignore a request-body full-memory replacement"
  );
  assert.deepEqual(ignoredMemoryReplacement.events, [], "empty memory edits should be a no-op");
  assert.equal(
    memorySnapshotAfterNoop.updatedAt,
    memorySnapshotBeforeNoop.updatedAt,
    "empty memory edits should not write a new snapshot"
  );
  assert.equal(
    memorySnapshotAfterNoop.memoryEvents.length,
    memorySnapshotBeforeNoop.memoryEvents.length,
    "empty memory edits should not create audit events"
  );

  const editedFromPersistedMemory = await requestJson("/api/memory", {
    method: "POST",
    body: {
      userId: "smoke-user",
      memory: {
        profile: { interests: ["Injected replacement"], goals: [] },
        knowledge: { knownConcepts: [], weakConcepts: [], savedConcepts: [] },
        interaction: { recentCardIds: [], recentQuestions: [] },
        agent: { topicAgents: [], preferredSourceTypes: [] }
      },
      edits: [{ kind: "add", field: "profile.interests", value: "Persisted baseline" }]
    }
  });

  assert.deepEqual(
    editedFromPersistedMemory.memory.profile.interests,
    ["AI Agents", "Persisted baseline"],
    "memory edits should apply to persisted currentMemory rather than body.memory"
  );

  const candidateSnapshotBeforeUnsupported = await requestJson("/api/snapshot");
  const unsupportedCandidateResponse = await dispatchToServer(server, `${baseUrl}/api/source-candidates`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: "https://github.com/example/unsupported-candidate",
      title: "Unsupported repository candidate"
    })
  });
  const unsupportedCandidatePayload = await unsupportedCandidateResponse.json();
  const candidateSnapshotAfterUnsupported = await requestJson("/api/snapshot");

  assert.equal(unsupportedCandidateResponse.status, 400, "inferred unsupported candidate types should return 400");
  assert.match(
    unsupportedCandidatePayload.error,
    /Supported types: article, blog, news, youtube/,
    "unsupported candidate errors should explain the worker-supported types"
  );
  assert.equal(
    candidateSnapshotAfterUnsupported.sourceCandidates.length,
    candidateSnapshotBeforeUnsupported.sourceCandidates.length,
    "unsupported candidates must not be persisted"
  );

  const selfQueuedCandidateResponse = await dispatchToServer(server, `${baseUrl}/api/source-candidates`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: `${baseUrl}/fixtures/article-background?query=self-queued`,
      title: "Self queued candidate",
      status: "queued"
    })
  });
  const candidateSnapshotAfterSelfQueued = await requestJson("/api/snapshot");

  assert.equal(selfQueuedCandidateResponse.status, 400, "candidate intake must not accept a client-supplied queued state");
  assert.equal(
    candidateSnapshotAfterSelfQueued.sourceCandidates.length,
    candidateSnapshotBeforeUnsupported.sourceCandidates.length,
    "a candidate without a matching job must not become permanently queued"
  );

  const candidateResult = await requestJson("/api/source-candidates", {
    method: "POST",
    body: {
      url: `${baseUrl}/fixtures/article-background`,
      title: "Background curation can prepare related sources",
      intakeKind: "agent_discovery",
      topicId: firstTopic,
      conceptIds: firstPost.concepts,
      relevanceScore: 0.94,
      noveltyScore: 0.72,
      qualityScore: 0.88,
      reason: "The user liked a related post and opened the thread.",
      discoveredAt: "2026-06-10T00:00:00.000Z"
    }
  });

  assert.equal(candidateResult.record.status, "pending", "source candidate should enter pending inbox");

  const candidateInbox = await requestJson("/api/source-candidates?status=pending");

  assert.equal(candidateInbox.records.length, 1, "candidate inbox should expose pending source candidates");

  const signalResult = await requestJson("/api/signals", {
    method: "POST",
    body: {
      generatedAt: "2026-06-10T00:00:00.000Z",
      topicState: {
        topicId: firstTopic,
        interestScore: 0.82,
        fatigueScore: 0.12,
        comprehensionScore: 0.72
      },
      signal: {
        postId: firstPost.id,
        topicId: firstTopic,
        conceptIds: firstPost.concepts,
        impression: true,
        dwellTimeMs: 18000,
        openedThread: true,
        liked: true,
        saved: false,
        askedQuestion: false,
        reviewed: false,
        skippedQuickly: false,
        createdAt: "2026-06-10T00:00:00.000Z"
      }
    }
  });

  assert.ok(signalResult.records.length > 0, "signal API should enqueue curation jobs");
  assert.equal(signalResult.topicState.topicId, firstTopic, "signal API should persist next topic state");
  assert.equal(typeof signalResult.topicState.interestScore, "number", "topic state should include interest score");
  assert.ok(
    signalResult.records.some((record) => record.job.kind === "import_source"),
    "strong interest with source candidates should enqueue source import"
  );

  const personalizedTimeline = await requestJson(
    "/api/timeline?userId=smoke-user&now=2026-06-10T00:00:00.000Z"
  );

  assert.ok(personalizedTimeline.posts[0].scoreReasons.length > 0, "personalized timeline should explain top rank");
  assert.ok(personalizedTimeline.recommendationSummary.total > 0, "timeline should summarize recommendation mix");

  const curationRun = await requestJson("/api/curation/run", {
    method: "POST",
    body: {
      now: "2026-06-10T00:00:00.000Z",
      kinds: ["import_source"]
    }
  });

  assert.ok(curationRun.records.length > 0, "curation run should process due jobs");
  assert.ok(
    curationRun.records.some((record) => record.status === "succeeded" && record.result?.sourceImport),
    "curation run should import a background source"
  );

  const beforeFollowupSnapshot = await requestJson("/api/snapshot");
  const followupRun = await requestJson("/api/curation/run", {
    method: "POST",
    body: {
      now: "2026-06-10T00:00:00.000Z",
      kinds: ["generate_followup"]
    }
  });

  assert.ok(followupRun.records.length > 0, "curation run should process follow-up jobs");
  const followupRecord = followupRun.records.find(
    (record) =>
      record.status === "succeeded" &&
      record.result?.sourceImport?.importRecord.status === "ready" &&
      record.result?.followupProtocol
  );

  assert.ok(followupRecord, "follow-up run should produce a grounded source import and protocol");
  assert.ok(
    followupRecord.result.sourceImport.posts.length > 0,
    "the first follow-up for a seed post should persist its card"
  );

  // 第二轮:同一 post/day 的累计快照只替换 dwell,不得再排一条生产 job。
  const afterFirstFollowupSnapshot = await requestJson("/api/snapshot");

  const repeatCumulativeSignal = await requestJson("/api/signals", {
    method: "POST",
    body: {
      generatedAt: "2026-06-10T01:00:00.000Z",
      topicState: {
        topicId: firstTopic,
        interestScore: 0.82,
        fatigueScore: 0.12,
        comprehensionScore: 0.72
      },
      signal: {
        postId: firstPost.id,
        topicId: firstTopic,
        conceptIds: firstPost.concepts,
        impression: true,
        dwellTimeMs: 18000,
        openedThread: true,
        liked: true,
        saved: false,
        askedQuestion: false,
        reviewed: false,
        skippedQuickly: false,
        createdAt: "2026-06-10T01:00:00.000Z"
      }
    }
  });

  assert.equal(
    repeatCumulativeSignal.coalescedReplay,
    true,
    "same-day cumulative dwell snapshots should be recognized as a coalesced replay"
  );
  assert.equal(
    repeatCumulativeSignal.records.length,
    0,
    "same-day cumulative dwell snapshots should not enqueue duplicate production"
  );

  const repeatFollowupRun = await requestJson("/api/curation/run", {
    method: "POST",
    body: {
      now: "2026-06-10T01:00:00.000Z",
      kinds: ["generate_followup"]
    }
  });
  assert.equal(
    repeatFollowupRun.records.some((record) => record.job.kind === "generate_followup"),
    false,
    "coalesced cumulative dwell should leave no repeat follow-up job to process"
  );

  const snapshot = await requestJson("/api/snapshot");

  assert.ok(snapshot.sourceImports.length >= 3, "snapshot should include direct, background, and follow-up imports");
  assert.equal(
    snapshot.posts.length,
    afterFirstFollowupSnapshot.posts.length,
    "duplicate-titled follow-up posts should not increase the persisted post count"
  );
  assert.ok(
    snapshot.posts.length > beforeFollowupSnapshot.posts.length,
    "the first follow-up card should have increased the post count"
  );
  assert.ok(snapshot.posts.length >= importResult.posts.length, "snapshot should persist posts");
  assert.ok(snapshot.curationJobs.length >= signalResult.records.length, "snapshot should persist curation records");
  assert.equal(snapshot.userMemories.length, 1, "snapshot should persist user memory");
  assert.ok(snapshot.interactionSignals.length >= 4, "snapshot should persist lifecycle and interaction signals");
  assert.equal(snapshot.topicStates.length, 1, "snapshot should persist topic states");
  assert.equal(Object.hasOwn(snapshot, "dismissedPostIds"), false, "snapshot should not write legacy dismissedPostIds");
  assert.equal(
    snapshot.dismissedPosts.find((record) => record.postId === dismissedPost.id)?.mode,
    "hard",
    "snapshot should persist dismissed post records and hard upgrades"
  );
  assert.equal(snapshot.reviewStates.length, 2, "snapshot should persist review states");
  assert.equal(snapshot.sourceCandidates.length, 1, "snapshot should persist source candidates");
  assert.equal(snapshot.sourceCandidates[0].status, "imported", "imported source candidate should be marked imported");
  assert.ok(snapshot.deepReadArticles.length >= 1, "snapshot should persist deep-read articles");

  // --- Background source discovery: interest without candidates -> discover job -> pending inbox ---
  const secondPost = importResult.posts.find((post) => post.id !== firstPost.id) ?? firstPost;
  const secondTopic = secondPost.concepts[0] ?? "agentic-learning";
  const discoverySignal = await requestJson("/api/signals", {
    method: "POST",
    body: {
      generatedAt: "2026-06-10T01:00:00.000Z",
      signal: {
        postId: secondPost.id,
        topicId: secondTopic,
        conceptIds: secondPost.concepts,
        impression: true,
        dwellTimeMs: 16000,
        openedThread: true,
        liked: true,
        saved: false,
        askedQuestion: false,
        reviewed: false,
        skippedQuickly: false,
        createdAt: "2026-06-10T01:00:00.000Z"
      }
    }
  });

  assert.ok(
    discoverySignal.records.some((record) => record.job.kind === "discover_sources"),
    "strong interest without matching candidates should enqueue source discovery"
  );

  const discoveryRun = await requestJson("/api/curation/run", {
    method: "POST",
    body: {
      now: "2026-06-10T02:00:00.000Z",
      kinds: ["discover_sources"]
    }
  });

  assert.ok(
    discoveryRun.records.some(
      (record) => record.status === "succeeded" && record.result?.discoveredSourceCandidates?.length
    ),
    "discovery jobs should return candidates from the configured search provider"
  );

  const discoveredInbox = await requestJson("/api/source-candidates?status=pending");

  assert.ok(
    discoveredInbox.records.some(
      (record) => record.intakeKind === "agent_discovery" && record.candidate.reason.startsWith("为")
    ),
    "discovered candidates should land in the pending inbox"
  );

  // --- Agent entry: grounded turn, dark turn with inline discovery, metering ---
  const agentGrounded = await requestJson("/api/agent/ask", {
    method: "POST",
    body: { question: `Tell me more about ${firstTopic}` }
  });

  assert.equal(agentGrounded.turn.intent, "grounded_qa", "library-covered questions should get grounded answers");
  assert.equal(agentGrounded.turn.answer.grounded, true, "agent answers should be grounded");
  assert.ok(agentGrounded.turn.answer.citations.length > 0, "agent answers should cite source chunks");
  assert.notEqual(agentGrounded.turn.zone, "dark", "matched concepts should place the turn on the boundary");
  assert.equal(agentGrounded.turnRecord.tier, "free", "deterministic turns should meter as free");

  const agentDark = await requestJson("/api/agent/ask", {
    method: "POST",
    body: { question: "What is quantum chromodynamics?" }
  });

  assert.equal(agentDark.turn.zone, "dark", "out-of-library questions should be dark");
  assert.equal(agentDark.turn.intent, "discovery_proposal", "dark turns should propose discovery, not answer");
  assert.equal(agentDark.turn.answer, null, "the agent must not answer dark questions from model memory");
  assert.ok(
    agentDark.turn.actions.some((action) => action.kind === "confirm_discovery"),
    "dark turns should return a discovery confirmation action"
  );
  assert.equal(
    agentDark.discoveredCandidates.length,
    0,
    "dark turns should not silently send discovery candidates to the inbox before confirmation"
  );
  assert.equal(
    agentDark.turnRecord.status,
    "pending_confirmation",
    "dark turns should wait for confirmation before research starts"
  );
  assert.equal(agentDark.snapshotSummary.agentTurns, 2, "agent turns should be metered in the snapshot");

  const candidatesBeforeResearch = (await requestJson("/api/snapshot")).sourceCandidates.length;
  const confirmResult = await requestJson("/api/agent/confirm", {
    method: "POST",
    body: {
      turnId: agentDark.turnRecord.id,
      now: "2026-06-10T02:29:00.000Z",
      choices: {
        focus: "definition",
        depth: "quick"
      }
    }
  });

  assert.equal(confirmResult.accepted, true, "agent confirm should accept pending dark turns");
  assert.ok(
    confirmResult.records.some((record) => record.job.kind === "research_question"),
    "agent confirm should enqueue a research_question curation job"
  );
  assert.equal(confirmResult.turnRecord.status, "researching", "confirmed turns should move to researching");

  const researchRun = await requestJson("/api/curation/run", {
    method: "POST",
    body: {
      now: "2026-06-10T02:30:00.000Z",
      kinds: ["research_question"]
    }
  });

  assert.ok(
    researchRun.records.some((record) => record.status === "succeeded" && record.job.kind === "research_question"),
    "research_question jobs should run through the curation worker"
  );

  const afterResearchSnapshot = await requestJson("/api/snapshot");
  const researchTurn = afterResearchSnapshot.agentTurns.find((record) => record.id === agentDark.turnRecord.id);
  const originImports = afterResearchSnapshot.sourceImports.filter(
    (record) => record.source.origin?.turnId === agentDark.turnRecord.id
  );
  const pendingAfterResearch = afterResearchSnapshot.sourceCandidates.filter(
    (record) => record.status === "pending" && record.createdAt === "2026-06-10T02:30:00.000Z"
  );
  const answerNotification = afterResearchSnapshot.notifications.find(
    (record) => record.kind === "agent_answer" && record.turnId === agentDark.turnRecord.id
  );

  assert.equal(researchTurn?.status, "answered", "research worker should close the original turn as answered");
  assert.ok(originImports.length > 0, "research worker should automatically import top sources");
  assert.ok(originImports.length <= 2, "quick research should import no more than two sources");
  assert.ok(
    afterResearchSnapshot.sourceCandidates.length > candidatesBeforeResearch,
    "research worker should leave non-imported candidates in Discover"
  );
  assert.ok(pendingAfterResearch.length > 0, "remaining research candidates should be pending in Discover");
  assert.ok(answerNotification, "research worker should create an agent_answer notification");
  assert.ok(answerNotification.body.includes("依据:"), "agent_answer notifications should include a cited grounded answer");
  assert.ok(answerNotification.citations?.length > 0, "agent_answer notifications should carry citations");
  assert.equal(
    originImports.every((record) => record.source.origin?.question === agentDark.turn.question),
    true,
    "auto-imported research sources should record their origin question"
  );

  const authoritativeQueue = JSON.parse(await readFile(curationDataPath, "utf8"));
  const persistedResearchRecord = authoritativeQueue.records.find(
    (record) => record.job.kind === "research_question" && record.job.researchQuestion?.turnId === agentDark.turnRecord.id
  );
  assert.ok(persistedResearchRecord.result?.materializationPlan, "research terminal must persist a replayable plan");
  const crashPlan = persistedResearchRecord.result.materializationPlan;
  const crashDataPath = join(tempDir, "research-terminal-before-apply.json");
  const crashQueuePath = join(tempDir, "research-terminal-before-apply-queue.json");
  const crashSnapshot = structuredClone(afterResearchSnapshot);
  const crashImportIds = new Set(crashPlan.sourceImports.map((result) => result.importRecord.id));
  const crashSourceIds = new Set(crashPlan.sourceImports.map((result) => result.importRecord.source.id));
  const crashPostIds = new Set([
    ...crashPlan.sourceImports.flatMap((result) => result.posts.map((post) => post.id)),
    ...(crashPlan.extraPosts ?? []).map((post) => post.id)
  ]);
  crashSnapshot.sourceImports = crashSnapshot.sourceImports.filter((record) => !crashImportIds.has(record.id));
  crashSnapshot.sourceRegistries = crashSnapshot.sourceRegistries.filter((record) => !crashSourceIds.has(record.sourceId));
  crashSnapshot.posts = crashSnapshot.posts.filter((post) => !crashPostIds.has(post.id));
  crashSnapshot.releasePlans = crashSnapshot.releasePlans.filter(
    (plan) => !(crashPlan.releasePlans ?? []).some((candidate) => JSON.stringify(candidate) === JSON.stringify(plan))
  );
  crashSnapshot.notifications = crashSnapshot.notifications.filter(
    (record) => !(crashPlan.notifications ?? []).some((candidate) => candidate.id === record.id)
  );
  crashSnapshot.sourceCandidates = crashSnapshot.sourceCandidates.filter(
    (record) => !(crashPlan.sourceCandidateRecords ?? []).some((candidate) => candidate.id === record.id)
  );
  crashSnapshot.agentTurns = crashSnapshot.agentTurns.map((record) =>
    record.id === agentDark.turnRecord.id ? { ...record, status: "researching", answerCardId: undefined } : record
  );
  const crashQueueRecord = structuredClone(persistedResearchRecord);
  delete crashQueueRecord.materializedAt;
  await writeFile(crashDataPath, JSON.stringify(crashSnapshot));
  await writeFile(crashQueuePath, JSON.stringify({ version: 2, revision: 0, records: [crashQueueRecord] }));
  let crashRecoveryServer = createApiServer({
    dataPath: crashDataPath,
    curationDataPath: crashQueuePath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });
  const recoveredResearchSnapshot = await requestJsonFromServer(crashRecoveryServer, "/api/snapshot");
  const recoveredResearchJobs = await requestJsonFromServer(crashRecoveryServer, "/api/curation/jobs");
  const recoveredResearchRecord = recoveredResearchJobs.jobs.find((record) => record.id === crashQueueRecord.id);
  assert.ok(recoveredResearchRecord.materializedAt, "startup should mark the replayed research terminal materialized");
  assert.deepEqual(
    recoveredResearchSnapshot.curationJobs,
    recoveredResearchJobs.jobs,
    "startup reconciliation should make the authoritative queue and main snapshot mirror exactly equal"
  );
  assert.ok(
    crashPlan.sourceImports.every((result) => recoveredResearchSnapshot.sourceImports.some((record) => record.id === result.importRecord.id)),
    "startup should replay all persisted research imports"
  );
  assert.ok(
    crashPlan.notifications.every((notification) => recoveredResearchSnapshot.notifications.filter((record) => record.id === notification.id).length === 1),
    "startup should replay each research notification exactly once"
  );
  assert.equal(
    recoveredResearchSnapshot.agentTurns.find((record) => record.id === agentDark.turnRecord.id)?.status,
    "answered",
    "startup should replay the research agent-turn patch"
  );
  const recoveredCounts = {
    imports: recoveredResearchSnapshot.sourceImports.length,
    posts: recoveredResearchSnapshot.posts.length,
    releases: recoveredResearchSnapshot.releasePlans.length,
    notifications: recoveredResearchSnapshot.notifications.length
  };
  const recoveredMarker = recoveredResearchRecord.materializedAt;
  await closeServer(crashRecoveryServer);
  crashRecoveryServer = createApiServer({
    dataPath: crashDataPath,
    curationDataPath: crashQueuePath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });
  const replayedAgainSnapshot = await requestJsonFromServer(crashRecoveryServer, "/api/snapshot");
  const replayedAgainJobs = await requestJsonFromServer(crashRecoveryServer, "/api/curation/jobs");
  assert.deepEqual(
    {
      imports: replayedAgainSnapshot.sourceImports.length,
      posts: replayedAgainSnapshot.posts.length,
      releases: replayedAgainSnapshot.releasePlans.length,
      notifications: replayedAgainSnapshot.notifications.length
    },
    recoveredCounts,
    "a second startup must not duplicate any research materialization effect"
  );
  assert.equal(
    replayedAgainJobs.jobs.find((record) => record.id === crashQueueRecord.id)?.materializedAt,
    recoveredMarker,
    "a second startup must preserve the original materialization marker"
  );
  await closeServer(crashRecoveryServer);

  const notificationsResponse = await requestJson("/api/notifications");
  const notificationDetail = notificationsResponse.records.find((record) => record.id === answerNotification.id);

  assert.ok(notificationDetail, "notifications endpoint should include the research answer");
  assert.ok(notificationDetail.supportPosts.length > 0, "notification details should include support cards");

  const readNotification = await requestJson(`/api/notifications/${encodeURIComponent(answerNotification.id)}/read`, {
    method: "POST"
  });

  assert.equal(readNotification.record.readAt.length > 0, true, "notification read endpoint should set readAt");

  const researchPost = afterResearchSnapshot.posts.find((post) =>
    post.sources.some((source) => source.origin?.turnId === agentDark.turnRecord.id)
  );

  assert.ok(researchPost, "research imports should create at least one post with source origin");

  const compoundTurn = await requestJson("/api/agent/ask", {
    method: "POST",
    body: {
      postId: researchPost.id,
      question: "这条来源还能说明什么?"
    }
  });

  assert.match(
    compoundTurn.turn.answer.answer,
    /这条证据来自你 \d+ 月 \d+ 日的提问/,
    "later grounded answers citing an originated source should include the compound-interest origin note"
  );

  // --- Notes: user posts become self-grounded posts and get an observer reply ---
  const noteResult = await requestJson("/api/notes", {
    method: "POST",
    body: {
      text: `My note: ${firstTopic} quality depends on retrieval quality.`,
      createdAt: "2026-06-10T01:00:00.000Z"
    }
  });

  assert.equal(noteResult.post.sources[0].type, "user_note", "notes should persist as user_note sources");
  assert.equal(noteResult.post.kind, undefined, "old note calls without kind should not become idea posts");
  assert.equal(noteResult.post.thread[0].kind, "agent_reply", "the observer reply on a note should be an agent_reply block");
  assert.ok(noteResult.post.citations.length > 0, "note posts should cite their own registry chunk");
  assert.equal(noteResult.turn.intent, "grounded_qa", "notes touching library concepts should get grounded replies");
  assert.ok(noteResult.turn.answer.citations.length > 0, "observer replies to notes should cite source chunks");
  assert.deepEqual(
    noteResult.post.thread[0].citations,
    noteResult.turn.answer.citations,
    "note observer blocks should persist the complete answer citations"
  );
  assert.equal(noteResult.post.thread[0].grounded, noteResult.turn.answer.grounded, "note grounded metadata should match the answer");
  assert.equal(noteResult.post.thread[0].runnerKind, noteResult.turn.answer.runnerKind, "note runner metadata should match the answer");
  assert.equal(noteResult.snapshotSummary.agentTurns, 4, "note replies should be metered as agent turns");

  const noteTimeline = await requestJson("/api/timeline?now=2026-06-11T00:00:00.000Z");
  const timelineNotePost = noteTimeline.posts.find((post) => post.id === noteResult.post.id);

  assert.ok(timelineNotePost, "the note should appear in the timeline immediately");
  assert.ok(timelineNotePost.thread.length > 0, "the observer reply should persist on the note's thread");

  const finalSnapshot = await requestJson("/api/snapshot");
  const localUserMemory = finalSnapshot.userMemories.find((record) => record.userId === "local-user");

  assert.equal(
    localUserMemory?.memory.interaction.recentQuestions.length,
    4,
    "agent questions and notes should accumulate into user memory"
  );

  // --- Inline replies: commenting on a card appends a public in-post thread ---
  const beforeReplyTimeline = await requestJson("/api/timeline?now=2026-06-11T00:00:00.000Z");
  const beforeReplyPost = beforeReplyTimeline.posts.find((post) => post.id === firstPost.id);
  const replyRequest = {
    method: "POST",
    body: {
      text: `How does ${firstTopic} keep its citations grounded?`,
      createdAt: "2026-06-10T03:00:00.000Z"
    }
  };
  const replyResults = await Promise.all([
    requestJson(`/api/posts/${encodeURIComponent(firstPost.id)}/replies`, replyRequest),
    requestJson(`/api/posts/${encodeURIComponent(firstPost.id)}/replies`, replyRequest)
  ]);

  for (const replyResult of replyResults) {
    const persistedAgentBlock = replyResult.post.thread.at(-1);
    assert.equal(replyResult.turn.intent, "grounded_qa", "replies target the card and answer grounded");
    assert.ok(replyResult.turn.answer.citations.length > 0, "observer replies to comments should cite source chunks");
    assert.equal(persistedAgentBlock.kind, "agent_reply", "each reply append should end with its observer block");
    assert.deepEqual(persistedAgentBlock.citations, replyResult.turn.answer.citations, "persisted reply citations should match the answer exactly");
    assert.equal(persistedAgentBlock.grounded, replyResult.turn.answer.grounded, "persisted reply grounded metadata should match");
    assert.equal(persistedAgentBlock.runnerKind, replyResult.turn.answer.runnerKind, "persisted reply runner metadata should match");
  }

  await closeServer(server);
  server = createApiServer({
    dataPath,
    curationDataPath,
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });
  const replyTimeline = await requestJson("/api/timeline?now=2026-06-11T00:00:00.000Z");
  const replyTimelinePost = replyTimeline.posts.find((post) => post.id === firstPost.id);
  const appendedReplyBlocks = replyTimelinePost.thread.slice(beforeReplyPost.thread.length);

  assert.equal(appendedReplyBlocks.length, 4, "concurrent replies should survive a true server restart as four appended blocks");
  assert.equal(appendedReplyBlocks.filter((block) => block.kind === "user_comment").length, 2, "both user comments should survive");
  assert.equal(appendedReplyBlocks.filter((block) => block.kind === "agent_reply").length, 2, "both observer replies should survive");
  assert.equal(new Set(appendedReplyBlocks.map((block) => block.id)).size, 4, "concurrent reply block ids must all be unique");
  for (const block of appendedReplyBlocks.filter((candidate) => candidate.kind === "agent_reply")) {
    assert.ok(block.citations[0]?.quote, "reloaded reply citations should retain quotes");
    assert.equal(block.runnerKind, "deterministic", "reloaded replies should retain runner metadata");
    assert.equal(block.grounded, true, "reloaded replies should retain grounded metadata");
  }

  // --- Idea flow: kind=idea notes get library links, probes, testable research, and no card from probe answers ---
  const firstSourceTitle = firstPost.sources[0]?.title ?? firstPost.title;
  const ideaResult = await requestJson("/api/notes", {
    method: "POST",
    body: {
      text: `Idea: ${firstTopic} could make citation review cheaper when the graph already knows the source boundary.`,
      kind: "idea",
      createdAt: "2026-06-10T03:10:00.000Z"
    }
  });

  assert.equal(ideaResult.post.kind, "idea", "kind=idea notes should persist as idea posts");
  assert.equal(ideaResult.turn.intent, "idea_observation", "idea notes should produce an idea observation turn");
  assert.match(ideaResult.turn.notes.join("\n"), /库内关联/, "idea replies should include the library-link section");
  assert.ok(
    ideaResult.turn.notes.join("\n").includes(firstSourceTitle),
    "idea library links should cite source titles"
  );
  assert.ok(ideaResult.turn.nearestPosts.length > 0, "idea replies should link real in-library cards");
  assert.ok(ideaResult.turn.nearestPosts.length <= 3, "idea replies should cap library links at three cards");

  const ideaProbeAction = ideaResult.turn.actions.find((action) => action.kind === "idea_probe");
  const ideaResearchAction = ideaResult.turn.actions.find((action) => action.kind === "research_idea");

  assert.ok(ideaProbeAction, "idea replies should include an idea_probe action");
  assert.ok(ideaResearchAction?.question, "idea replies should include a testable research_idea action");

  const beforeProbeSnapshot = await requestJson("/api/snapshot");
  const probeAnswer = await requestJson("/api/agent/ask", {
    method: "POST",
    body: {
      question: "可以先验证 citation review 成本是否随已知边界下降。",
      threadId: ideaResult.turnRecord.threadId,
      now: "2026-06-10T03:12:00.000Z"
    }
  });
  const afterProbeSnapshot = await requestJson("/api/snapshot");

  assert.equal(
    probeAnswer.turnRecord.threadId,
    ideaResult.turnRecord.threadId,
    "idea probe answers should stay in the idea thread with previous turns available"
  );
  assert.equal(afterProbeSnapshot.posts.length, beforeProbeSnapshot.posts.length, "idea probe answers should not create cards");
  assert.equal(
    afterProbeSnapshot.reviewStates.length,
    beforeProbeSnapshot.reviewStates.length,
    "idea probe answers should not create review items"
  );

  const searchQueryStart = observedSearchQueries.length;
  const ideaResearchRequest = await requestJson("/api/agent/research-idea", {
    method: "POST",
    body: {
      turnId: ideaResult.turnRecord.id,
      question: ideaResearchAction.question,
      concepts: ideaResearchAction.concepts,
      now: "2026-06-10T03:19:00.000Z"
    }
  });

  assert.ok(
    ideaResearchRequest.records.some((record) => record.job.kind === "research_idea"),
    "idea evidence buttons should enqueue a research_idea curation job"
  );
  assert.ok(
    ideaResearchRequest.records[0].job.researchIdea.supportQueries.some((query) => /evidence|case/i.test(query)),
    "research_idea jobs should store support-oriented queries"
  );
  assert.ok(
    ideaResearchRequest.records[0].job.researchIdea.challengeQueries.some((query) => /criticism|limitations|counterexample/i.test(query)),
    "research_idea jobs should store challenge-oriented queries"
  );

  const ideaResearchRun = await requestJson("/api/curation/run", {
    method: "POST",
    body: {
      now: "2026-06-10T03:20:00.000Z",
      kinds: ["research_idea"]
    }
  });
  const ideaSearchQueries = observedSearchQueries.slice(searchQueryStart);

  assert.ok(
    ideaResearchRun.records.some((record) => record.status === "succeeded" && record.job.kind === "research_idea"),
    "research_idea jobs should run through the curation worker"
  );
  assert.ok(
    ideaResearchRun.records.some((record) => record.result?.ideaResearchQueries?.support?.length > 0),
    "research_idea results should expose support query groups"
  );
  assert.ok(
    ideaResearchRun.records.some((record) => record.result?.ideaResearchQueries?.challenge?.length > 0),
    "research_idea results should expose challenge query groups"
  );
  assert.ok(
    ideaSearchQueries.some((query) => /evidence|case/i.test(query)),
    "support-oriented research_idea queries should be sent to search"
  );
  assert.ok(
    ideaSearchQueries.some((query) => /criticism|limitations|counterexample/i.test(query)),
    "challenge-oriented research_idea queries should be sent to search"
  );

  const afterIdeaResearchSnapshot = await requestJson("/api/snapshot");
  const ideaImports = afterIdeaResearchSnapshot.sourceImports.filter(
    (record) => record.source.origin?.turnId === ideaResult.turnRecord.id
  );
  const ideaNotification = afterIdeaResearchSnapshot.notifications.find(
    (record) => record.kind === "agent_answer" && record.turnId === ideaResult.turnRecord.id
  );

  assert.ok(ideaImports.length > 0, "research_idea should import evidence sources");
  assert.ok(ideaImports.length <= 4, "research_idea should import at most two sources per side");
  assert.ok(ideaNotification, "research_idea should create an agent_answer notification");
  assert.match(ideaNotification.body, /支持的证据/, "research_idea notifications should include a support column");
  assert.match(ideaNotification.body, /相反的声音/, "research_idea notifications should include an opposing column");
  assert.ok(ideaNotification.citations?.length > 0, "research_idea notifications should carry source citations");

  const missingReply = await fetch(`${baseUrl}/api/posts/does-not-exist/replies`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "hi" })
  });

  assert.equal(missingReply.status, 404, "replying to a missing post should 404");

  // --- On-demand discovery from the reply chip (/api/discovery/run) ---
  const candidatesBefore = (await requestJson("/api/snapshot")).sourceCandidates.length;
  const chipDiscovery = await requestJson("/api/discovery/run", {
    method: "POST",
    body: { queries: ["向量数据库该怎么选?"], concepts: [] }
  });

  assert.equal(chipDiscovery.configured, true, "discovery/run should report the provider as configured");
  assert.ok(chipDiscovery.candidates.length > 0, "discovery/run should return candidates from the provider");

  const candidatesAfter = (await requestJson("/api/snapshot")).sourceCandidates.length;

  assert.ok(candidatesAfter > candidatesBefore, "discovery/run should persist the discovered candidates");

  const emptyDiscovery = await fetch(`${baseUrl}/api/discovery/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ queries: [], concepts: [] })
  });

  assert.equal(emptyDiscovery.status, 400, "discovery/run without queries or concepts should 400");

  if (!process.env.AITIMELINE_SEARCH_API_KEY) {
    // A server without a provider reports the unconfigured state instead of erroring.
    const bareServer = createApiServer({
      dataPath: join(tempDir, "bare.json"),
      curationDataPath: join(tempDir, "bare-jobs.json")
    });

    try {
      const bareResponse = await dispatchToServer(bareServer, `${baseUrl}/api/discovery/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ queries: ["anything"], concepts: [] })
      });
      const barePayload = await bareResponse.json();

      assert.equal(bareResponse.status, 200, "unconfigured discovery/run should still respond 200");
      assert.equal(barePayload.configured, false, "unconfigured discovery/run should report configured=false");
      assert.deepEqual(barePayload.candidates, [], "unconfigured discovery/run should return no candidates");

      const bareIdea = await requestJsonFromServer(bareServer, "/api/notes", {
        method: "POST",
        body: {
          text: "一个空库里的原创想法需要先找正反证据。",
          kind: "idea",
          createdAt: "2026-06-10T03:40:00.000Z"
        }
      });

      assert.match(
        bareIdea.turn.notes.join("\n"),
        /库内没有相关材料/,
        "ideas in an empty library should say there is no related material"
      );
      assert.ok(
        bareIdea.turn.actions.some((action) => action.kind === "idea_probe"),
        "empty-library idea replies should still include probe actions"
      );
      const bareIdeaResearchAction = bareIdea.turn.actions.find((action) => action.kind === "research_idea");
      assert.ok(bareIdeaResearchAction, "empty-library idea replies should still include research actions");
      await requestJsonFromServer(bareServer, "/api/agent/research-idea", {
        method: "POST",
        body: {
          turnId: bareIdea.turnRecord.id,
          question: bareIdeaResearchAction.question,
          concepts: bareIdeaResearchAction.concepts,
          now: "2026-06-10T03:49:00.000Z"
        }
      });
      await requestJsonFromServer(bareServer, "/api/curation/run", {
        method: "POST",
        body: {
          now: "2026-06-10T03:50:00.000Z",
          kinds: ["research_idea"]
        }
      });
      const bareIdeaNotifications = await requestJsonFromServer(bareServer, "/api/notifications");

      assert.ok(
        bareIdeaNotifications.records.some(
          (record) => record.turnId === bareIdea.turnRecord.id && /搜索服务未配置/.test(record.body)
        ),
        "unconfigured idea research should create a clear notification"
      );

      const bareDark = await requestJsonFromServer(bareServer, "/api/agent/ask", {
        method: "POST",
        body: { question: "What is offline-only research?" }
      });
      await requestJsonFromServer(bareServer, "/api/agent/confirm", {
        method: "POST",
        body: {
          turnId: bareDark.turnRecord.id,
          now: "2026-06-10T03:59:00.000Z",
          choices: { focus: "definition", depth: "quick" }
        }
      });
      await requestJsonFromServer(bareServer, "/api/curation/run", {
        method: "POST",
        body: {
          now: "2026-06-10T04:00:00.000Z",
          kinds: ["research_question"]
        }
      });
      const bareNotifications = await requestJsonFromServer(bareServer, "/api/notifications");

      assert.ok(
        bareNotifications.records.some((record) => /搜索服务未配置/.test(record.body)),
        "unconfigured research should create a clear notification"
      );
    } finally {
      await closeServer(bareServer);
    }
  }

  const oneSidedIdeaServer = createApiServer({
    dataPath: join(tempDir, "one-sided-idea.json"),
    curationDataPath: join(tempDir, "one-sided-idea-jobs.json"),
    searchProvider: {
      id: "one-sided-idea",
      async search(query) {
        if (/criticism|limitations|counterexample|contrary/i.test(query)) {
          return [];
        }

        return [
          {
            url: `${baseUrl}/fixtures/article-background?one-sided=${encodeURIComponent(query)}`,
            title: `One-sided support source for ${query}`,
            snippet: "A support-only source for testing one empty side in idea research notifications."
          }
        ];
      }
    }
  });

  try {
    const oneSidedIdea = await requestJsonFromServer(oneSidedIdeaServer, "/api/notes", {
      method: "POST",
      body: {
        text: "A support-only idea should still report when the opposing side is empty.",
        kind: "idea",
        createdAt: "2026-06-10T04:10:00.000Z"
      }
    });
    const action = oneSidedIdea.turn.actions.find((item) => item.kind === "research_idea");
    assert.ok(action, "one-sided idea setup should include a research_idea action");
    await requestJsonFromServer(oneSidedIdeaServer, "/api/agent/research-idea", {
      method: "POST",
      body: {
        turnId: oneSidedIdea.turnRecord.id,
        question: action.question,
        concepts: action.concepts,
        now: "2026-06-10T04:11:00.000Z"
      }
    });
    await requestJsonFromServer(oneSidedIdeaServer, "/api/curation/run", {
      method: "POST",
      body: {
        now: "2026-06-10T04:12:00.000Z",
        kinds: ["research_idea"]
      }
    });
    const oneSidedNotifications = await requestJsonFromServer(oneSidedIdeaServer, "/api/notifications");
    const oneSidedNotification = oneSidedNotifications.records.find(
      (record) => record.turnId === oneSidedIdea.turnRecord.id
    );

    assert.ok(oneSidedNotification, "one-sided idea research should still create a notification");
    assert.match(oneSidedNotification.body, /支持的证据/, "one-sided notifications should include support evidence");
    assert.match(
      oneSidedNotification.body,
      /没找到这一侧的靠谱来源/,
      "one-sided notifications should state when opposing evidence is empty"
    );
  } finally {
    await closeServer(oneSidedIdeaServer);
  }

  const failingImportServer = createApiServer({
    dataPath: join(tempDir, "failing-import.json"),
    curationDataPath: join(tempDir, "failing-import-jobs.json"),
    searchProvider: {
      id: "unsupported-source-type",
      async search(query) {
        return [
          {
            url: `${baseUrl}/unsupported-research-source/${encodeURIComponent(query)}`,
            title: `Unsupported research source for ${query}`,
            snippet: "This result is intentionally unsupported by the background ingestion worker.",
            sourceType: "repo"
          }
        ];
      }
    }
  });

  try {
    const blockedDark = await requestJsonFromServer(failingImportServer, "/api/agent/ask", {
      method: "POST",
      body: { question: "What should happen when every research import fails?" }
    });
    await requestJsonFromServer(failingImportServer, "/api/agent/confirm", {
      method: "POST",
      body: {
        turnId: blockedDark.turnRecord.id,
        now: "2026-06-10T04:29:00.000Z",
        choices: { focus: "definition", depth: "quick" }
      }
    });
    await requestJsonFromServer(failingImportServer, "/api/curation/run", {
      method: "POST",
      body: {
        now: "2026-06-10T04:30:00.000Z",
        kinds: ["research_question"]
      }
    });
    const blockedNotifications = await requestJsonFromServer(failingImportServer, "/api/notifications");

    assert.ok(
      blockedNotifications.records.some((record) => /门禁|导入失败/.test(record.body)),
      "all-blocked or all-failed research imports should create an explanatory notification"
    );
  } finally {
    await closeServer(failingImportServer);
  }

  // 完成复习放在最后:休眠期排除会让这张卡退出时间线,中段的排序/整理断言需要它在场。
  const completedReview = await requestJson(`/api/review/${encodeURIComponent(firstPost.id)}/complete`, {
    method: "POST",
    body: {
      reviewedAt: firstReviewState.dueAt
    }
  });

  assert.equal(completedReview.reviewState.intervalDays, 3, "completing review should advance the interval");
  assert.equal(
    completedReview.reviewState.lastReviewedAt,
    firstReviewState.dueAt,
    "completing review should record lastReviewedAt"
  );

  const dueAfterComplete = await requestJson(`/api/review/due?now=${encodeURIComponent(firstReviewState.dueAt)}`);
  const timelineAfterComplete = await requestJson(`/api/timeline?now=${encodeURIComponent(firstReviewState.dueAt)}`);
  const completedTimelinePost = timelineAfterComplete.posts.find((post) => post.id === firstPost.id);

  assert.equal(
    dueAfterComplete.due.some((state) => state.postId === firstPost.id),
    false,
    "completed reviews should leave the due review endpoint until their next dueAt"
  );
  assert.equal(
    completedTimelinePost,
    undefined,
    "completed reviews should rest out of the timeline entirely until the next dueAt"
  );

  // The API-owned worker must advance due work without a page calling
  // /api/curation/run, remain paused until explicitly resumed, and expose its
  // in-memory state through the timeline.
  const workerSmokeIntervalMs = 200;
  const workerSmokeTimeoutMs = 8000;
  const workerSeededAt = new Date(Date.now() - workerSmokeIntervalMs).toISOString();
  const workerLifecycleDataPath = join(tempDir, "worker-lifecycle.json");
  const workerLifecycleCurationPath = join(tempDir, "worker-lifecycle-curation.json");
  const workerInitialCandidate = makeSourceCandidateRecord({
    id: "worker-lifecycle-initial",
    url: "https://worker-lifecycle.local/initial",
    score: 0.99,
    status: "queued",
    concept: "Server Worker",
    createdAt: workerSeededAt
  });
  const workerInitialJob = makeQueuedImportJobRecord(workerInitialCandidate, workerSeededAt);

  await writeFile(
    workerLifecycleDataPath,
    JSON.stringify({
      version: 1,
      updatedAt: workerSeededAt,
      sourceCandidates: [workerInitialCandidate]
    })
  );
  await writeFile(
    workerLifecycleCurationPath,
    JSON.stringify({
      version: 1,
      records: [workerInitialJob]
    })
  );

  const workerLifecycleFetchUrls = [];
  const workerLifecycleServer = createApiServer({
    dataPath: workerLifecycleDataPath,
    curationDataPath: workerLifecycleCurationPath,
    mediaRootDir,
    worker: true,
    workerIntervalMs: workerSmokeIntervalMs,
    guardedFetch: async (input) => {
      const url = getFetchUrl(input);

      if (!url.startsWith("https://worker-lifecycle.local/")) {
        throw new Error(`Unexpected lifecycle worker fetch: ${url}`);
      }

      workerLifecycleFetchUrls.push(url);
      return makeWorkerSmokeFetchResponse("Lifecycle worker fixture");
    }
  });

  try {
    const initialWorkerTimeline = await requestJsonFromServer(workerLifecycleServer, "/api/timeline");

    assert.equal(initialWorkerTimeline.workerStatus.enabled, true, "an explicitly enabled worker should start enabled");
    assert.equal(
      typeof initialWorkerTimeline.workerStatus.running,
      "boolean",
      "timeline workerStatus.running should be a boolean"
    );
    assert.equal(
      initialWorkerTimeline.workerStatus.intervalMs,
      workerSmokeIntervalMs,
      "timeline workerStatus should expose the configured smoke interval"
    );

    const firstWorkerTerminal = await waitForCurationJob(
      workerLifecycleServer,
      workerInitialJob.id,
      (record) => isTerminalCurationStatus(record?.status),
      {
        timeoutMs: workerSmokeTimeoutMs,
        description: "server worker to finish the initially due job without a manual run"
      }
    );

    assert.ok(
      isTerminalCurationStatus(firstWorkerTerminal.status),
      "the enabled server worker should move the initially due job to a terminal state"
    );
    assert.deepEqual(
      workerLifecycleFetchUrls,
      ["https://worker-lifecycle.local/initial"],
      "the initial due job should be fetched exactly once by the server worker"
    );

    const idleWorkerStatus = await waitForWorkerStatus(
      workerLifecycleServer,
      (status) => status.running === false && typeof status.lastRunAt === "string",
      {
        timeoutMs: workerSmokeTimeoutMs,
        description: "server worker to become idle after its first tick"
      }
    );

    assert.deepEqual(
      Object.fromEntries(
        Object.entries(idleWorkerStatus.lastRunSummary).map(([key, value]) => [key, typeof value])
      ),
      {
        processedJobs: "number",
        refillQueued: "number",
        subscriptionsChecked: "number"
      },
      "timeline workerStatus.lastRunSummary should expose the three documented counters"
    );

    const pausedWorker = await requestJsonFromServer(workerLifecycleServer, "/api/worker", {
      method: "POST",
      body: { enabled: false }
    });

    assert.equal(pausedWorker.workerStatus.enabled, false, "POST /api/worker should pause the server worker");

    const pausedCandidateCreatedAt = new Date(Date.now() - workerSmokeIntervalMs).toISOString();
    const pausedCandidate = await requestJsonFromServer(workerLifecycleServer, "/api/source-candidates", {
      method: "POST",
      body: {
        id: "worker-lifecycle-paused",
        url: "https://worker-lifecycle.local/paused",
        title: "Paused lifecycle worker fixture",
        intakeKind: "agent_discovery",
        topicId: "Server Worker",
        conceptIds: ["Server Worker"],
        relevanceScore: 0.98,
        noveltyScore: 0.98,
        qualityScore: 0.98,
        reason: "Seed a due job while the API worker is paused.",
        discoveredAt: pausedCandidateCreatedAt
      }
    });
    const pausedRefill = await requestJsonFromServer(workerLifecycleServer, "/api/supply/refill", {
      method: "POST",
      body: { now: pausedCandidateCreatedAt }
    });
    const pausedJobs = await requestJsonFromServer(workerLifecycleServer, "/api/curation/jobs");
    const pausedJob = pausedJobs.jobs.find(
      (record) => record.job.sourceCandidate?.id === pausedCandidate.record.candidate.id
    );

    assert.equal(pausedRefill.queued, 1, "the paused-worker fixture should seed one due import job");
    assert.ok(pausedJob, "the paused-worker fixture should expose its seeded job");
    assert.equal(pausedJob.status, "queued", "the second worker job should begin queued");

    await delay(workerSmokeIntervalMs * 3 + 100);

    const stillPausedJobs = await requestJsonFromServer(workerLifecycleServer, "/api/curation/jobs");
    const stillPausedJob = stillPausedJobs.jobs.find((record) => record.id === pausedJob.id);
    const pausedTimeline = await requestJsonFromServer(workerLifecycleServer, "/api/timeline");

    assert.equal(
      stillPausedJob?.status,
      "queued",
      "a paused worker should leave a due job queued across at least three intervals"
    );
    assert.equal(
      workerLifecycleFetchUrls.includes("https://worker-lifecycle.local/paused"),
      false,
      "a paused worker should not fetch the second due job"
    );
    assert.equal(pausedTimeline.workerStatus.enabled, false, "timeline should reflect the paused worker state");

    const resumedWorker = await requestJsonFromServer(workerLifecycleServer, "/api/worker", {
      method: "POST",
      body: { enabled: true }
    });

    assert.equal(resumedWorker.workerStatus.enabled, true, "POST /api/worker should resume the server worker");

    const resumedWorkerTerminal = await waitForCurationJob(
      workerLifecycleServer,
      pausedJob.id,
      (record) => isTerminalCurationStatus(record?.status),
      {
        timeoutMs: workerSmokeTimeoutMs,
        description: "resumed server worker to finish the job seeded while paused"
      }
    );
    const resumedTimeline = await requestJsonFromServer(workerLifecycleServer, "/api/timeline");

    assert.ok(
      isTerminalCurationStatus(resumedWorkerTerminal.status),
      "the resumed worker should move the paused job to a terminal state"
    );
    assert.equal(resumedTimeline.workerStatus.enabled, true, "timeline should reflect the resumed worker state");
    assert.equal(
      resumedTimeline.workerStatus.intervalMs,
      workerSmokeIntervalMs,
      "workerStatus interval should remain stable across pause and resume"
    );
  } finally {
    await closeServer(workerLifecycleServer);
  }

  // Hold a manual run inside its first source fetch. Multiple worker intervals
  // elapse while a second due import remains queued; a worker that does not
  // share the manual-run guard will fetch that second source.
  const workerGuardDataPath = join(tempDir, "worker-guard.json");
  const workerGuardCurationPath = join(tempDir, "worker-guard-curation.json");
  const workerGuardFetchUrls = [];
  let releaseWorkerGuardFetch = null;
  const workerGuardServer = createApiServer({
    dataPath: workerGuardDataPath,
    curationDataPath: workerGuardCurationPath,
    mediaRootDir,
    worker: true,
    workerIntervalMs: workerSmokeIntervalMs,
    guardedFetch: async (input) => {
      const url = getFetchUrl(input);

      if (!url.startsWith("https://worker-guard.local/")) {
        throw new Error(`Unexpected guarded worker fetch: ${url}`);
      }

      workerGuardFetchUrls.push(url);

      if (workerGuardFetchUrls.length === 1) {
        await new Promise((resolveFetch) => {
          releaseWorkerGuardFetch = resolveFetch;
        });
      }

      return makeWorkerSmokeFetchResponse("Worker mutual exclusion fixture");
    }
  });

  try {
    const initiallyPausedGuardWorker = await requestJsonFromServer(workerGuardServer, "/api/worker", {
      method: "POST",
      body: { enabled: false }
    });

    assert.equal(
      initiallyPausedGuardWorker.workerStatus.enabled,
      false,
      "the worker guard fixture should pause before jobs are seeded"
    );

    const workerGuardCreatedAt = new Date(Date.now() - workerSmokeIntervalMs).toISOString();
    const workerGuardCandidateIds = ["worker-guard-a", "worker-guard-b"];

    for (const [index, id] of workerGuardCandidateIds.entries()) {
      await requestJsonFromServer(workerGuardServer, "/api/source-candidates", {
        method: "POST",
        body: {
          id,
          url: `https://worker-guard.local/${id}`,
          title: `Worker guard fixture ${id}`,
          intakeKind: "agent_discovery",
          topicId: "Worker Guard",
          conceptIds: ["Worker Guard"],
          relevanceScore: 0.99 - index * 0.01,
          noveltyScore: 0.99 - index * 0.01,
          qualityScore: 0.99 - index * 0.01,
          reason: "Keep a second due import available to detect an overlapping worker tick.",
          discoveredAt: workerGuardCreatedAt
        }
      });
    }

    const workerGuardRefill = await requestJsonFromServer(workerGuardServer, "/api/supply/refill", {
      method: "POST",
      body: { now: workerGuardCreatedAt }
    });

    assert.equal(workerGuardRefill.queued, 2, "the worker guard fixture should seed two due import jobs");

    const blockedManualRun = requestJsonFromServer(workerGuardServer, "/api/curation/run", {
      method: "POST",
      body: {
        now: new Date().toISOString(),
        limit: 1,
        kinds: ["import_source"]
      }
    });

    await waitForFetchCount(workerGuardFetchUrls, 1, {
      timeoutMs: workerSmokeTimeoutMs,
      description: "manual curation run to reach its blocking worker-guard fetch"
    });

    const enabledGuardWorker = await requestJsonFromServer(workerGuardServer, "/api/worker", {
      method: "POST",
      body: { enabled: true }
    });

    assert.equal(enabledGuardWorker.workerStatus.enabled, true, "the guard fixture worker should resume");

    await delay(workerSmokeIntervalMs * 3 + 100);

    const jobsWhileManualRunBlocked = await requestJsonFromServer(workerGuardServer, "/api/curation/jobs");
    const guardTimelineWhileBlocked = await requestJsonFromServer(workerGuardServer, "/api/timeline");
    const workerGuardJobStatuses = jobsWhileManualRunBlocked.jobs
      .filter((record) => workerGuardCandidateIds.includes(record.job.sourceCandidate?.id))
      .map((record) => record.status)
      .sort();

    assert.equal(
      workerGuardFetchUrls.length,
      1,
      "worker ticks crossing multiple intervals must not fetch a second source while a manual run holds the guard"
    );
    assert.deepEqual(
      workerGuardJobStatuses,
      ["queued", "running"],
      "worker ticks should leave the second import queued while the manual run is blocked"
    );
    assert.equal(
      guardTimelineWhileBlocked.workerStatus.running,
      true,
      "timeline workerStatus.running should reuse the shared manual-run guard"
    );

    releaseWorkerGuardFetch();

    const completedBlockedManualRun = await blockedManualRun;

    assert.equal(
      completedBlockedManualRun.alreadyRunning,
      false,
      "the manual run holding the shared worker guard should complete normally"
    );
    assert.equal(completedBlockedManualRun.records.length, 1, "the blocked manual run should process one job");
  } finally {
    releaseWorkerGuardFetch?.();
    await closeServer(workerGuardServer);
  }

  // 一句话调喜好:意图解析 -> 写记忆 -> 排 discover_sources -> 下一轮策展真搜该主题。
  const preferenceServer = createApiServer({
    dataPath: join(tempDir, "preference-chat.json"),
    curationDataPath: join(tempDir, "preference-chat-curation.json"),
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const preferenceTopic = "强化学习";
    const firstPreference = await requestJsonFromServer(preferenceServer, "/api/agent/preferences", {
      method: "POST",
      body: { text: `我最近想搞懂${preferenceTopic}` }
    });

    assert.equal(firstPreference.understood, true, "the demo sentence should be understood deterministically");
    assert.equal(firstPreference.topic, preferenceTopic, "intent parsing should extract the topic");
    assert.equal(firstPreference.memoryChanged, true, "a new topic should change user memory");
    assert.equal(firstPreference.curation.queued, true, "a new topic should queue a discover_sources job");
    assert.ok(
      firstPreference.reply.includes(preferenceTopic) && firstPreference.reply.includes("关注方向"),
      "the confirmation should name the topic and the focus-area change"
    );
    assert.ok(
      firstPreference.events.some(
        (event) => event.field === "profile.interests" && event.nextValue?.includes(preferenceTopic)
      ),
      "the memory edit event should record the interests change"
    );

    const preferenceSnapshot = await requestJsonFromServer(preferenceServer, "/api/snapshot");
    const preferenceMemory = preferenceSnapshot.userMemories.find((record) => record.userId === "local-user")?.memory;
    const discoverJobs = preferenceSnapshot.curationJobs.filter(
      (record) => record.job.kind === "discover_sources" && record.job.topicId === preferenceTopic
    );

    assert.ok(
      preferenceMemory?.profile.interests.includes(preferenceTopic),
      "preference chat should persist the topic into profile.interests"
    );
    assert.equal(discoverJobs.length, 1, "preference chat should persist exactly one discover_sources job for the topic");

    const repeatedPreference = await requestJsonFromServer(preferenceServer, "/api/agent/preferences", {
      method: "POST",
      body: { text: `我最近想搞懂${preferenceTopic}` }
    });

    assert.equal(repeatedPreference.memoryChanged, false, "repeating the same topic should not change memory again");
    assert.equal(repeatedPreference.curation.queued, false, "repeating should not queue a duplicate discovery job");
    assert.equal(repeatedPreference.curation.alreadyQueued, true, "repeating should report the pending discovery job");
    assert.ok(
      repeatedPreference.reply.includes("本来就在"),
      "the repeated confirmation should honestly say the topic was already a focus area"
    );

    const confusedPreference = await requestJsonFromServer(preferenceServer, "/api/agent/preferences", {
      method: "POST",
      body: { text: "今天天气不错" }
    });

    assert.equal(confusedPreference.understood, false, "unrelated sentences should be rejected, not guessed");
    assert.ok(confusedPreference.reply.includes("没听懂"), "the rejection reply should coach the supported sentence");

    const unchangedSnapshot = await requestJsonFromServer(preferenceServer, "/api/snapshot");

    assert.equal(
      unchangedSnapshot.userMemories.find((record) => record.userId === "local-user")?.memory.profile.interests.length,
      1,
      "rejected or repeated sentences should leave interests with the single topic"
    );
    assert.equal(
      unchangedSnapshot.curationJobs.filter((record) => record.job.kind === "discover_sources").length,
      1,
      "rejected or repeated sentences should not queue extra discovery jobs"
    );

    // 关键闭环:兴趣写进记忆后,策展跑批会把这个 discover_sources 任务当已确认
    // 概念真的搜出来源候选(没有记忆写入时该任务会因概念未确认而空转)。
    const searchQueryCountBefore = observedSearchQueries.length;
    await requestJsonFromServer(preferenceServer, "/api/curation/run", { method: "POST", body: {} });
    const preferenceSearchQueries = observedSearchQueries.slice(searchQueryCountBefore);

    assert.ok(
      preferenceSearchQueries.some((query) => query.includes(preferenceTopic)),
      "the next curation run should actually search for the adjusted topic"
    );

    const ranSnapshot = await requestJsonFromServer(preferenceServer, "/api/snapshot");
    const ranDiscoverJob = ranSnapshot.curationJobs.find(
      (record) => record.job.kind === "discover_sources" && record.job.topicId === preferenceTopic
    );

    assert.equal(ranDiscoverJob?.status, "succeeded", "the preference discovery job should complete on the next run");
    assert.ok(
      ranSnapshot.sourceCandidates.some((record) => (record.candidate.conceptIds ?? []).includes(preferenceTopic)),
      "the run should persist source candidates aimed at the adjusted topic"
    );
  } finally {
    await closeServer(preferenceServer);
  }

  // 额度用尽时确认文案必须如实:记忆照写,但明说来源搜寻要等明天。
  const previousDailyBudgetLimit = process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET;
  process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET = "0";
  const zeroBudgetPreferenceServer = createApiServer({
    dataPath: join(tempDir, "preference-chat-zero-budget.json"),
    curationDataPath: join(tempDir, "preference-chat-zero-budget-curation.json"),
    mediaRootDir,
    enableFixtures: true,
    searchProvider: fakeSearchProvider
  });

  try {
    const budgetedPreference = await requestJsonFromServer(zeroBudgetPreferenceServer, "/api/agent/preferences", {
      method: "POST",
      body: { text: "我最近想搞懂智能体记忆" }
    });

    assert.equal(budgetedPreference.understood, true, "budget exhaustion should not block intent parsing");
    assert.equal(budgetedPreference.memoryChanged, true, "budget exhaustion should still write the memory change");
    assert.equal(budgetedPreference.curation.queued, false, "no discovery job fits inside a zero budget");
    assert.equal(budgetedPreference.curation.budgetExhausted, true, "the response should flag the exhausted budget");
    assert.ok(
      budgetedPreference.reply.includes("额度"),
      "the confirmation must admit the source hunt is deferred by the budget"
    );

    const zeroBudgetSnapshot = await requestJsonFromServer(zeroBudgetPreferenceServer, "/api/snapshot");

    assert.ok(
      zeroBudgetSnapshot.userMemories
        .find((record) => record.userId === "local-user")
        ?.memory.profile.interests.includes("智能体记忆"),
      "the interest should persist even when the discovery job is discarded"
    );
    assert.equal(
      zeroBudgetSnapshot.curationJobs.filter((record) => record.job.kind === "discover_sources").length,
      0,
      "a zero budget should leave no discovery job behind"
    );
  } finally {
    if (previousDailyBudgetLimit === undefined) {
      delete process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET;
    } else {
      process.env.AITIMELINE_DAILY_AUTO_JOB_BUDGET = previousDailyBudgetLimit;
    }

    await closeServer(zeroBudgetPreferenceServer);
  }

  console.log("API smoke passed");
} finally {
  globalThis.fetch = originalFetch;
  await closeServer(server);
  await rm(tempDir, { recursive: true, force: true });
  if (previousContentLanguage === undefined) {
    delete process.env.AITIMELINE_CONTENT_LANGUAGE;
  } else {
    process.env.AITIMELINE_CONTENT_LANGUAGE = previousContentLanguage;
  }

  if (previousTimelineTimeZone === undefined) {
    delete process.env.AITIMELINE_TIMEZONE;
  } else {
    process.env.AITIMELINE_TIMEZONE = previousTimelineTimeZone;
  }

  if (previousAllowPrivateFetch === undefined) {
    delete process.env.AITIMELINE_ALLOW_PRIVATE_FETCH;
  } else {
    process.env.AITIMELINE_ALLOW_PRIVATE_FETCH = previousAllowPrivateFetch;
  }

  if (previousAuthToken !== undefined) {
    process.env.AITIMELINE_AUTH_TOKEN = previousAuthToken;
  }

  if (previousCorsOrigins !== undefined) {
    process.env.AITIMELINE_CORS_ORIGINS = previousCorsOrigins;
  }
}

function getFetchUrl(input) {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

async function dispatchToServer(targetServer, url, options = {}) {
  const parsedUrl = new URL(url);
  const body = await normalizeRequestBody(options.body);
  const headers = {
    host: parsedUrl.host,
    ...(options.headers ? Object.fromEntries(new Headers(options.headers).entries()) : {})
  };
  const request = {
    method: options.method ?? "GET",
    url: `${parsedUrl.pathname}${parsedUrl.search}`,
    headers,
    destroyed: false,
    complete: false,
    destroy() {
      this.destroyed = true;
      options.onDestroy?.();
    },
    resume() {
      options.onResume?.();
    },
    async *[Symbol.asyncIterator]() {
      if (body.byteLength > 0) {
        yield body;
      }
    }
  };
  const response = createMockResponse();
  const handler = targetServer.listeners("request")[0];

  await new Promise((resolve, reject) => {
    response.done.then(resolve, reject);

    try {
      const handled = handler(request, response);
      Promise.resolve(handled).catch(reject);
    } catch (error) {
      reject(error);
    }
  });

  return new Response(response.body, {
    status: response.statusCode,
    headers: response.headers
  });
}

async function requestJsonFromServer(targetServer, path, options = {}) {
  const response = await dispatchToServer(targetServer, `${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const payload = await response.json();

  assert.equal(response.ok, true, `${path} should respond with 2xx: ${JSON.stringify(payload)}`);

  return payload;
}

async function normalizeRequestBody(body) {
  if (!body) {
    return Buffer.alloc(0);
  }

  if (typeof body === "string") {
    return Buffer.from(body);
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  if (body instanceof ArrayBuffer) {
    return Buffer.from(body);
  }

  return Buffer.from(String(body));
}

function createMockResponse() {
  const chunks = [];
  const headers = new Headers();
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  return {
    statusCode: 200,
    headers,
    done,
    get body() {
      return Buffer.concat(chunks);
    },
    setHeader(name, value) {
      headers.set(name, String(value));
    },
    writeHead(statusCode, nextHeaders = {}) {
      this.statusCode = statusCode;
      for (const [name, value] of Object.entries(nextHeaders)) {
        headers.set(name, String(value));
      }
    },
    write(chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    },
    end(chunk) {
      if (chunk) {
        this.write(chunk);
      }
      resolveDone();
    }
  };
}

async function closeServer(targetServer) {
  await new Promise((resolveClose) => {
    targetServer.close(() => resolveClose());
  });
}

async function listenOnTemporaryPort(targetServer) {
  return new Promise((resolveListen, rejectListen) => {
    targetServer.once("error", rejectListen);
    targetServer.listen(0, "127.0.0.1", () => {
      targetServer.off("error", rejectListen);
      resolveListen(targetServer.address());
    });
  });
}

function makeApiSmokePost({ id, title, concepts, createdAt = "2026-06-01T00:00:00.000Z" }) {
  return {
    id,
    title,
    hook: title,
    thesis: title,
    shortBody: title,
    summary: title,
    keyTakeaway: title,
    concepts,
    sources: [
      {
        id: `${id}-source`,
        title: `${title} source`,
        url: `https://example.com/${id}`,
        type: "article"
      }
    ],
    citations: [],
    recommendedBecause: "Smoke fixture.",
    trustState: "supported",
    createdAt,
    estimatedReadMinutes: 1,
    difficulty: "beginner",
    confidence: "high",
    thread: [],
    graphEdges: concepts.slice(0, -1).map((concept, index) => ({
      id: `${id}-edge-${index + 1}`,
      sourceConcept: concept,
      relation: "extends",
      targetConcept: concepts[index + 1],
      evidence: `${title} links ${concept} to ${concepts[index + 1]}.`,
      weight: 0.72
    })),
    reviewPrompts: [],
    nextActions: [],
    harnessVersion: "smoke"
  };
}

function makeReviewGradePost(id, title, concept) {
  return {
    ...makeApiSmokePost({ id, title, concepts: [concept] }),
    reviewPrompts: [1, 3, 7].map((dueInDays) => ({
      id: `${id}-prompt-${dueInDays}`,
      kind: dueInDays === 1 ? "recall" : dueInDays === 3 ? "compare" : "apply",
      prompt: `${title} prompt for day ${dueInDays}`,
      answerHint: `${title} answer for day ${dueInDays}`,
      dueInDays
    }))
  };
}

function makeInteractionSignalRecord(post, { liked = false, saved = false, createdAt = "2026-06-01T00:00:00.000Z" } = {}) {
  const topicId = post.concepts[0] ?? post.id;
  const signal = {
    postId: post.id,
    topicId,
    conceptIds: post.concepts,
    impression: true,
    dwellTimeMs: 0,
    openedThread: false,
    liked,
    saved,
    askedQuestion: false,
    reviewed: false,
    skippedQuickly: false,
    createdAt
  };

  return {
    id: `signal-${post.id}-${createdAt}`,
    signal,
    feedback: {
      postId: post.id,
      topicId,
      conceptIds: post.concepts,
      signalStrength: liked || saved ? 1 : 0,
      inferredState: liked || saved ? "interested" : "not_relevant",
      nextAction: liked || saved ? "schedule_review" : "continue_deeper",
      reason: "Smoke fixture."
    },
    createdAt
  };
}

function makeSourceCandidateRecord({
  id,
  url,
  score,
  status = "pending",
  concept = "Supply",
  createdAt = "2026-07-08T00:00:00.000Z"
}) {
  const sourceId = `article-${id}`;

  return {
    id,
    candidate: {
      id,
      source: {
        id: sourceId,
        title: `Source candidate ${id}`,
        url,
        type: "article"
      },
      topicId: concept,
      conceptIds: [concept],
      relevanceScore: score,
      noveltyScore: score,
      qualityScore: score,
      reason: `Candidate ${id} is ranked for supply refill.`,
      discoveredAt: createdAt
    },
    status,
    intakeKind: "agent_discovery",
    createdAt,
    updatedAt: createdAt
  };
}

function makeQueuedImportJobRecord(candidateRecord, createdAt) {
  return {
    id: `queued-import-${candidateRecord.candidate.id}`,
    job: {
      id: `queued-import-${candidateRecord.candidate.id}`,
      kind: "import_source",
      topicId: candidateRecord.candidate.topicId,
      conceptIds: candidateRecord.candidate.conceptIds,
      priority: 0.7,
      reason: "Existing queued import smoke fixture.",
      createdAt,
      runAfter: createdAt,
      sourceCandidate: candidateRecord.candidate
    },
    status: "queued",
    attempts: 0,
    createdAt,
    updatedAt: createdAt
  };
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json();

  assert.equal(response.ok, true, `${options.method ?? "GET"} ${path} failed: ${JSON.stringify(payload)}`);

  return payload;
}

function makeWorkerSmokeFetchResponse(title) {
  return new Response(
    `
      <html>
        <head><meta property="og:title" content="${title}" /></head>
        <body>
          <article>
            <p>The API-owned observer worker processes due background jobs without relying on a visible browser page.</p>
          </article>
        </body>
      </html>
    `,
    { status: 200, headers: { "content-type": "text/html" } }
  );
}

function isTerminalCurationStatus(status) {
  return status === "succeeded" || status === "failed" || status === "skipped";
}

async function delay(durationMs) {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, durationMs));
}

async function waitForCurationJob(
  targetServer,
  jobId,
  predicate,
  { timeoutMs, description }
) {
  const deadline = Date.now() + timeoutMs;
  let latestRecord;
  let latestJobs = [];

  while (Date.now() < deadline) {
    const payload = await requestJsonFromServer(targetServer, "/api/curation/jobs");
    latestJobs = payload.jobs;
    latestRecord = latestJobs.find((record) => record.id === jobId);

    if (predicate(latestRecord)) {
      return latestRecord;
    }

    await delay(20);
  }

  assert.fail(
    `Timed out after ${timeoutMs}ms waiting for ${description}; ` +
      `latest=${JSON.stringify(latestRecord ?? null)}; ` +
      `jobs=${JSON.stringify(latestJobs.map((record) => ({ id: record.id, status: record.status })))}`
  );
}

async function waitForWorkerStatus(
  targetServer,
  predicate,
  { timeoutMs, description }
) {
  const deadline = Date.now() + timeoutMs;
  let latestStatus;

  while (Date.now() < deadline) {
    const timeline = await requestJsonFromServer(targetServer, "/api/timeline");
    latestStatus = timeline.workerStatus;

    if (predicate(latestStatus)) {
      return latestStatus;
    }

    await delay(20);
  }

  assert.fail(
    `Timed out after ${timeoutMs}ms waiting for ${description}; latest=${JSON.stringify(latestStatus ?? null)}`
  );
}

async function waitForFetchCount(
  fetchUrls,
  expectedCount,
  { timeoutMs, description }
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline && fetchUrls.length < expectedCount) {
    await delay(5);
  }

  assert.equal(
    fetchUrls.length,
    expectedCount,
    `Timed out after ${timeoutMs}ms waiting for ${description}; fetches=${JSON.stringify(fetchUrls)}`
  );
}
