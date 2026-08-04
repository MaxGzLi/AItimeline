// AITimeline 注入面 — 把本机知识库里「该回来找用户」的卡,以 X 原生帖的外观
// 插进 x.com 时间线。数据取自 GET /api/inject/cards(经 background 转发,绕 CORS);
// 拉不到卡就完全不注入,绝不造假卡。
//
// 注入机制(照 D1 实测施工图):
// - 卡 prepend 进 div[data-testid="cellInnerDiv"] 内部(不能当兄弟节点插,
//   X 会测量格子高度变化并自动重排让位);
// - 以推文 /status/ 永久链接为锚点;X 的虚拟列表滚远会回收格子、滚回来重建,
//   MutationObserver 触发重扫时按锚点补插,插前查重,同一锚点始终同一张卡;
// - 频率克制:可见窗口内每 ~8 条推文最多 1 张,单页面生命周期最多 3 张。
//
// 纯逻辑(选锚点/频率/停留计时/信号构造)在 lib/injectCore.js,有单测。

(() => {
  const core = globalThis.AITLInjectCore;

  if (!core) {
    return;
  }

  const WEB_APP_URL = "http://127.0.0.1:5173/";
  const CARD_ATTR = "data-aitl-inject-card";
  const SPACING = 8;
  const SESSION_MAX = 3;

  /** @type {Array<{id: string, title: string, summary: string, sourceTitle: string, sourceUrl: string, savedAt: string, topicId: string, conceptIds: string[]}>} */
  let cards = [];
  const cardById = new Map();
  /** anchorPath -> cardId,页面生命周期内稳定。 */
  let assignments = {};
  /** cardId -> { dwell, impressionFired, timer... } 信号状态跟卡走,不跟 DOM 节点走。 */
  const signalStates = new Map();

  function sendMessage(message) {
    try {
      chrome.runtime.sendMessage(message, () => {
        // 信号是尽力而为:后台不在或 API 掉线都静默丢弃,不打扰刷推。
        void chrome.runtime.lastError;
      });
    } catch {
      // 扩展上下文失效(重载/更新)时静默放弃。
    }
  }

  function sendSignal(card, kind, dwellTimeMs) {
    sendMessage({
      type: "AITL_SEND_SIGNAL",
      signal: core.buildInjectSignal(card, kind, {
        dwellTimeMs: dwellTimeMs ?? 0,
        createdAt: new Date().toISOString()
      })
    });
  }

  function getSignalState(cardId) {
    let state = signalStates.get(cardId);

    if (!state) {
      state = { dwell: core.createDwellState(), impressionFired: false, impressionTimer: null, intersecting: false };
      signalStates.set(cardId, state);
    }

    return state;
  }

  // ---------- 卡片 DOM ----------

  function buildCardNode(card) {
    const node = document.createElement("article");

    node.setAttribute(CARD_ATTR, card.id);
    node.className = "aitl-inject";

    const avatar = document.createElement("div");

    avatar.className = "aitl-inject-avatar";
    avatar.textContent = "知";

    const main = document.createElement("div");

    main.className = "aitl-inject-main";

    const header = document.createElement("div");

    header.className = "aitl-inject-header";

    const name = document.createElement("span");

    name.className = "aitl-inject-name";
    name.textContent = "你的知识库";

    const meta = document.createElement("span");

    meta.className = "aitl-inject-meta";
    meta.textContent = ` · ${core.formatSavedAgo(card.savedAt, new Date().toISOString())}`;

    header.append(name, meta);

    const title = document.createElement("div");

    title.className = "aitl-inject-title";
    title.textContent = card.title;

    const summary = document.createElement("div");

    summary.className = "aitl-inject-summary";
    summary.textContent = card.summary;

    const source = document.createElement("div");

    source.className = "aitl-inject-source";
    source.textContent = `来源:${card.sourceTitle}`;

    const open = document.createElement("div");

    open.className = "aitl-inject-open";
    open.textContent = "在知识库中打开";

    main.append(header, title, summary, source, open);
    node.append(avatar, main);

    node.addEventListener("click", () => {
      const state = getSignalState(card.id);

      sendSignal(card, "open", core.currentDwellMs(state.dwell, performance.now()));
      window.open(WEB_APP_URL, "_blank", "noopener");
    });

    observeCardNode(node, card);

    return node;
  }

  // ---------- 曝光 / 停留跟踪(口径对齐网页端 PostView) ----------

  function observeCardNode(node, card) {
    if (!("IntersectionObserver" in window)) {
      return;
    }

    const state = getSignalState(card.id);
    const clearImpressionTimer = () => {
      if (state.impressionTimer !== null) {
        window.clearTimeout(state.impressionTimer);
        state.impressionTimer = null;
      }
    };
    // 曝光:可见比例 ≥ 0.5 且标签页可见,持续 1 秒,单卡每会话只发一次,纯曝光(dwell 0)。
    const armImpression = () => {
      if (state.impressionTimer !== null || state.impressionFired || document.hidden) {
        return;
      }

      state.impressionTimer = window.setTimeout(() => {
        state.impressionTimer = null;

        if (document.hidden || state.impressionFired) {
          return;
        }

        state.impressionFired = true;
        sendSignal(card, "impression");
      }, 1000);
    };
    const flushDwell = (trigger) => {
      state.dwell = core.dwellExit(state.dwell, performance.now());

      const dueMs = core.dwellReportDue(state.dwell, performance.now(), trigger);

      if (dueMs !== null) {
        state.dwell = { ...state.dwell, reportedMs: dueMs };
        sendSignal(card, "dwell", dueMs);
      }
    };
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];

        if (entry?.isIntersecting && entry.intersectionRatio >= 0.5) {
          state.intersecting = true;
          armImpression();

          if (!document.hidden) {
            state.dwell = core.dwellEnter(state.dwell, performance.now());
          }

          return;
        }

        state.intersecting = false;
        clearImpressionTimer();
        flushDwell("exit");
      },
      { threshold: [0, 0.5, 1] }
    );
    const tick = window.setInterval(() => {
      if (!node.isConnected) {
        // 格子被虚拟列表回收:结算这段停留,释放这套监听;补插时会重新挂一套。
        window.clearInterval(tick);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        clearImpressionTimer();
        observer.disconnect();
        flushDwell("exit");
        return;
      }

      if (state.dwell.visibleSince === null) {
        return;
      }

      const dueMs = core.dwellReportDue(state.dwell, performance.now(), "tick");

      if (dueMs !== null) {
        state.dwell = { ...state.dwell, reportedMs: dueMs };
        sendSignal(card, "dwell", dueMs);
      }
    }, 3000);
    const onVisibilityChange = () => {
      if (document.hidden) {
        clearImpressionTimer();
        flushDwell("exit");
        return;
      }

      if (state.intersecting) {
        armImpression();
        state.dwell = core.dwellEnter(state.dwell, performance.now());
      }
    };

    observer.observe(node);
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  // ---------- 扫描与补插 ----------

  function extractAnchor(cell) {
    // 推文永久链接是包着 <time> 的那个 a;引用推文没有独立 time,不会误认。
    const timeEl = cell.querySelector("time[datetime]");
    const permalinkEl = timeEl ? timeEl.closest("a[href]") : null;

    return permalinkEl ? core.canonicalStatusPath(permalinkEl.getAttribute("href")) : null;
  }

  function scan() {
    if (cards.length === 0) {
      return;
    }

    const cells = document.querySelectorAll('div[data-testid="cellInnerDiv"]');

    if (cells.length === 0) {
      return;
    }

    // 虚拟列表的 DOM 顺序不保证等于视觉顺序,按几何位置排。
    const entries = [];

    for (const cell of cells) {
      const anchor = extractAnchor(cell);

      if (anchor) {
        entries.push({ cell, anchor, top: cell.getBoundingClientRect().top });
      }
    }

    entries.sort((a, b) => a.top - b.top);

    assignments = core.planInjections({
      anchors: entries.map((entry) => entry.anchor),
      assignments,
      cardIds: cards.map((card) => card.id),
      spacing: SPACING,
      sessionMax: SESSION_MAX
    });

    for (const entry of entries) {
      const cardId = assignments[entry.anchor];

      if (!cardId) {
        continue;
      }

      const card = cardById.get(cardId);

      if (card && !entry.cell.querySelector(`[${CARD_ATTR}="${cssEscape(cardId)}"]`)) {
        // 兜底查重:同一张卡不允许同时挂在别的格子里(锚点复用/重建竞态)。
        for (const stray of document.querySelectorAll(`[${CARD_ATTR}="${cssEscape(cardId)}"]`)) {
          stray.remove();
        }

        entry.cell.prepend(buildCardNode(card));
      }
    }
  }

  function cssEscape(value) {
    return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
  }

  function start() {
    let scanScheduled = false;
    const observer = new MutationObserver(() => {
      if (scanScheduled) {
        return;
      }

      scanScheduled = true;
      requestAnimationFrame(() => {
        scanScheduled = false;
        scan();
      });
    });

    // 观察整个 body:时间线容器本身在 SPA 导航时会整个换掉,盯 body 才能一直接住。
    observer.observe(document.body, { childList: true, subtree: true });
    scan();
  }

  chrome.runtime.sendMessage({ type: "AITL_FETCH_INJECT_CARDS" }, (response) => {
    if (chrome.runtime.lastError || !response || !response.ok || !Array.isArray(response.cards)) {
      return;
    }

    cards = response.cards.filter((card) => card && card.id && card.title);

    for (const card of cards) {
      cardById.set(card.id, card);
    }

    if (cards.length > 0) {
      start();
    }
  });
})();
