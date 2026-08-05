import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 宿主(SuperIsland)只加载 index.js 一个文件,里面不能有 import/export,
// 顶层还会调 SuperIsland.registerModule。所以这里把源码读进来在沙箱里跑一遍,
// 注入假的 SuperIsland / View,再把要测的纯函数抛出来 —— 一个字都不用改产品代码。
const source = readFileSync(new URL("../index.js", import.meta.url), "utf8");

const exported = [
  "textUnits",
  "lineCount",
  "splitTitle",
  "headIsBig",
  "bylineOf",
  "stripDuplicateLead",
  "bodyTextOf",
  "paginate",
  "layoutOf",
  "pagesOf",
  "minimalPrecedence",
  "minimalLeading",
  "compactView",
  "state"
];

const sandbox = new Function(
  "SuperIsland",
  "View",
  `${source}\n;return { ${exported.join(", ")} };`
);

const noop = () => {};
const node = (type) => (...args) => ({ type, args });

const api = sandbox(
  {
    registerModule: noop,
    http: { fetch: () => Promise.resolve({ status: 0 }) },
    openURL: noop,
    playFeedback: noop
  },
  {
    text: node("text"),
    icon: node("icon"),
    hstack: node("hstack"),
    vstack: node("vstack"),
    spacer: node("spacer"),
    frame: node("frame"),
    background: node("background"),
    cornerRadius: node("cornerRadius"),
    padding: node("padding"),
    button: node("button"),
    divider: node("divider"),
    scroll: node("scroll")
  }
);

const {
  splitTitle,
  headIsBig,
  bylineOf,
  stripDuplicateLead,
  bodyTextOf,
  paginate,
  layoutOf,
  pagesOf,
  minimalPrecedence,
  minimalLeading,
  compactView,
  state
} = api;

function setState(patch) {
  Object.assign(state, { cards: [], index: 0, page: 0, lastFetchAt: 0, lastError: null, loading: false }, patch);
}

// 用户本机知识库里的真卡,字段原样抄下来。
const richCard = {
  id: "alf",
  title: "Auxiliary-Loss-Free Load Balancing：去掉辅助损失，MoE 也能均衡",
  keyTakeaway:
    "负载均衡不一定要靠损失函数惩罚，一个简单的 bias 循环就能在保持模型质量的同时避免 expert collapse。",
  shortBody:
    "Sparse Mixture-of-Experts 层通过只激活少量 expert 来扩展容量，但无约束的路由会导致 expert collapse——少数 expert 承担全部流量，其余闲置，有效参数数骤降。传统方案是加 auxiliary loss 惩罚负载不均，但它直接牺牲模型质量。Auxiliary-loss-free Load Balancing 在 top-K 路由前给每个 expert 的分数加一个 bias。",
  summary: "短摘要。",
  sourceTitle: "Auxiliary-Loss-Free Load Balancing | LLMS3",
  conceptIds: ["Mixture-of-Experts", "DeepSeekMoE", "DeepSeek V3"],
  estimatedReadMinutes: 4,
  reviewPrompt: "Auxiliary-loss-free Load Balancing 的核心机制是什么？",
  savedAt: "2026-08-04T00:00:00.000Z"
};

// 种子里那张 title 和 summary 逐字相同的退化卡。
const degenerateCard = {
  id: "degenerate",
  title:
    "An AI Agent can turn source material into durable knowledge when it keeps citations, extracts...",
  keyTakeaway: "A source-grounded answer should also test whether the generated post improved recall.",
  shortBody:
    "An AI Agent can turn source material into durable knowledge when it keeps citations, extracts concepts, and creates a learning surface that users can revisit.",
  summary:
    "An AI Agent can turn source material into durable knowledge when it keeps citations, extracts concepts, and creates a learning surface that users can revisit.",
  hook: "AI Agent matters because it can change what the user sees next.",
  sourceTitle: "Learning agents need a timeline surface",
  conceptIds: ["AI Agent"],
  estimatedReadMinutes: 1,
  reviewPrompt: "What is the core lesson about AI Agent?",
  savedAt: "2026-07-04T00:00:00.000Z",
  reviewDueAt: "2026-07-05T00:00:00.000Z"
};

