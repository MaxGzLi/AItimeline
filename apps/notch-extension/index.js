// AITimeline 刘海探路扩展(SuperIsland)。
//
// 这是一次性的探路件,目的只有一个:验证「把知识卡藏在刘海里、鼠标甩上去才展开」
// 这个交互到底好不好用。不是正式产品形态,验完就该退役。
//
// 设计约束(都是有意为之,改之前先读一遍):
//
// 1. 「藏」不「撞」:代码里绝不调用 SuperIsland.island.activate(),所以这个扩展
//    永远不主动弹出来,只有用户把鼠标甩到刘海上才展开。
//    注意 manifest 里的 activationTriggers **不管弹不弹**,它只管宿主要不要给
//    这个扩展注册重画定时器(ExtensionManager.swift:436-442 的 guard)。
//    必须写 "timer",否则宿主只在激活那一瞬间读一次视图——而那时候网络还没回来,
//    刘海会永远停在「没有卡」的空状态,再也不会更新。定时器回调只调 refreshState
//    重画,不会弹岛(ExtensionManager.swift:462-464),所以「藏」不受影响。
// 2. 不发曝光信号:知识卡有「曝光 5 次且零互动就从时间线下架」的规则
//    (packages/core/src/ranking/lifecycle.ts:52),而纯曝光信号不做当日合并。
//    刘海面要是照 X 注入面那样发曝光,几分钟就能把一张卡从网页信息流和 X 注入面
//    一起弄消失。所以这里只在用户真的点开时发一条 open 信号,不发 impression。
//    (正式版应该给信号加「来自哪个面」的字段,那是 core 的改动,不在探路范围。)
// 3. 时间文案和复习到期判断是从 apps/extension/lib/injectCore.js 逐字搬过来的。
//    SuperIsland 的 JS 环境没有 require/import,只加载 index.js 一个文件,搬不了
//    模块,只能抄。抄的部分下面标了出处,改一处要改两处。

var API_BASE = "http://127.0.0.1:8787";
var WEB_BASE = "http://127.0.0.1:5173";
var REFETCH_INTERVAL_MS = 60 * 1000;

var state = {
  cards: [],
  index: 0,
  lastFetchAt: 0,
  lastError: null,
  loading: false
};

var refetchTimer = null;

// ---------- 从 injectCore.js 搬过来的纯逻辑 ----------

// 出处:apps/extension/lib/injectCore.js formatSavedAgo
function formatSavedAgo(savedAtIso, nowIso) {
  var savedAt = Date.parse(savedAtIso);
  var now = Date.parse(nowIso);

  if (!isFinite(savedAt) || !isFinite(now)) {
    return "之前存的";
  }

  var days = Math.floor((now - savedAt) / (24 * 60 * 60 * 1000));

  if (days <= 0) {
    return "今天存的";
  }

  if (days === 1) {
    return "昨天存的";
  }

  return days + " 天前存的";
}

// 出处:apps/extension/lib/injectCore.js isReviewDue
function isReviewDue(reviewDueAtIso, nowIso) {
  var due = Date.parse(reviewDueAtIso || "");
  var now = Date.parse(nowIso);

  return isFinite(due) && isFinite(now) && due <= now;
}

// ---------- 取数 ----------

function currentCard() {
  if (!state.cards.length) {
    return null;
  }

  return state.cards[state.index % state.cards.length];
}

function dueCount() {
  var now = new Date().toISOString();
  var count = 0;

  for (var i = 0; i < state.cards.length; i += 1) {
    if (isReviewDue(state.cards[i].reviewDueAt, now)) {
      count += 1;
    }
  }

  return count;
}

