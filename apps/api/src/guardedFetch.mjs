import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;
const ALLOWED_CONTENT_TYPES = new Set([
  "text/html",
  "text/plain",
  "application/xml",
  "text/xml",
  "application/rss+xml",
  "application/atom+xml",
  "application/json",
  "application/xhtml+xml",
  // Image types must match imageExtensionsByMimeType in core's arxivHtmlImport:
  // figure caching reuses the same injected fetch and fails silently when blocked.
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/svg+xml",
  "image/webp"
]);

export class GuardedFetchError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "GuardedFetchError";
    this.code = code;
  }
}

export function createGuardedFetch(options = {}) {
  const resolver = options.resolver ?? defaultResolver;
  const allowPrivate = options.allowPrivate ?? process.env.AITIMELINE_ALLOW_PRIVATE_FETCH === "true";
  const connectTimeoutMs = positiveInteger(options.connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT_MS);
  const totalTimeoutMs = positiveInteger(options.totalTimeoutMs, DEFAULT_TOTAL_TIMEOUT_MS);
  const maxResponseBytes = positiveInteger(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES);
  const maxRedirects = nonNegativeInteger(options.maxRedirects, DEFAULT_MAX_REDIRECTS);
  const requestImpl = options.requestImpl;

  return async function guardedFetch(input, init = {}) {
    const initialUrl = toUrl(input);
    const deadline = Date.now() + totalTimeoutMs;
    let url = initialUrl;
    let requestInit = normalizeInit(input, init);

    for (let redirectCount = 0; ; redirectCount += 1) {
      const response = await requestOnce(url, requestInit, {
        resolver,
        allowPrivate,
        connectTimeoutMs,
        deadline,
        maxResponseBytes,
        requestImpl
      });

      if (!isRedirect(response.status) || requestInit.redirect === "manual") {
        return response;
      }

      if (requestInit.redirect === "error") {
        throw new GuardedFetchError("FETCH_REDIRECT_BLOCKED", "Redirect responses are not allowed.");
      }

      const location = response.headers.get("location");
      if (!location) {
        return response;
      }

      if (redirectCount >= maxRedirects) {
        throw new GuardedFetchError("FETCH_REDIRECT_LIMIT", `Fetch exceeded the ${maxRedirects}-redirect limit.`);
      }

      url = new URL(location, url);
      requestInit = redirectedInit(requestInit, response.status);
    }
  };
}

export const guardedFetch = createGuardedFetch();

async function requestOnce(url, init, limits) {
  assertHttpProtocol(url);
  throwIfAborted(init.signal);
  throwIfDeadlineExceeded(limits.deadline);

  const addresses = await resolveAddresses(url.hostname, limits.resolver, limits.deadline);
  if (!limits.allowPrivate) {
    const blocked = addresses.find(({ address }) => isPrivateAddress(address));
    if (blocked) {
      throw new GuardedFetchError(
        "FETCH_PRIVATE_ADDRESS_BLOCKED",
        `Fetch target resolved to a private or local address (${blocked.address}).`
      );
    }
  }

  const target = addresses[0];
  if (limits.requestImpl) {
    return limits.requestImpl(url, init, { address: target.address, family: target.family });
  }
  const headers = new Headers(init.headers);
  if (!headers.has("host")) headers.set("host", url.host);
  if (!headers.has("accept-encoding")) headers.set("accept-encoding", "identity");
  const body = normalizeRequestBody(init.body);
  const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    let settled = false;
    let connectTimer;
    const remainingMs = Math.max(1, limits.deadline - Date.now());
    const totalTimer = setTimeout(() => {
      fail(new GuardedFetchError("FETCH_TOTAL_TIMEOUT", "Fetch exceeded the total timeout."));
      request.destroy();
    }, remainingMs);
    const request = requestFn({
      protocol: url.protocol,
      hostname: target.address,
      port: url.port || undefined,
      method: init.method,
      path: `${url.pathname}${url.search}`,
      headers: Object.fromEntries(headers.entries()),
      ...(url.protocol === "https:" && isIP(url.hostname) === 0 ? { servername: url.hostname } : {})
    });

    const cleanup = () => {
      clearTimeout(totalTimer);
      clearTimeout(connectTimer);
      init.signal?.removeEventListener("abort", abortRequest);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const succeed = (response) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(response);
    };
    const abortRequest = () => {
      const error = init.signal?.reason instanceof Error
        ? init.signal.reason
        : new DOMException("The operation was aborted.", "AbortError");
      fail(error);
      request.destroy(error);
    };

    init.signal?.addEventListener("abort", abortRequest, { once: true });
    request.once("socket", (socket) => {
      if (!socket.connecting) return;
      connectTimer = setTimeout(() => {
        const error = new GuardedFetchError("FETCH_CONNECT_TIMEOUT", "Fetch connection timed out.");
        fail(error);
        request.destroy(error);
      }, Math.min(limits.connectTimeoutMs, Math.max(1, limits.deadline - Date.now())));
      const connectedEvent = url.protocol === "https:" ? "secureConnect" : "connect";
      socket.once(connectedEvent, () => clearTimeout(connectTimer));
    });
    request.once("error", fail);
    request.once("response", async (incoming) => {
      try {
        const responseHeaders = headersFromIncoming(incoming.headers);
        const status = incoming.statusCode ?? 0;

        if (isRedirect(status)) {
          incoming.resume();
          succeed(new Response(null, { status, headers: responseHeaders }));
          return;
        }

        assertAllowedContentType(responseHeaders.get("content-type"));
        const responseBody = await readLimitedBody(
          decodedResponseStream(incoming, responseHeaders.get("content-encoding")),
          limits.maxResponseBytes
        );
        responseHeaders.delete("content-encoding");
        responseHeaders.delete("content-length");
        succeed(new Response(responseBody, { status, headers: responseHeaders }));
      } catch (error) {
        incoming.destroy();
        fail(error);
      }
    });

    if (body) request.write(body);
    request.end();
  });
}

