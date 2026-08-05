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
//    真机实测过:宿主在 onActivate 之后 2 毫秒就来读视图,第一批卡必然还在路上,
//    内容全靠这个定时器补上。manifest 里 refreshInterval 写 60 时实测约 86 秒重画
//    一次;试过改成官方 pomodoro 那样的 1.0,结果三分钟一次都没重画(反而更糟),
//    所以维持 60。
//    还有个连带的坑见 minimalPrecedence:第一次读视图时空手而归会被宿主收走槽位,
//    槽位一没,重画定时器也跟着停,插件就永久隐身了。
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

// 画布(全部扣掉宿主自己的边距之后的真实可用区,算自 Constants.swift + AppState.swift):
//   抽屉 expanded  408×88 - 左右 26 - 上 8 下 10 = 356×70
//   详情 fullExpanded 900×520 - 左右 32 - 上下各 4 = 836×512
//
// 900×520 不是宿主的默认值(默认 658×180,只够五六行正文)。它来自 manifest 里的
// capabilities.fullExpandedWidth / fullExpandedHeight —— 这两个字段是我们给
// SuperIsland 加的(见 docs/specs/2026-08-05-notch-panel-size.md)。**改这里必须
// 同步改 manifest**,两边对不上版面就会算错高度。
// 跑官方原版 SuperIsland 时这两个字段会被忽略,面板回到 658×180,版面会溢出。
var PANEL_W = 836;
var PANEL_H = 512;
var DRAWER_W = 356;

// 实测行高(SwiftUI .system,ImageRenderer 量的):26→30、16→19、14→17、13→16、11→14、10→13。
var LH_HEAD_BIG = 30;
var LH_HEAD_SMALL = 19;
var LH_DECK = 17;
var LH_BODY = 14;

var TEXT = { r: 1, g: 1, b: 1, a: 1 };
var DECK_C = { r: 1, g: 1, b: 1, a: 0.9 };
var BODY_C = { r: 1, g: 1, b: 1, a: 0.66 };
var META_C = { r: 1, g: 1, b: 1, a: 0.55 };
var DIM_C = { r: 1, g: 1, b: 1, a: 0.45 };
var RULE_C = { r: 1, g: 1, b: 1, a: 0.85 };
var HAIR_C = { r: 1, g: 1, b: 1, a: 0.28 };
var AMBER = { r: 1, g: 0.72, b: 0.2, a: 1 };
var BLACK = { r: 0, g: 0, b: 0, a: 1 };
var CHIP_BG = { r: 1, g: 1, b: 1, a: 0.14 };