function refetch() {
  if (state.loading) {
    return;
  }

  state.loading = true;

  SuperIsland.http
    .fetch(API_BASE + "/api/inject/cards")
    .then(function (response) {
      state.loading = false;
      state.lastFetchAt = Date.now();

      // 宿主的 fetch 从不 reject,失败时 resolve 出 status 0。
      // 拉失败时**保留上一批卡**:知识卡不会 60 秒就过期,拿旧的看总比空着强;
      // 小药丸那一格会显示错误,用户知道数据是旧的。
      if (!response || response.status !== 200) {
        state.lastError = "本机 AITimeline 没有运行";
        return;
      }

      var cards = response.data && response.data.cards;

      if (!cards || !cards.length) {
        state.cards = [];
        state.index = 0;
        state.lastError = null;
        return;
      }

      // 只在「当前这张卡不在新列表里」时才回到第一张。无条件归零会把正在翻卡的
      // 用户每分钟弹回开头一次(宿主的可见期定时刷新 + 我们自己的定时器都会触发)。
      var current = currentCard();
      var nextIndex = 0;

      if (current) {
        for (var i = 0; i < cards.length; i += 1) {
          if (cards[i].id === current.id) {
            nextIndex = i;
            break;
          }
        }
      }

      state.cards = cards;
      state.index = nextIndex;
      state.lastError = null;
    })
    .catch(function (error) {
      state.loading = false;
      state.lastFetchAt = Date.now();
      state.lastError = "本机 AITimeline 没有运行";
      console.log("[aitimeline] 拉卡失败:" + (error && error.message ? error.message : error));
    });
}

function refetchIfStale() {
  if (Date.now() - state.lastFetchAt >= REFETCH_INTERVAL_MS) {
    refetch();
  }
}

// 只在用户真的点开时发,不发曝光(见文件头第 2 条)。
function sendOpenSignal(card) {
  SuperIsland.http
    .fetch(API_BASE + "/api/signals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        generatedAt: new Date().toISOString(),
        signal: {
          postId: card.id,
          topicId: card.topicId,
          conceptIds: card.conceptIds,
          impression: true,
          dwellTimeMs: 9000,
          openedThread: true,
          liked: false,
          saved: false,
          askedQuestion: false,
          reviewed: false,
          skippedQuickly: false,
          createdAt: new Date().toISOString()
        },
        sourceCandidates: []
      })
    })
    .then(function (response) {
      // 宿主的 fetch 从不 reject:失败时也 resolve,带 status 0 和 error 字段。
      // 所以失败只能靠查 status,不能靠 catch。
      if (!response || (response.status !== 200 && response.status !== 201)) {
        console.log("[aitimeline] 回传信号失败,status=" + (response ? response.status : "无响应"));
      }
    });
}

// ---------- 视图 ----------

function metaLine(card) {
  var now = new Date().toISOString();
  var parts = [formatSavedAgo(card.savedAt, now)];

  if (isReviewDue(card.reviewDueAt, now)) {
    parts.push("该复习了");
  }

  // 有刘海的机器上小药丸压根不渲染,错误只能在这里说,否则用户会盯着旧卡当新的看。
  if (state.lastError) {
    parts.push(state.lastError);
  }

  return parts.join(" · ");
}

// 静默态:有刘海的 Mac 上,默认只会渲染这两个(CompactView.swift:9-12),
// 下面那个 compactView 是给没刘海的机器和关掉侧槽位的人用的。
//
// 关键:返回 null **不等于**隐身。宿主把 null 当空节点画,但刘海照样按
// manifest 声明撑宽(左右各 56 点),结果是一条什么都没有的黑条。
// 真正让位的开关是 precedence 返回 0(AppState.swift:930-934),
// 官方 pomodoro 就是这么干的。
function minimalPrecedence() {
  // 一张卡都没有(不管是本来就没有,还是连不上)就把槽位还回去,
  // 让音乐控件之类的东西回来,别占着位置画空白。
  return state.cards.length ? 1 : 0;
}

function minimalLeading() {
  if (!state.cards.length) {
    return null;
  }

  if (state.lastError) {
    // 有旧卡但拉不到新的:图标改成警告,让用户知道看到的可能是旧数据。
    return View.icon("exclamationmark.triangle", { size: 11, color: "gray" });
  }

  return View.icon("book.closed", {
    size: 11,
    color: dueCount() > 0 ? "blue" : "gray"
  });
}

function minimalTrailing() {
  if (!state.cards.length) {
    return null;
  }

  return View.text(String(Math.min(state.cards.length, 9)), {
    style: "caption",
    color: state.lastError ? "gray" : dueCount() > 0 ? "blue" : "gray",
    lineLimit: 1
  });
}

