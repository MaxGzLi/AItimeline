// @ts-check

import { existsSync, readFileSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { HttpError } from "../domains/shared.mjs";
import { requireObjectBody } from "./validate.mjs";

const defaultCorsOrigins = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:5198",
  "http://localhost:5198"
];

const maxJsonBodyBytes = 1024 * 1024;

export function rejectOversizedContentLength(request, response) {
  const header = request.headers?.["content-length"];
  const value = Array.isArray(header) ? header[0] : header;

  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
    return false;
  }

  const contentLength = Number(value);

  if (Number.isSafeInteger(contentLength) && contentLength <= maxJsonBodyBytes) {
    return false;
  }

  response.setHeader("Connection", "close");
  response.shouldKeepAlive = false;
  sendJson(response, 413, { error: "Request body is too large." });
  safelyDrainRequest(request);
  return true;
}

export function safelyDrainRequest(request) {
  if (typeof request.resume === "function" && !request.destroyed && !request.complete) {
    request.resume();
  }
}

export async function readJsonBody(request) {
  const chunks = [];
  let totalBytes = 0;
  const iterator =
    typeof request.iterator === "function"
      ? request.iterator({ destroyOnReturn: false })
      : request[Symbol.asyncIterator]();
  const iterable = { [Symbol.asyncIterator]: () => iterator };

  for await (const input of iterable) {
    const chunk = Buffer.isBuffer(input) ? input : Buffer.from(input);
    totalBytes += chunk.byteLength;

    if (totalBytes > maxJsonBodyBytes) {
      chunks.length = 0;
      throw new HttpError(413, "Request body is too large.");
    }

    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  let parsedBody;

  try {
    parsedBody = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    throw new HttpError(400, "Request body is not valid JSON.");
  }

  return requireObjectBody(parsedBody);
}

export function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload, null, 2));
}

export function sendMediaFile(response, mediaRootDir, pathname) {
  let relativePath = "";

  try {
    relativePath = decodeURIComponent(pathname.replace(/^\/media\//, ""));
  } catch {
    sendJson(response, 400, { error: "Media path is not valid." });
    return;
  }

  if (!relativePath || relativePath.includes("\0")) {
    sendJson(response, 404, { error: "Media not found." });
    return;
  }

  const filePath = resolve(mediaRootDir, relativePath);
  const safeRelativePath = relative(mediaRootDir, filePath);

  if (safeRelativePath.startsWith("..") || isAbsolute(safeRelativePath)) {
    sendJson(response, 404, { error: "Media not found." });
    return;
  }

  if (!existsSync(filePath)) {
    sendJson(response, 404, { error: "Media not found." });
    return;
  }

  const contentType = getMediaContentType(filePath);

  if (!contentType) {
    sendJson(response, 404, { error: "Media not found." });
    return;
  }

  try {
    const bytes = readFileSync(filePath);

    response.writeHead(200, { "content-type": contentType });
    response.end(bytes);
  } catch {
    sendJson(response, 404, { error: "Media not found." });
  }
}

function getMediaContentType(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    default:
      return undefined;
  }
}

export function sendHtml(response, html) {
  response.writeHead(200, { "content-type": "text/html" });
  response.end(html);
}

export function sendXml(response, xml) {
  response.writeHead(200, { "content-type": "application/rss+xml" });
  response.end(xml);
}

export function getRequestOrigin(request) {
  return `http://${request.headers.host ?? "127.0.0.1"}`;
}

export function createBindingSecurity(host, tokenValue) {
  const authToken = typeof tokenValue === "string" ? tokenValue.trim() : "";
  if (!isLoopbackHost(host) && !authToken) {
    throw new Error(
      `Refusing to bind AITimeline API to non-loopback host "${host}" without authentication. ` +
      "Set AITIMELINE_AUTH_TOKEN to a non-empty secret before starting the server."
    );
  }
  // A configured token is enforced even on loopback: setting a secret and
  // having it silently ignored would be worse than requiring the header.
  return { host, requireAuth: Boolean(authToken), authToken };
}

function isLoopbackHost(hostValue) {
  const host = String(hostValue).trim().toLowerCase().replace(/^\[|\]$/g, "");
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function hasValidApiToken(request, expectedToken) {
  const authorization = request.headers.authorization;
  const bearer = typeof authorization === "string" && /^Bearer\s+(.+)$/i.exec(authorization)?.[1];
  const alternate = request.headers["x-aitimeline-token"];
  return bearer === expectedToken || alternate === expectedToken;
}

export function resolveCorsOrigins(optionValue, environmentValue) {
  const configured = optionValue ?? environmentValue;
  const values = configured === undefined
    ? defaultCorsOrigins
    : Array.isArray(configured) ? configured : String(configured).split(",");
  return new Set(values.map((value) => String(value).trim()).filter(Boolean));
}