// 真机上插件整个不显示,查了半天:宿主在 onActivate 之后 2 毫秒就来读视图
// (探针实测 06:35:52.247 onActivate → .249 compactView),这时第一批卡还在网上。
// 那会儿 precedence 返回 0 就等于当场把刘海槽位还回去,而重画定时器只给还在岛上的
// 模块跑 —— 卡 240 毫秒后回来了也没人再来读。表现是「有时看得到有时看不到」。
describe("第一批卡还没到的时候", () => {
  it("不还槽位:一次都没拉回来时 precedence 必须保持 1", () => {
    setState({ cards: [], lastFetchAt: 0 });

    expect(minimalPrecedence()).toBe(1);
  });

  it("已经拉回来了但库里真没卡,才把槽位还回去", () => {
    setState({ cards: [], lastFetchAt: 1754300000000 });

    expect(minimalPrecedence()).toBe(0);
  });

  it("有卡当然占着槽位", () => {
    setState({ cards: [richCard], lastFetchAt: 1754300000000 });

    expect(minimalPrecedence()).toBe(1);
  });

  it("加载中不能交白卷:侧槽位和小药丸都得画点东西出来", () => {
    setState({ cards: [], lastFetchAt: 0 });

    expect(minimalLeading()).not.toBeNull();
    expect(compactView()).not.toBeNull();
  });

  it("确认库里没卡之后才允许什么都不画", () => {
    setState({ cards: [], lastFetchAt: 1754300000000 });

    expect(minimalLeading()).toBeNull();
    expect(compactView()).toBeNull();
  });
});

describe("splitTitle", () => {
  it("splits at a full-width colon into kicker and head", () => {
    expect(splitTitle(richCard)).toEqual({
      kicker: "Auxiliary-Loss-Free Load Balancing",
      head: "去掉辅助损失，MoE 也能均衡"
    });
  });

  it("splits at a half-width colon too", () => {
    expect(splitTitle({ title: "MoE: sparse activation" }).head).toBe("sparse activation");
  });

  it("falls back to the first concept when there is no colon", () => {
    expect(splitTitle({ title: "没有冒号的标题", conceptIds: ["RAG"] })).toEqual({
      kicker: "RAG",
      head: "没有冒号的标题"
    });
  });

  it("does not split when the colon is the last character", () => {
    expect(splitTitle({ title: "标题就这样：", conceptIds: [] }).head).toBe("标题就这样：");
  });
});

describe("headIsBig", () => {
  it("keeps a short Chinese head at the 26pt size", () => {
    expect(headIsBig("去掉辅助损失，MoE 也能均衡")).toBe(true);
  });

  it("drops the 96-character English title down a size", () => {
    expect(headIsBig(degenerateCard.title)).toBe(false);
  });

  it("drops a 20-character Chinese head down a size", () => {
    expect(headIsBig("二十个汉字的标题会超出一行放不下的情况")).toBe(false);
  });
});

describe("bylineOf", () => {
  it("skips the segment that already appears as the kicker", () => {
    expect(bylineOf(richCard, "Auxiliary-Loss-Free Load Balancing")).toBe("LLMS3");
  });

  it("keeps the first segment when it does not duplicate the kicker", () => {
    expect(bylineOf(richCard, "别的眉题")).toBe("Auxiliary-Loss-Free Load Balancing");
  });

  it("truncates the 177-character source title instead of letting it run", () => {
    const long = { sourceTitle: "A".repeat(177) };

    expect(bylineOf(long, "").length).toBe(40);
    expect(bylineOf(long, "").endsWith("…")).toBe(true);
  });

  it("returns an empty string when the card has no source title", () => {
    expect(bylineOf({}, "")).toBe("");
  });
});

describe("stripDuplicateLead", () => {
  it("drops the repeated first sentence when the body starts with the title", () => {
    const stripped = stripDuplicateLead(
      degenerateCard.shortBody,
      degenerateCard.title,
      degenerateCard.title
    );

    expect(stripped).toBe("");
  });

  it("leaves a body that does not repeat the title untouched", () => {
    expect(stripDuplicateLead("完全不同的正文。", "标题", "标题")).toBe("完全不同的正文。");
  });

  it("keeps the remainder when only the first sentence repeats", () => {
    const text = "重复的开头句。后面还有真内容。";

    expect(stripDuplicateLead(text, "重复的开头句", "重复的开头句")).toBe("后面还有真内容。");
  });
});

