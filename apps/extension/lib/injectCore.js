// AITimeline 注入面的纯逻辑:选锚点、频率控制、停留计时、信号构造。
// 这里不碰 DOM、不碰 chrome API,inject.js 负责把这些决定落到页面上。
// 文件同时给两边用:content script 里挂到 globalThis.AITLInjectCore,
// Vitest 里走 module.exports(仓库根 package.json 无 "type",.js 按 CJS 加载)。

(() => {
  const DWELL_CAP_MS = 120000;

  /**
   * 把任意 href 归一成推文永久链接路径 "/user/status/123",不是推文链接返回 null。
   * 同一条推文的 /photo/1、/analytics 等子路径都归到同一个锚点。
   */
  function canonicalStatusPath(href) {
    if (typeof href !== "string" || !href) {
      return null;
    }

    let path = href;

    if (/^https?:/i.test(href)) {
      try {
        path = new URL(href).pathname;
      } catch {
        return null;
      }
    }

    const match = /^\/([A-Za-z0-9_]{1,20})\/status\/(\d+)/.exec(path);

    return match ? `/${match[1]}/status/${match[2]}` : null;
  }

  /**
   * 频率控制 + 锚点选择,一次扫描调用一次。
   *
   * 输入当前视口附近(虚拟列表挂载中)按视觉顺序排列的推文锚点,返回新的
   * anchor -> cardId 分配表。规则:
   * - 已有分配永远保留(同一锚点滚回来还是同一张卡);
   * - 单次会话最多 sessionMax 张(分配表条目数即会话计数);
   * - 当前可见窗口里,任意两张注入卡至少隔 spacing 条推文;
   * - 第一张卡不早于第 firstIndex 个锚点,避免顶着信息流开头;
   * - 卡按 cardIds 顺序用,不重复。
   *
   * @param {{ anchors: string[], assignments: Record<string, string>, cardIds: string[],
   *           spacing?: number, sessionMax?: number, firstIndex?: number }} input
   * @returns {Record<string, string>}
   */
  function planInjections({ anchors, assignments, cardIds, spacing = 8, sessionMax = 3, firstIndex = 3 }) {
    const next = { ...assignments };
    const assignedCardIds = new Set(Object.values(next));
    const pendingCardIds = cardIds.filter((cardId) => !assignedCardIds.has(cardId));
    const takenPositions = [];

    anchors.forEach((anchor, index) => {
      if (next[anchor]) {
        takenPositions.push(index);
      }
    });

    while (Object.keys(next).length < sessionMax && pendingCardIds.length > 0) {
      let chosenIndex = -1;

      for (let index = 0; index < anchors.length; index += 1) {
        const anchor = anchors[index];

        if (next[anchor]) {
          continue;
        }

        // 只有全会话第一张卡才受 firstIndex 约束;之后靠 spacing 控距。
        if (Object.keys(next).length === 0 && index < firstIndex) {
          continue;
        }

        if (takenPositions.some((position) => Math.abs(position - index) < spacing)) {
          continue;
        }

        chosenIndex = index;
        break;
      }

      if (chosenIndex === -1) {
        break;
      }

      next[anchors[chosenIndex]] = pendingCardIds.shift();
      takenPositions.push(chosenIndex);
    }

    return next;
  }

  /** 停留计时的初始状态。reportedMs 是最近一次已上报的累计值。 */
  function createDwellState() {
    return { visibleSince: null, accumulatedMs: 0, reportedMs: 0 };
  }

  /** 卡进入视口(且标签页可见)时打点。已在计时则原样返回。 */
  function dwellEnter(state, nowMs) {
    return state.visibleSince === null ? { ...state, visibleSince: nowMs } : state;
  }

  /** 卡离开视口或标签页隐藏时结算这一段可见时间。 */
  function dwellExit(state, nowMs) {
    if (state.visibleSince === null) {
      return state;
    }

    return { ...state, visibleSince: null, accumulatedMs: currentDwellMs(state, nowMs) };
  }

  /** 当前累计停留毫秒数(含进行中的一段),与网页端一致封顶 120 秒。 */
  function currentDwellMs(state, nowMs) {
    const activeMs = state.visibleSince === null ? 0 : Math.max(0, nowMs - state.visibleSince);

    return Math.min(DWELL_CAP_MS, Math.round(state.accumulatedMs + activeMs));
  }

  /**
   * 是否该上报一次停留。阈值抄网页端 PostView 的口径:
   * - 离开视口("exit"):累计 ≥ 1200ms 且比上次上报多 800ms;
   * - 周期检查("tick"):累计 ≥ 9000ms 且比上次上报多 3500ms。
   * 返回应上报的累计毫秒数,不该上报返回 null。dwell 是累计值,消费端按 postId 取 max。
   */
  function dwellReportDue(state, nowMs, trigger) {
    const dwellMs = currentDwellMs(state, nowMs);

    if (trigger === "exit") {
      return dwellMs >= 1200 && dwellMs > state.reportedMs + 800 ? dwellMs : null;
    }

    return dwellMs >= 9000 && dwellMs > state.reportedMs + 3500 ? dwellMs : null;
  }

  /**
   * 构造与网页端同形状的 InteractionSignal。
   * - impression:纯曝光,dwellTimeMs 必须为 0(服务端按纯曝光分流);
   * - dwell:累计停留;
   * - open:点开,openedThread=true,dwell 至少 9000(网页端点开的口径)。
   *
   * @param {{ id: string, topicId: string, conceptIds: string[] }} card
   * @param {"impression" | "dwell" | "open"} kind
   * @param {{ dwellTimeMs?: number, createdAt: string }} options
   */
  function buildInjectSignal(card, kind, { dwellTimeMs = 0, createdAt }) {
    const base = {
      postId: card.id,
      topicId: card.topicId,
      conceptIds: card.conceptIds,
      impression: true,
      dwellTimeMs: 0,
      openedThread: false,
      liked: false,
      saved: false,
      askedQuestion: false,
      reviewed: false,
      skippedQuickly: false,
      createdAt
    };

    if (kind === "impression") {
      return base;
    }

    if (kind === "dwell") {
      return { ...base, dwellTimeMs: Math.min(DWELL_CAP_MS, Math.max(0, Math.round(dwellTimeMs))) };
    }

    if (kind === "open") {
      return {
        ...base,
        openedThread: true,
        dwellTimeMs: Math.min(DWELL_CAP_MS, Math.max(9000, Math.round(dwellTimeMs)))
      };
    }

    throw new Error(`Unknown inject signal kind: ${kind}`);
  }

  /** 「N 天前存的」标签,今天/昨天单独说。输入非法时退回「之前存的」。 */
  function formatSavedAgo(savedAtIso, nowIso) {
    const savedAt = Date.parse(savedAtIso);
    const now = Date.parse(nowIso);

    if (!Number.isFinite(savedAt) || !Number.isFinite(now)) {
      return "之前存的";
    }

    const days = Math.floor((now - savedAt) / (24 * 60 * 60 * 1000));

    if (days <= 0) {
      return "今天存的";
    }

    if (days === 1) {
      return "昨天存的";
    }

    return `${days} 天前存的`;
  }

  const api = {
    DWELL_CAP_MS,
    canonicalStatusPath,
    planInjections,
    createDwellState,
    dwellEnter,
    dwellExit,
    currentDwellMs,
    dwellReportDue,
    buildInjectSignal,
    formatSavedAgo
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  if (typeof globalThis !== "undefined") {
    globalThis.AITLInjectCore = api;
  }
})();
