// AITimeline Clipper — background service worker.
// The content script cannot fetch 127.0.0.1 from the page origin (CORS), so
// every save is relayed here and posted with the extension's host permission.

const API_BASE = "http://127.0.0.1:8787";

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
  fetch(`${API_BASE}/api/curation/run`, {
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

async function saveTweet(tweet) {
  const response = await fetch(`${API_BASE}/api/captures/source`, {
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
