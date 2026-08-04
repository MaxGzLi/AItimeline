// AITimeline Clipper — background service worker.
// The content script cannot fetch 127.0.0.1 from the page origin (CORS), so
// every save is relayed here and posted with the extension's host permission.

const API_BASE = "http://127.0.0.1:8787";
const LOCAL_API_DOWN_MESSAGE = "本机 AITimeline 没有运行(127.0.0.1:8787),启动后点击重试";

/** fetch 连不上(TypeError)几乎只有一个原因:本机 API 没起。说人话。 */
function describeRelayError(error) {
  if (error instanceof TypeError) {
    return LOCAL_API_DOWN_MESSAGE;
  }

  return error instanceof Error ? error.message : String(error);
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
  fetch(`${API_BASE}/api/curation/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  }).catch(() => {});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "AITL_SAVE_TWEET") {
    return undefined;
  }

  saveTweet(message.tweet, sender.tab ? sender.tab.id : null).then(sendResponse, (error) => {
    sendResponse({ ok: false, error: describeRelayError(error) });
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
    sendResponse({ ok: false, error: describeRelayError(error) });
  });

  // Keep the message channel open for the async response.
  return true;
});

// ---- 分类条上下文 + 扩展图标 badge。 ----

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || (message.type !== "AITL_FETCH_CAPTURE_CONTEXT" && message.type !== "AITL_SET_BADGE")) {
    return undefined;
  }

  if (message.type === "AITL_SET_BADGE") {
    const count = Number(message.count) || 0;

    chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });

    if (count > 0) {
      chrome.action.setBadgeBackgroundColor({ color: "#1d9bf0" });
    }

    sendResponse({ ok: true });
    return undefined;
  }

  fetchCaptureContext().then(sendResponse, (error) => {
    sendResponse({ ok: false, error: describeRelayError(error) });
  });

  // Keep the message channel open for the async response.
  return true;
});

async function fetchInjectCards() {
  const response = await fetch(`${API_BASE}/api/inject/cards`);
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload && payload.error ? payload.error : `AITimeline API responded ${response.status}.`);
  }

  return { ok: true, cards: Array.isArray(payload && payload.cards) ? payload.cards : [] };
}

async function sendInteractionSignal(signal) {
  const response = await fetch(`${API_BASE}/api/signals`, {
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

async function fetchCaptureContext() {
  const response = await fetch(`${API_BASE}/api/captures/context`);
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload && payload.error ? payload.error : `AITimeline API responded ${response.status}.`);
  }

  // 分类候选 = 兴趣主题(按分数排好)+ 活跃学习目标,去重给 content script。
  const topics = [];

  for (const item of Array.isArray(payload && payload.topics) ? payload.topics : []) {
    if (item && typeof item.topicId === "string" && item.topicId.trim()) {
      topics.push(item.topicId.trim());
    }
  }

  for (const goal of Array.isArray(payload && payload.learningGoals) ? payload.learningGoals : []) {
    if (goal && typeof goal.concept === "string" && goal.concept.trim()) {
      topics.push(goal.concept.trim());
    }
  }

  return { ok: true, topics: Array.from(new Set(topics)) };
}

function buildCaptureBody(tweet) {
  return {
    url: tweet.url,
    capturedText: tweet.text,
    title: tweet.handle ? `${tweet.author} (${tweet.handle}) · X` : `${tweet.author} · X`,
    author: tweet.author || undefined,
    publishedAt: tweet.postedAt || undefined,
    topic: tweet.topic || undefined,
    intakeKind: "browser_share",
    reason: "Saved from X via the AITimeline extension."
  };
}

// ---- 成卡回执:保存后轮询同一 URL 的幂等 capture 接口,status 变 imported
// 就通知发起页。MV3 service worker 空闲 ~30 秒会被杀,这里 2.5 秒一次 fetch
// 保持活跃,90 秒封顶;被杀就没有回执(下次保存/刷新自然看到「已存过」),
// 不为此上 chrome.alarms。 ----

const RECEIPT_POLL_INTERVAL_MS = 2500;
const RECEIPT_POLL_DEADLINE_MS = 90000;
const activeReceiptPolls = new Set();

function watchCaptureImported(tweet, tabId) {
  if (tabId === null || activeReceiptPolls.has(tweet.url)) {
    return;
  }

  activeReceiptPolls.add(tweet.url);

  const startedAt = Date.now();
  const poll = async () => {
    let terminal = false;

    try {
      const response = await fetch(`${API_BASE}/api/captures/source`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildCaptureBody(tweet))
      });
      const payload = await response.json().catch(() => null);

      if (response.ok && payload) {
        if (payload.status === "imported") {
          terminal = true;
          chrome.tabs.sendMessage(
            tabId,
            { type: "AITL_CAPTURE_IMPORTED", url: tweet.url, postId: payload.postId ?? null },
            () => {
              // 标签页可能已关闭/导航走了,回执丢了就丢了。
              void chrome.runtime.lastError;
            }
          );
        } else if (payload.status === "failed" || payload.status === "dismissed" || payload.status === "rejected_source") {
          // 终结但没成卡(质量检查拒收等):不打扰,按钮停在「已保存」。
          terminal = true;
        }
      }
    } catch {
      // API 暂时够不着:继续轮询到期限为止。
    }

    if (terminal || Date.now() - startedAt >= RECEIPT_POLL_DEADLINE_MS) {
      activeReceiptPolls.delete(tweet.url);
      return;
    }

    setTimeout(poll, RECEIPT_POLL_INTERVAL_MS);
  };

  setTimeout(poll, RECEIPT_POLL_INTERVAL_MS);
}

async function saveTweet(tweet, tabId) {
  const response = await fetch(`${API_BASE}/api/captures/source`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildCaptureBody(tweet))
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload && payload.error ? payload.error : `AITimeline API responded ${response.status}.`);
  }

  nudgeCurationRun();

  if (payload.status !== "imported") {
    watchCaptureImported(tweet, tabId);
  }

  return { ok: true, status: payload.status, alreadyKnown: Boolean(payload.alreadyKnown) };
}