// 188×34 的小药丸。只有没刘海的机器、或者用户关掉了侧边槽位时才会走到这里
// (CompactView.swift:9-20 的三条分支)。仍然克制:只报数,不报内容。
function compactView() {
  if (state.lastError) {
    return View.hstack([
      View.icon("exclamationmark.triangle", { size: 11, color: "gray" }),
      View.text(state.lastError, { style: "caption", color: "gray", lineLimit: 1 })
    ], { spacing: 6 });
  }

  if (!state.cards.length) {
    // 没有卡就什么都不画(宿主把 null 当空节点处理)。
    return null;
  }

  var due = dueCount();

  return View.hstack([
    View.icon("book.closed", { size: 12, color: due > 0 ? "blue" : "gray" }),
    View.text(
      due > 0 ? due + " 张该复习了" : state.cards.length + " 张知识卡",
      { style: "caption", color: "white", lineLimit: 1 }
    )
  ], { spacing: 6 });
}

// 360×80 的抽屉:一张卡的标题 + 一行 meta。
function expandedView() {
  var card = currentCard();

  if (!card) {
    return View.vstack([
      View.text(state.lastError || "知识库里还没有该回来的卡", {
        style: "caption",
        color: "gray",
        lineLimit: 2
      })
    ], { spacing: 4, align: "leading" });
  }

  return View.vstack([
    View.text(card.title, { style: "body", color: "white", lineLimit: 2 }),
    View.hstack([
      View.text(metaLine(card), { style: "footnote", color: "gray", lineLimit: 1 }),
      View.spacer(),
      View.text(state.index + 1 + "/" + state.cards.length, {
        style: "footnote",
        color: "gray",
        lineLimit: 1
      })
    ], { spacing: 6 })
  ], { spacing: 4, align: "leading" });
}

// 400×200 的详情面板:摘要、出处、概念、两个按钮。
function fullExpandedView() {
  var card = currentCard();

  if (!card) {
    return View.vstack([
      View.text(state.lastError || "知识库里还没有该回来的卡", {
        style: "body",
        color: "gray",
        lineLimit: 3
      })
    ], { spacing: 6, align: "leading" });
  }

  var children = [
    View.text(card.title, { style: "body", color: "white", lineLimit: 2 }),
    View.text(metaLine(card), { style: "footnote", color: "gray", lineLimit: 1 }),
    View.divider(),
    View.scroll(
      View.text(card.summary || "", { style: "caption", color: "white" }),
      { axes: "vertical", showsIndicators: false }
    )
  ];

  if (card.sourceTitle) {
    children.push(
      View.text("出处:" + card.sourceTitle, { style: "footnote", color: "gray", lineLimit: 1 })
    );
  }

  if (card.conceptIds && card.conceptIds.length) {
    children.push(
      View.text(card.conceptIds.slice(0, 4).join(" · "), {
        style: "footnote",
        color: "blue",
        lineLimit: 1
      })
    );
  }

  children.push(
    View.hstack([
      View.button(View.text("下一张", { style: "caption", color: "white" }), "next"),
      View.spacer(),
      View.button(View.text("在知识库中打开", { style: "caption", color: "blue" }), "open")
    ], { spacing: 8 })
  );

  return View.vstack(children, { spacing: 6, align: "leading" });
}

// ---------- 注册 ----------

SuperIsland.registerModule({
  onActivate: function () {
    refetch();

    if (refetchTimer === null) {
      refetchTimer = setInterval(refetchIfStale, REFETCH_INTERVAL_MS);
    }
  },

  onDeactivate: function () {
    if (refetchTimer !== null) {
      clearInterval(refetchTimer);
      refetchTimer = null;
    }
  },

  compact: function () {
    refetchIfStale();
    return compactView();
  },

  minimalCompact: {
    leading: minimalLeading,
    trailing: minimalTrailing,
    precedence: minimalPrecedence
  },

  expanded: expandedView,

  fullExpanded: fullExpandedView,

  onAction: function (actionID) {
    if (actionID === "next") {
      if (state.cards.length) {
        state.index = (state.index + 1) % state.cards.length;
      }

      SuperIsland.playFeedback("selection");
      return;
    }

    if (actionID === "open") {
      var card = currentCard();

      if (!card) {
        return;
      }

      sendOpenSignal(card);
      SuperIsland.openURL(WEB_BASE);
      SuperIsland.playFeedback("success");
    }
  }
});
