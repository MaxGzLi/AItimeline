// @ts-check

import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { parseEnv } from "node:util";

export const desktopOrigin = "app://aitimeline";

export const defaultApiCorsOrigins = Object.freeze([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:5198",
  "http://localhost:5198"
]);

/**
 * Load one .env-format file without replacing variables already present in the
 * destination environment.
 *
 * @param {string} filePath
 * @param {NodeJS.ProcessEnv} [environment]
 * @returns {string[]} names added to the environment
 */
export function loadEnvironmentFile(filePath, environment = process.env) {
  if (!existsSync(filePath)) return [];

  const parsed = parseEnv(readFileSync(filePath, "utf8"));
  const loaded = [];

  for (const [name, value] of Object.entries(parsed)) {
    if (environment[name] !== undefined) continue;
    environment[name] = value;
    loaded.push(name);
  }

  return loaded;
}

/**
 * @param {{ isPackaged: boolean, userDataPath: string, repoRoot: string }} input
 */
export function resolveDataPaths({ isPackaged, userDataPath, repoRoot }) {
  const dataRoot = isPackaged ? resolve(userDataPath) : resolve(repoRoot, "apps/api/data");

  return {
    dataRoot,
    dataPath: resolve(dataRoot, "aitimeline.json"),
    curationDataPath: resolve(dataRoot, "curation-jobs.json"),
    mediaRootDir: resolve(dataRoot, "media")
  };
}

/**
 * The API treats an explicit CORS list as a replacement, so the desktop shell
 * carries its browser defaults forward before adding configured and app origins.
 *
 * @param {string | undefined} configuredOrigins
 */
export function buildDesktopCorsOrigins(configuredOrigins) {
  const configured = typeof configuredOrigins === "string"
    ? configuredOrigins.split(",").map((value) => value.trim()).filter(Boolean)
    : [];

  return [...new Set([...defaultApiCorsOrigins, ...configured, desktopOrigin])];
}

/**
 * Resolve an app:// request to a known file. Missing routes fall back to the
 * SPA entry point, while malformed or traversing paths are rejected.
 *
 * @param {string} requestUrl
 * @param {string} webDistDir
 * @param {(filePath: string) => boolean} [isFile]
 * @returns {string | undefined}
 */
export function resolveStaticAssetPath(requestUrl, webDistDir, isFile = isRegularFile) {
  let parsed;

  try {
    parsed = new URL(requestUrl);
  } catch {
    return undefined;
  }

  if (
    parsed.protocol !== "app:" ||
    parsed.hostname !== "aitimeline" ||
    parsed.username ||
    parsed.password ||
    parsed.port
  ) {
    return undefined;
  }

  const schemeIndex = requestUrl.indexOf("://");
  const authorityEndCandidates = [
    requestUrl.indexOf("?", schemeIndex + 3),
    requestUrl.indexOf("#", schemeIndex + 3)
  ].filter((index) => index !== -1);
  const authorityEnd = authorityEndCandidates.length ? Math.min(...authorityEndCandidates) : requestUrl.length;
  const pathIndex = schemeIndex === -1 ? -1 : requestUrl.indexOf("/", schemeIndex + 3);
  const rawPath = pathIndex === -1 || pathIndex >= authorityEnd
    ? "/"
    : requestUrl.slice(pathIndex, authorityEnd);
  let decodedPath;

  try {
    decodedPath = decodeURIComponent(rawPath).replaceAll("\\", "/");
  } catch {
    return undefined;
  }

  if (decodedPath.includes("\0")) return undefined;

  const segments = decodedPath.split("/");
  if (segments.includes("..")) return undefined;

  const relativePath = segments.filter((segment) => segment && segment !== ".").join("/");
  const candidatePath = resolve(webDistDir, relativePath || "index.html");
  const candidateRelative = relative(webDistDir, candidatePath);

  if (candidateRelative.startsWith("..") || isAbsolute(candidateRelative)) {
    return undefined;
  }

  if (isFile(candidatePath)) return candidatePath;

  const fallbackPath = resolve(webDistDir, "index.html");
  return isFile(fallbackPath) ? fallbackPath : undefined;
}

/**
 * @param {string} filePath
 */
function isRegularFile(filePath) {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * @param {string} importPath
 * @returns {Record<string, string> | undefined}
 */
export function readLocalStorageImport(importPath) {
  if (!existsSync(importPath)) return undefined;

  const parsed = JSON.parse(readFileSync(importPath, "utf8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    !Object.values(parsed).every((value) => typeof value === "string")
  ) {
    throw new Error("import-localstorage.json must contain a JSON object whose values are strings.");
  }

  return /** @type {Record<string, string>} */ (parsed);
}

/**
 * @param {unknown} error
 * @param {string} code
 */
export function hasErrorCode(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

/**
 * Listen on the first free preferred port, falling back to an
 * operating-system-assigned port only when every preferred port is occupied.
 *
 * The browser extension can only reach ports it declares in `host_permissions`,
 * so the preferred list has to stay short and stable — an OS-assigned port is
 * reachable by the desktop window but not by the extension.
 *
 * @param {import("node:http").Server} server
 * @param {number | readonly number[]} preferredPorts
 * @param {string} host
 */
export async function listenWithPortFallback(server, preferredPorts, host) {
  const candidates = typeof preferredPorts === "number" ? [preferredPorts] : preferredPorts;
  for (const port of candidates) {
    try {
      return await listenOnce(server, port, host);
    } catch (error) {
      if (!hasErrorCode(error, "EADDRINUSE")) throw error;
    }
  }
  return listenOnce(server, 0, host);
}

/**
 * @param {import("node:http").Server} server
 * @param {number} port
 * @param {string} host
 * @returns {Promise<import("node:net").AddressInfo>}
 */
function listenOnce(server, port, host) {
  return new Promise((resolveListen, rejectListen) => {
    const cleanup = () => {
      server.off("error", onError);
      server.off("listening", onListening);
    };
    /** @param {Error} error */
    const onError = (error) => {
      cleanup();
      rejectListen(error);
    };
    const onListening = () => {
      cleanup();
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectListen(new Error("AITimeline API did not report a TCP address."));
        return;
      }
      resolveListen(address);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}