var state = {
  cards: [],
  index: 0,
  page: 0,
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
    // 不带 limit 的话服务端只给 3 张(injectFeed.mjs 的 defaultInjectLimit),
    // 而刘海上翻卡是主要动作,3 张一圈就转完了。10 是服务端的上限。
    .fetch(API_BASE + "/api/inject/cards?limit=10")
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
        state.page = 0;
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

      // 换了卡就回第一页;还是同一张卡就别打断正在读的那一页。
      if (!current || cards[nextIndex].id !== current.id) {
        state.page = 0;
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

// ---------- 版面用的纯计算 ----------

// 按字宽估行数。汉字(和全角标点)算一个字宽,西文按 0.52 个字宽算。
// 宿主里量不到文字,只能估;估保守一点,宁可少放一行也别顶破。
function textUnits(value) {
  var units = 0;

  for (var i = 0; i < value.length; i += 1) {
    units += value.charCodeAt(i) > 0x2000 ? 1 : 0.52;
  }

  return units;
}

function lineCount(value, width, size) {
  if (!value) {
    return 0;
  }

  return Math.max(1, Math.ceil((textUnits(value) * size) / width));
}

// 标题里有全角冒号的,冒号前那截当眉题、冒号后那句当头题 —— 报纸的眉题/头题就是这么分的。
// 这批卡的标题普遍是「英文概念:中文断言」,劈开之后头题短到能上 26 点,版面立刻有了重心。
function splitTitle(card) {
  var title = card.title || "";
  var at = title.indexOf("：");

  if (at < 0) {
    at = title.indexOf(":");
  }

  if (at > 0 && at < title.length - 1) {
    return { kicker: title.slice(0, at).trim(), head: title.slice(at + 1).trim() };
  }

  return { kicker: (card.conceptIds && card.conceptIds[0]) || "", head: title };
}

// 头题够短才敢上 26 点(18.5 个字宽 = 481 点,离 594 还有余量,估歪了也不会变两行)。
function headIsBig(head) {
  return textUnits(head) <= 18.5;
}

// 来源标题最长实测 177 个字符,而且第一段常常跟眉题重名(「概念名 | 站名」)。
// 所以按分隔符切开,挑一段不跟眉题重复的;都重复就用最后一段(那通常才是刊名)。
function bylineOf(card, kicker) {
  var raw = card.sourceTitle || "";

  if (!raw) {
    return "";
  }

  var parts = raw.split(/\s+[|\-–—]\s+/);
  var picked = "";

  for (var i = 0; i < parts.length; i += 1) {
    var part = parts[i].trim();

    if (part && part !== kicker) {
      picked = part;
      break;
    }
  }

  if (!picked) {
    picked = parts[parts.length - 1].trim();
  }

  return picked.length > 40 ? picked.slice(0, 39) + "…" : picked;
}

// 标题和正文开头逐字重复的卡是真实存在的(种子里那张 title 和 summary 一模一样),
// 重复那句要剥掉,否则同一句话在版面上印两遍。
function stripDuplicateLead(bodyText, head, title) {
  var text = bodyText || "";

  for (var i = 0; i < 2; i += 1) {
    var lead = (i === 0 ? title : head) || "";
    lead = lead.replace(/[.…]+$/, "").slice(0, 24);

    if (lead && text.indexOf(lead) === 0) {
      var cut = text.search(/[。.!?！？]\s*/);
      text = cut < 0 ? "" : text.slice(cut + 1).replace(/^\s+/, "");
    }
  }

  return text;
}

// 正文用最长的那份 —— 版面宁可多给几句真内容,也不留空洞。
function bodyTextOf(card) {
  var split = splitTitle(card);
  var candidates = [card.shortBody, card.summary, card.hook];
  var best = "";

  for (var i = 0; i < candidates.length; i += 1) {
    var text = stripDuplicateLead(candidates[i], split.head, card.title);

    if (text.length > best.length) {
      best = text;
    }
  }

  return best;
}

// 一页到哪个字为止。优先在句号处断,断不了才硬切 —— 半句话结尾比留白更难看。
function pageEnd(text, start, unitsPerPage) {
  var units = 0;
  var end = start;
  var lastStop = -1;

  while (end < text.length && units < unitsPerPage) {
    units += text.charCodeAt(end) > 0x2000 ? 1 : 0.52;
    end += 1;

    if ("。.!?！？".indexOf(text.charAt(end - 1)) >= 0) {
      lastStop = end;
    }
  }

  if (end < text.length && lastStop > start) {
    end = lastStop;
  }

  return end;
}

// 把正文切成一页页。
// 第二个参数可以是一个数,也可以是「第几页 → 这页能装多少字宽」的函数:
// 第一页要跟导语挤,后面几页导语不再重复,能装的比第一页多。
function paginate(text, budget) {
  if (!text) {
    return [];
  }

  var unitsFor = typeof budget === "function" ? budget : function () { return budget; };
  var pages = [];
  var start = 0;

  while (start < text.length) {
    var end = pageEnd(text, start, unitsFor(pages.length));

    pages.push(text.slice(start, end).replace(/^\s+/, ""));
    start = end;
  }

  return pages;
}

// 版心(报头/大标题/底通栏之外那块)有多高。
// 报头 15(状态块上下各 1 点内衬)+ 3 + 粗线 2 + 5;细线一组 5+1+5;底通栏 4+1+4+16。
function middleHeight(view) {
  return PANEL_H - 25 - (view.big ? LH_HEAD_BIG : LH_HEAD_SMALL * 2) - 11 - 25;
}

// 版心分配。上下两头定死,中间那块按「导语 → 复习题 → 正文」的次序分,
// 正文行数是算出来的,所以每一页都填满,不会剩一块黑。
function layoutOf(card) {
  var split = splitTitle(card);
  var big = headIsBig(split.head);
  var middle = middleHeight({ big: big });
  var deckLines = card.keyTakeaway ? Math.min(2, lineCount(card.keyTakeaway, PANEL_W, 14)) : 0;
  var deckH = deckLines ? deckLines * LH_DECK + 3 : 0;
  // 复习题只在这张卡真的到期时才出 —— 它回来的理由就是让你想一想。
  var showPrompt = isReviewDue(card.reviewDueAt, new Date().toISOString()) && !!card.reviewPrompt;
  var promptH = showPrompt ? LH_BODY + 3 : 0;
  // 行数只由版心剩下多少高度决定,不设上限 —— 面板从 180 点放大到 520 点时,
  // 原来那个「最多 3 行」的上限会让头版印完三行就留一大片黑。
  var bodyLines = Math.max(1, Math.floor((middle - deckH - promptH) / LH_BODY));

  return {
    kicker: split.kicker,
    head: split.head,
    big: big,
    deckLines: deckLines,
    showPrompt: showPrompt,
    bodyLines: bodyLines
  };
}

// 续版页的正文行数。首页要让给 26 点大标题和导语,续版页只印一行接排题,
// 省下来的高度全给正文:面板高 - 报头 25 - 接排题 16 - 分隔线和间距 11 - 页脚 25。
var CONT_LINES = Math.floor((PANEL_H - 25 - 16 - 11 - 25) / LH_BODY);
// 小题(13 点中黑)一行的高度,和块与块之间的间距。
var LH_SUB = 16;
var BLOCK_GAP = 6;

// 把一段文字切成页数尽量少、而且每页都装得差不多满的若干页。
// 直接按上限切会切出「几页装满 + 末页一行」的碎页:切点只能落在句号上,每页都装不到上限,
// 攒下来的零头最后单独成页。上限只决定「至少几页」;页数定了之后,
// 再找**还能维持这个页数的最小份额**,那就是最均匀的切法。
// (不能拿「总字数 ÷ 页数」当份额:份额一小,句号处的零头又攒出多一页,越切越碎。)
function balancedPages(text, cap) {
  if (!text) {
    return [];
  }

  var pages = paginate(text, cap);

  if (pages.length < 2) {
    return pages;
  }

  // 份额越小页数只会越多,所以「页数不超过 pages.length」是单调的,二分找得到边界。
  var lo = 1;
  var hi = cap;

  while (lo < hi) {
    var mid = Math.floor((lo + hi) / 2);

    if (paginate(text, mid).length <= pages.length) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }

  return paginate(text, lo);
}

// thread 段落(接口里叫 sections)。每段自带一个小标题,正好当报纸的分栏小题。
function sectionsOf(card) {
  var sections = card.sections || [];
  var out = [];

  for (var i = 0; i < sections.length; i += 1) {
    var body = (sections[i].body || "").trim();

    if (body) {
      out.push({ title: (sections[i].title || "").trim(), body: body });
    }
  }

  return out;
}

// 概念索引框排几行:少于 5 个排一列,多了才分两列。
function conceptRows(card) {
  var names = card.conceptIds || [];

  return names.length < 5 ? names.length : Math.ceil(names.length / 2);
}

// 一块占多高。块 = 一段正文(可带小题)或末尾那个概念索引框。
function blockHeight(block, card) {
  if (block.concepts) {
    var rows = conceptRows(card);

    return 13 + 4 + rows * LH_BODY + (rows - 1) * 3;
  }

  return (block.subhead ? LH_SUB + 2 : 0) + lineCount(block.text, PANEL_W, 11) * LH_BODY;
}

// 一页上这些块摞起来有多高(块与块之间还有间距)。
function stackHeight(blocks, card) {
  var total = (blocks.length - 1) * BLOCK_GAP;

  for (var i = 0; i < blocks.length; i += 1) {
    total += blockHeight(blocks[i], card);
  }

  return total;
}

// 一张卡分几页。页面是拿「块」拼出来的:一段一百来字的 thread 独占一整页,
// 在放大后的面板上只填得掉一成,剩下九成全是黑的;所以塞得下就往同一页上接着塞。
function pagesOf(card) {
  var view = layoutOf(card);
  var text = bodyTextOf(card);
  var sections = sectionsOf(card);
  // 头版的正文高度已经扣掉了大标题、导语和复习题;续版页这几样都不重复,整块给正文。
  var contH = CONT_LINES * LH_BODY;
  var blocks = [];
  // 概念索引框只有几行高,自己占一页就是一整片黑。所以最后一段正文切页时先把它的位置留出来,
  // 索引框就总能跟在正文后面。留不留只影响最后那一段,别的段照样按整页切。
  var reserve = conceptRows(card) ? blockHeight({ concepts: true }, card) + BLOCK_GAP : 0;

  // 一段装不进一整页时切开,每一片都重印小题 —— 否则翻到下一页就不知道在读哪一节了。
  function cut(subhead, body, keep) {
    var lines = Math.floor((contH - keep - (subhead ? LH_SUB + 2 : 0)) / LH_BODY);

    balancedPages(body, (lines * PANEL_W) / 11).forEach(function (part) {
      blocks.push({ subhead: subhead, text: part });
    });
  }

  if (text) {
    // 导语正文最多印满头版一页。有 thread 段落时,印不完的尾巴不再单开页 ——
    // 那几段把同样的内容讲得更细,为尾巴多开一页只会得到一行字加一片黑。
    var leadKeep = sections.length ? 0 : reserve;
    var firstEnd = pageEnd(text, 0, ((view.bodyLines - Math.ceil(leadKeep / LH_BODY)) * PANEL_W) / 11);

    blocks.push({ text: text.slice(0, firstEnd) });

    if (!sections.length) {
      cut("", text.slice(firstEnd), reserve);
    }
  }

  sections.forEach(function (section, i) {
    cut(section.title, section.body, i === sections.length - 1 ? reserve : 0);
  });

  if (conceptRows(card)) {
    blocks.push({ concepts: true });
  }

  var pages = [];
  var current = [];
  var used = 0;
  var room = view.bodyLines * LH_BODY;

  blocks.forEach(function (block, i) {
    var height = blockHeight(block, card);
    var next = blocks[i + 1];
    // 概念索引框只有几行高,自己占一页就是一整片黑(真机上量过:一页只填掉一成)。
    // 排最后一段正文时先把索引框的高度算进来,一起装不下就让这两块一同翻页。
    var together = next && next.concepts ? height + BLOCK_GAP + blockHeight(next, card) : height;
    var need = together <= contH ? together : height;

    if (current.length && used + BLOCK_GAP + need > room) {
      pages.push({ kind: "body", blocks: current });
      current = [];
      used = 0;
      room = contH;
    }

    if (current.length) {
      used += BLOCK_GAP;
    }

    current.push(block);
    used += height;
  });

  if (current.length) {
    pages.push({ kind: "body", blocks: current });
  }

  // 一块都没有(正文空、概念也空)时留一页空正文,否则翻页的分母会是 0。
  if (!pages.length) {
    pages.push({ kind: "body", blocks: [{ text: "" }] });
  }

  // 塞满了往下翻,末页往往只剩一小截:前一页黑边一行都没有,末页黑掉三分之二,
  // 看着像没排完。把前一页尾巴上的块往末页挪,挪到两页差不多满为止 ——
  // 只动最后这一处断点,前面几页照旧填满。
  if (pages.length > 1) {
    var last = pages[pages.length - 1];
    var prev = pages[pages.length - 2];

    while (prev.blocks.length > 1) {
      var move = prev.blocks[prev.blocks.length - 1];
      var shift = blockHeight(move, card) + BLOCK_GAP;
      var here = stackHeight(prev.blocks, card);
      var there = stackHeight(last.blocks, card);

      if (there + shift > contH || Math.abs(here - shift - (there + shift)) >= Math.abs(here - there)) {
        break;
      }

      prev.blocks.pop();
      last.blocks.unshift(move);
    }
  }

  return pages;
}

function clampPage() {
  var card = currentCard();

  if (!card) {
    state.page = 0;
    return 0;
  }

  var total = pagesOf(card).length;

  if (state.page >= total) {
    state.page = 0;
  }

  return total;
}

// ---------- 视图 ----------

// 一条实心线。宿主里画色块只有这一种写法能出像素:先 frame 定尺寸,再 background 填色。
// 反过来写(background 包在 frame 里面)是给一个 0 宽的空文字上色,什么都画不出来。
function rule(width, height, color) {
  return View.background(View.frame(View.text(""), { width: width, height: height }), color);
}

function gap(height) {
  return View.frame(View.text(""), { width: 1, height: height });
}

// 反白块。整版只准出现这一个,多了就成徽章堆了。
function chip(label, background, foreground) {
  return View.cornerRadius(
    View.background(
      View.padding(
        View.padding(View.text(label, { style: "footnote", color: foreground, lineLimit: 1 }), {
          edges: "horizontal",
          amount: 5
        }),
        { edges: "vertical", amount: 1 }
      ),
      background
    ),
    2
  );
}

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
  if (state.cards.length) {
    return 1;
  }

  // 第一批还在路上时**不能**还槽位。宿主是在 onActivate 之后 2 毫秒就来读视图的,
  // 那时候 fetch 才刚发出去,卡必然是空的;这里要是返回 0,槽位当场让出去,
  // 重画定时器也跟着停(定时器只给在岛上的模块跑),等 240 毫秒后卡回来了
  // 已经没人来读第二次——插件就此永久隐身,而且是时快时慢的随机现象。
  // lastFetchAt 是 0 就说明「一次都还没拉回来」,跟「拉回来了但库里真没卡」不是一回事。
  return state.lastFetchAt === 0 ? 1 : 0;
}

function minimalLeading() {
  if (!state.cards.length) {
    // 同上:第一批在路上时画个暗的书本,别让刘海挂一条纯黑空条。
    return state.lastFetchAt === 0
      ? View.icon("book.closed", { size: 11, color: "gray" })
      : null;
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
    // 第一批还在路上就画个暗书本占位,理由同 minimalPrecedence:
    // 空手而归会被宿主判定为「没内容」,之后不再来读。
    if (state.lastFetchAt === 0) {
      return View.icon("book.closed", { size: 12, color: "gray" });
    }

    // 拉回来了确实一张卡都没有,那就什么都不画(宿主把 null 当空节点处理)。
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

// 报头行:菱形 + 状态块 + 眉题 …… 右端是边栏数据。报纸版面的 folio 行。
function flagRow(card, view, width, withStats) {
  var now = new Date().toISOString();
  var due = isReviewDue(card.reviewDueAt, now);
  var right = [];

  if (withStats && typeof card.estimatedReadMinutes === "number") {
    right.push(card.estimatedReadMinutes + " 分钟");
  }

  right.push(state.index + 1 + "/" + state.cards.length);

  var children = [
    View.icon("diamond.fill", { size: 6, color: AMBER }),
    chip(due ? "该复习了" : formatSavedAgo(card.savedAt, now), due ? AMBER : CHIP_BG, due ? BLACK : DECK_C)
  ];

  if (view.kicker) {
    children.push(View.text(view.kicker, { style: "footnote", color: META_C, lineLimit: 1 }));
  }

  children.push(View.spacer(8));
  children.push(View.text(right.join(" · "), { style: "footnote", color: DIM_C, lineLimit: 1 }));

  return View.frame(View.hstack(children, { spacing: 6, align: "center" }), {
    maxWidth: 9999,
    alignment: "leading"
  });
}

// 词条页:全部概念分两列排。之前是「切前 4 个拼一行」,9 个概念必被截成半个词。
function conceptPage(card) {
  var names = card.conceptIds || [];
  // 少于 5 个排一列,多了才分两列 —— 三个词摊成两列会显得版面是空的。
  var half = conceptRows(card);
  var columns = names.length < 5 ? [names] : [names.slice(0, half), names.slice(half)];

  var rendered = columns.map(function (column) {
    return View.frame(
      View.vstack(
        column.map(function (name) {
          return View.text(name, { style: "caption", color: BODY_C, lineLimit: 1 });
        }),
        { spacing: 3, align: "leading" }
      ),
      { maxWidth: 9999, alignment: "leading" }
    );
  });

  return View.vstack(
    [
      View.frame(
        View.text("相关概念 " + names.length + " 个", { style: "footnote", color: DIM_C, lineLimit: 1 }),
        { maxWidth: 9999, alignment: "leading" }
      ),
      gap(4),
      View.frame(View.hstack(rendered, { spacing: 16, align: "top" }), {
        maxWidth: 9999,
        alignment: "leading"
      })
    ],
    { spacing: 0, align: "leading" }
  );
}

// 底通栏:署名在左,翻页和出口在右。
function footRow(card, view, total) {
  var byline = bylineOf(card, view.kicker);
  var forwardLabel = state.page + 1 >= total ? "下一张 »" : "继续 ›";

  return View.frame(
    View.hstack(
      [
        rule(14, 1, DIM_C),
        View.text(byline, { style: "footnote", color: META_C, lineLimit: 1 }),
        View.spacer(10),
        View.button(View.text("‹", { style: "caption", color: META_C }), "prevPage"),
        View.text(state.page + 1 + "/" + total, { style: "monospacedSmall", color: DIM_C, lineLimit: 1 }),
        View.button(View.text(forwardLabel, { style: "caption", color: TEXT }), "forward"),
        rule(1, 11, HAIR_C),
        View.button(View.text("在网页里打开", { style: "caption", color: META_C }), "open")
      ],
      { spacing: 8, align: "center" }
    ),
    { maxWidth: 9999, alignment: "leading" }
  );
}

// 356×70 的抽屉:报头 + 粗线 + 大标题。一个按钮都不放 ——
// 展开态点面板空白处宿主就直接开详情(IslandContainerView.swift 的 handleSurfaceTap),
// 小按钮点歪的代价是整个面板弹开,不划算。
function expandedView() {
  var card = currentCard();

  if (!card) {
    return View.text(state.lastError || "知识库里还没有该回来的卡", {
      style: "caption",
      color: META_C,
      lineLimit: 2
    });
  }

  var view = layoutOf(card);
  var children = [
    flagRow(card, view, DRAWER_W, false),
    gap(2),
    rule(DRAWER_W, 1.5, RULE_C),
    gap(4),
    View.frame(
      View.text(view.head, { style: "title", color: TEXT, lineLimit: 2 }),
      { maxWidth: 9999, alignment: "leading" }
    )
  ];

  // 标题只占一行时补一行导语;占两行就不补,否则 70 点顶破。
  if (textUnits(view.head) * 16 <= DRAWER_W && card.keyTakeaway) {
    children.push(gap(3));
    children.push(
      View.frame(View.text(card.keyTakeaway, { style: "caption", color: BODY_C, lineLimit: 2 }), {
        maxWidth: 9999,
        alignment: "leading"
      })
    );
  }

  children.push(View.spacer(0));

  return View.vstack(children, { spacing: 0, align: "leading" });
}

// 594×172 的详情面板:报纸头版。眉题 → 粗线 → 大标题 → 细线 → 导语/正文 → 细线 → 底通栏。
function fullExpandedView() {
  var card = currentCard();

  if (!card) {
    return View.text(state.lastError || "知识库里还没有该回来的卡", {
      style: "body",
      color: META_C,
      lineLimit: 3
    });
  }

  var total = clampPage();
  var view = layoutOf(card);
  var pages = pagesOf(card);
  var page = pages[state.page] || pages[0];
  // 首页印大标题;续版页只印一行接排题(报纸的 jump head),把省下的两行还给正文。
  var isJump = state.page > 0;
  var children = [
    flagRow(card, view, PANEL_W, true),
    gap(3),
    rule(PANEL_W, isJump ? 1 : 2, RULE_C),
    gap(5),
    View.frame(
      View.text(view.head, {
        style: isJump ? "subtitle" : view.big ? "largeTitle" : "title",
        color: isJump ? DECK_C : TEXT,
        lineLimit: isJump ? 1 : 2
      }),
      { maxWidth: 9999, alignment: "leading" }
    ),
    gap(5),
    rule(PANEL_W, 1, HAIR_C),
    gap(5)
  ];

  // 导语只印在第一页,后面几页整块让给正文。
  if (state.page === 0 && view.deckLines) {
    children.push(
      View.frame(
        View.text(card.keyTakeaway, { style: "headline", color: DECK_C, lineLimit: view.deckLines }),
        { maxWidth: 9999, alignment: "leading" }
      )
    );
    children.push(gap(3));
  }

  (page.blocks || []).forEach(function (block, i) {
    if (i) {
      children.push(gap(BLOCK_GAP));
    }

    if (block.concepts) {
      children.push(conceptPage(card));
      return;
    }

    // 小题:thread 那一段的标题,当报纸的分栏小题用。13 点中黑压在 11 点正文上面,
    // 一眼能看出「现在读的是哪一节」。
    if (block.subhead) {
      children.push(
        View.frame(View.text(block.subhead, { style: "subtitle", color: TEXT, lineLimit: 1 }), {
          maxWidth: 9999,
          alignment: "leading"
        })
      );
      children.push(gap(2));
    }

    children.push(
      View.frame(
        View.text(block.text, {
          style: "caption",
          color: BODY_C,
          // 行数就按这块真正占几行来给 —— 分页时算的是同一个数,版面才不会跟分页对不上。
          lineLimit: Math.max(1, lineCount(block.text, PANEL_W, 11))
        }),
        { maxWidth: 9999, alignment: "leading" }
      )
    );
  });

  if (state.page === 0 && view.showPrompt) {
    children.push(gap(3));
    children.push(
      View.frame(
        View.hstack(
          [
            View.text("问", { style: "footnote", color: AMBER, lineLimit: 1 }),
            View.text(card.reviewPrompt, { style: "caption", color: META_C, lineLimit: 1 })
          ],
          { spacing: 5, align: "center" }
        ),
        { maxWidth: 9999, alignment: "leading" }
      )
    );
  }

  children.push(View.spacer(4));
  children.push(rule(PANEL_W, 1, HAIR_C));
  children.push(gap(4));
  children.push(footRow(card, view, total));

  return View.vstack(children, { spacing: 0, align: "leading" });
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
    // 往前走一页;走到最后一页再按就换下一张卡。一个按钮走完全程,不用记两套操作。
    if (actionID === "forward") {
      var card = currentCard();

      if (!card) {
        return;
      }

      if (state.page + 1 < pagesOf(card).length) {
        state.page += 1;
      } else {
        state.index = (state.index + 1) % state.cards.length;
        state.page = 0;
      }

      SuperIsland.playFeedback("selection");
      return;
    }

    if (actionID === "prevPage") {
      if (state.page > 0) {
        state.page -= 1;
      } else if (state.cards.length) {
        state.index = (state.index - 1 + state.cards.length) % state.cards.length;
        state.page = 0;
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
