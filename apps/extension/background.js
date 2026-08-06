// AITimeline Clipper — background service worker.
// The content script cannot fetch 127.0.0.1 from the page origin (CORS), so
// every save is relayed here and posted with the extension's host permission.

// The API answers on 8787 when it is started from the repo (`npm run dev:api`)
// and on the first free port of this list when it is embedded in the desktop
// app. Both have to be declared in the manifest's host_permissions, so the list
// stays short: probe them in order and remember whichever answers.
const API_BASE_CANDIDATES = ["http://127.0.0.1:8787", "http://127.0.0.1:8788"];

let resolvedApiBase = null;

async function resolveApiBase() {
  if (resolvedApiBase) {
    return resolvedApiBase;
  }

  for (const base of API_BASE_CANDIDATES) {
    try {
      const response = await fetch(`${base}/health`);

      if (response.ok) {
        resolvedApiBase = base;

        return base;
      }
    } catch {
      // Nothing listening on this candidate; try the next one.
    }
  }

  // Nothing answered. Return the first candidate anyway so the caller fails with
  // a real connection error the user can act on.
  return API_BASE_CANDIDATES[0];
}

// Every request goes through here so a moved port (dev API stopped, desktop app
// started, or the other way round) costs one retry instead of a broken session.
async function apiFetch(path, init) {
  const base = await resolveApiBase();

  try {
    return await fetch(`${base}${path}`, init);
  } catch (error) {
    resolvedApiBase = null;

    const retryBase = await resolveApiBase();

    if (retryBase === base) {
      throw error;
    }

    return fetch(`${retryBase}${path}`, init);
  }
}

// After a successful save, nudge the curation worker so the clip becomes a
// card in seconds instead of waiting for the next worker poll. Fire-and-forget:
// the worker picks the job up on its own schedule anyway, so a failed nudge
// must never surface as a save error. Throttled so clipping several tweets in
// a row triggers at most one run per window (the API also serializes runs).
const CURATION_NUDGE_INTERVAL_MS = 5000;
let lastCurationNudgeAt = 0;

function nudgeCurationRun() {
  const now = Date.now();

  if (now - lastCurationNudgeAt < CURATION_NUDGE_INTERVAL_MS) {
    return;
  }

  lastCurationNudgeAt = now;
  apiFetch("/api/curation/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  }).catch(() => {});
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "AITL_SAVE_TWEET") {
    return undefined;
  }

  saveTweet(message.tweet).then(sendResponse, (error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  });

  // Keep the message channel open for the async response.
  return true;
});

// ---- 注入面(inject.js)的消息:拉可注入的卡 + 转发行为信号。 ----
// 单独一个 listener,不动上面剪藏的代码;不认识的消息返回 undefined 让别的 listener 接。

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || (message.type !== "AITL_FETCH_INJECT_CARDS" && message.type !== "AITL_SEND_SIGNAL")) {
    return undefined;
  }

  const task =
    message.type === "AITL_FETCH_INJECT_CARDS" ? fetchInjectCards() : sendInteractionSignal(message.signal);

  task.then(sendResponse, (error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  });

  // Keep the message channel open for the async response.
  return true;
});

async function fetchInjectCards() {
  const response = await apiFetch("/api/inject/cards");
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload && payload.error ? payload.error : `AITimeline API responded ${response.status}.`);
  }

  return { ok: true, cards: Array.isArray(payload && payload.cards) ? payload.cards : [] };
}

async function sendInteractionSignal(signal) {
  const response = await apiFetch("/api/signals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      generatedAt: new Date().toISOString(),
      signal,
      sourceCandidates: []
    })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);

    throw new Error(payload && payload.error ? payload.error : `AITimeline API responded ${response.status}.`);
  }

  return { ok: true };
}

async function saveTweet(tweet) {
  const response = await apiFetch("/api/captures/source", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: tweet.url,
      capturedText: tweet.text,
      title: tweet.handle ? `${tweet.author} (${tweet.handle}) · X` : `${tweet.author} · X`,
      author: tweet.author || undefined,
      publishedAt: tweet.postedAt || undefined,
      intakeKind: "browser_share",
      reason: "Saved from X via the AITimeline extension."
    })
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload && payload.error ? payload.error : `AITimeline API responded ${response.status}.`);
  }

  nudgeCurationRun();

  return { ok: true, status: payload.status, alreadyKnown: Boolean(payload.alreadyKnown) };
}