describe("bodyTextOf", () => {
  it("picks the longest surviving prose", () => {
    expect(bodyTextOf(richCard)).toBe(richCard.shortBody);
  });

  it("falls back to the hook when title and body are the same sentence", () => {
    expect(bodyTextOf(degenerateCard)).toBe(degenerateCard.hook);
  });
});

describe("paginate", () => {
  it("breaks at a sentence stop rather than mid-clause", () => {
    const pages = paginate("第一句话结束。第二句话也结束。", 8);

    expect(pages[0]).toBe("第一句话结束。");
  });

  it("loses no characters across pages", () => {
    const pages = paginate(richCard.shortBody, 40);

    expect(pages.length).toBeGreaterThan(1);
    expect(pages.join("").replace(/\s/g, "")).toBe(richCard.shortBody.replace(/\s/g, ""));
  });

  it("hard-splits text with no sentence stops instead of returning one huge page", () => {
    const pages = paginate("一".repeat(50), 10);

    expect(pages.length).toBe(5);
  });

  it("returns nothing for empty input", () => {
    expect(paginate("", 40)).toEqual([]);
  });
});

describe("layoutOf", () => {
  it("gives a big headline card three body lines and no review question", () => {
    const view = layoutOf(richCard);

    expect(view.big).toBe(true);
    expect(view.deckLines).toBe(2);
    expect(view.bodyLines).toBe(3);
    expect(view.showPrompt).toBe(false);
  });

  it("shows the review question only when the card is actually due, and pays for it in body lines", () => {
    const view = layoutOf(degenerateCard);

    expect(view.big).toBe(false);
    expect(view.showPrompt).toBe(true);
    expect(view.bodyLines).toBe(1);
  });

  it("never lays out more than the 172 points the panel actually has", () => {
    for (const card of [richCard, degenerateCard, { title: "光秃秃的卡", conceptIds: [] }]) {
      const view = layoutOf(card);
      const used =
        25 +
        (view.big ? 30 : 38) +
        11 +
        (view.deckLines ? view.deckLines * 17 + 3 : 0) +
        (view.showPrompt ? 17 : 0) +
        view.bodyLines * 14 +
        25;

      expect(used).toBeLessThanOrEqual(172);
    }
  });
});

describe("pagesOf", () => {
  it("appends a concept page after the body pages", () => {
    const pages = pagesOf(richCard);

    expect(pages.length).toBeGreaterThan(1);
    expect(pages[pages.length - 1].kind).toBe("concepts");
    expect(pages.slice(0, -1).every((page) => page.kind === "body")).toBe(true);
  });

  it("still returns one body page when the card has no prose and no concepts", () => {
    expect(pagesOf({ title: "光秃秃的卡", conceptIds: [] })).toEqual([{ kind: "body", text: "" }]);
  });

  // 曾经切出过 10 页,第二页只有「实验在 o」四个字 —— 余量是估的,不是第一页真断在哪。
  it("never leaves a sliver page: every body page carries a real share of the text", () => {
    // 关键是「总量刚过第一页容量,而第一句很早就有句号」:第一页在句号处提前断,
    // 真实余量远大于「总量减去第一页容量」这个估算值。这正是线上切出十页的那一种。
    const card = {
      ...richCard,
      shortBody: "很短的第一句。" + "接着是一段一直没有句号的连续文字".repeat(11) + "。"
    };

    const bodyPages = pagesOf(card).filter((page) => page.kind === "body");
    const longest = Math.max(...bodyPages.map((page) => page.text.length));

    expect(bodyPages.length).toBeGreaterThan(1);
    expect(bodyPages.length).toBeLessThanOrEqual(3);

    // 第一页是完整的一句,短是正常的;从第二页起不许出现只有几个字的碎页。
    for (const page of bodyPages.slice(1)) {
      expect(page.text.length).toBeGreaterThan(longest * 0.4);
    }
  });

  it("keeps every character of the body across its pages", () => {
    const joined = pagesOf(richCard)
      .filter((page) => page.kind === "body")
      .map((page) => page.text)
      .join("")
      .replace(/\s/g, "");

    expect(joined).toBe(bodyTextOf(richCard).replace(/\s/g, ""));
  });
});