async function defaultResolver(hostname) {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

async function resolveAddresses(hostname, resolver, deadline) {
  const literalFamily = isIP(hostname);
  if (literalFamily) return [{ address: hostname, family: literalFamily }];

  let resolved;
  try {
    resolved = await waitWithinDeadline(resolver(hostname), deadline);
  } catch (error) {
    if (error instanceof GuardedFetchError) throw error;
    throw new GuardedFetchError("FETCH_DNS_FAILED", "Fetch target could not be resolved.", { cause: error });
  }

  const entries = (Array.isArray(resolved) ? resolved : [resolved])
    .map((entry) => typeof entry === "string" ? { address: entry, family: isIP(entry) } : entry)
    .filter((entry) => entry && typeof entry.address === "string" && isIP(entry.address));
  if (!entries.length) {
    throw new GuardedFetchError("FETCH_DNS_FAILED", "Fetch target did not resolve to an IP address.");
  }
  return entries;
}

async function waitWithinDeadline(promise, deadline) {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new GuardedFetchError("FETCH_TOTAL_TIMEOUT", "Fetch exceeded the total timeout.");
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new GuardedFetchError("FETCH_TOTAL_TIMEOUT", "Fetch exceeded the total timeout.")),
          remainingMs
        );
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function isPrivateAddress(address) {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family !== 6) return true;

  const normalized = address.toLowerCase().split("%")[0];
  const words = parseIpv6Words(normalized);
  const mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff
    ? `${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`
    : undefined;
  if (mapped) return isPrivateIpv4(mapped);
  const unspecified = words.every((word) => word === 0);
  const loopback = words.slice(0, 7).every((word) => word === 0) && words[7] === 1;
  return unspecified || loopback || (words[0] & 0xfe00) === 0xfc00 || (words[0] & 0xffc0) === 0xfe80;
}

function isPrivateIpv4(address) {
  const octets = address.split(".").map(Number);
  return (
    octets[0] === 127 ||
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 169 && octets[1] === 254) ||
    // All of 0.0.0.0/8: Linux routes "this network" addresses to loopback.
    octets[0] === 0
  );
}

function parseIpv6Words(address) {
  let normalized = address;
  const dottedTail = /(?:^|:)(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)?.[1];
  if (dottedTail) {
    const octets = dottedTail.split(".").map(Number);
    normalized = normalized.slice(0, -dottedTail.length) +
      `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const [left = "", right = ""] = normalized.split("::");
  const leftWords = left ? left.split(":").map((part) => Number.parseInt(part, 16)) : [];
  const rightWords = right ? right.split(":").map((part) => Number.parseInt(part, 16)) : [];
  const missing = 8 - leftWords.length - rightWords.length;
  return [...leftWords, ...Array(Math.max(0, missing)).fill(0), ...rightWords];
}

function decodedResponseStream(stream, encoding) {
  switch ((encoding ?? "").trim().toLowerCase()) {
    case "gzip": return stream.pipe(createGunzip());
    case "deflate": return stream.pipe(createInflate());
    case "br": return stream.pipe(createBrotliDecompress());
    default: return stream;
  }
}

async function readLimitedBody(stream, maxBytes) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.byteLength;
    if (bytes > maxBytes) {
      throw new GuardedFetchError("FETCH_RESPONSE_TOO_LARGE", `Fetch response exceeded ${maxBytes} bytes.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, bytes);
}

function assertAllowedContentType(value) {
  const mediaType = (value ?? "").split(";", 1)[0].trim().toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.has(mediaType)) {
    throw new GuardedFetchError("FETCH_CONTENT_TYPE_BLOCKED", "Fetch response content type is not allowed.");
  }
}

function assertHttpProtocol(url) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new GuardedFetchError("FETCH_PROTOCOL_BLOCKED", "Only http and https URLs are allowed.");
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

function throwIfDeadlineExceeded(deadline) {
  if (Date.now() >= deadline) {
    throw new GuardedFetchError("FETCH_TOTAL_TIMEOUT", "Fetch exceeded the total timeout.");
  }
}

function normalizeInit(input, init) {
  const request = input instanceof Request ? input : undefined;
  return {
    method: (init.method ?? request?.method ?? "GET").toUpperCase(),
    headers: init.headers ?? request?.headers,
    body: init.body,
    signal: init.signal ?? request?.signal,
    redirect: init.redirect ?? request?.redirect ?? "follow"
  };
}

function redirectedInit(init, status) {
  if (status === 303 || ((status === 301 || status === 302) && init.method === "POST")) {
    const headers = new Headers(init.headers);
    headers.delete("content-length");
    headers.delete("content-type");
    return { ...init, method: "GET", body: undefined, headers };
  }
  return init;
}

function normalizeRequestBody(body) {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string" || Buffer.isBuffer(body) || body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (body instanceof URLSearchParams) return body.toString();
  throw new TypeError("guardedFetch only supports buffered request bodies.");
}

function toUrl(input) {
  try {
    return new URL(input instanceof Request ? input.url : input);
  } catch (error) {
    throw new GuardedFetchError("FETCH_INVALID_URL", "Fetch URL is invalid.", { cause: error });
  }
}

function headersFromIncoming(headers) {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) value.forEach((item) => result.append(name, item));
    else if (value !== undefined) result.set(name, value);
  }
  return result;
}

function isRedirect(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}
