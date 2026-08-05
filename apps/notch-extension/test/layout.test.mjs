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
  "state",
  "PANEL_W",
  "PANEL_H",
  "LH_BODY",
  "LH_SUB",
  "BLOCK_GAP",
  "CONT_LINES"
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
  state,
  lineCount,
  PANEL_W,
  PANEL_H,
  LH_BODY,
  LH_SUB,
  BLOCK_GAP,
  CONT_LINES
} = api;

// 版面尺寸会变(面板从 658×180 放大到 900×520 就是一次),所以断言一律跟着画布算,
// 不写死点数。写死的话每次调画布都要改一堆测试,而且改完只是让它们重新变绿,
// 并不代表版面还是对的。
function longerThanOnePage(multiple = 3) {
  const unitsPerPage = ((PANEL_H / LH_BODY) * PANEL_W) / 11;
  const sentence = "这一句是用来把正文撑到超过一整页的填充文字。";

  return sentence.repeat(Math.ceil((unitsPerPage * multiple) / sentence.length));
}

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
  it("gives a short-titled card the big headline, a deck, and the rest as body", () => {
    const view = layoutOf(richCard);

    expect(view.big).toBe(true);
    expect(view.deckLines).toBeGreaterThan(0);
    // 导语只占几行,剩下的都该给正文 —— 别的比例关系都会随画布变,这条不会。
    expect(view.bodyLines).toBeGreaterThan(view.deckLines);
    expect(view.showPrompt).toBe(false);
  });

  it("shows the review question only when the card is actually due, and pays for it in body lines", () => {
    const due = layoutOf(degenerateCard);
    const notDue = layoutOf({ ...degenerateCard, reviewDueAt: undefined });

    expect(due.big).toBe(false);
    expect(due.showPrompt).toBe(true);
    expect(notDue.showPrompt).toBe(false);
    // 问题那一行的高度得从正文里扣,不能白拿。
    expect(due.bodyLines).toBeLessThan(notDue.bodyLines);
  });

  it("never lays out more than the height the panel actually has", () => {
    for (const card of [richCard, degenerateCard, { title: "光秃秃的卡", conceptIds: [] }]) {
      const view = layoutOf(card);
      const used =
        25 +
        (view.big ? 30 : 38) +
        11 +
        (view.deckLines ? view.deckLines * 17 + 3 : 0) +
        (view.showPrompt ? 17 : 0) +
        view.bodyLines * LH_BODY +
        25;

      expect(used).toBeLessThanOrEqual(PANEL_H);
    }
  });
});

// 一页是若干「块」拼出来的:一块正文(可带小题),或末尾那个概念索引框。
// 断言都对着块走 —— 「哪一段在第几页」是排版算出来的,不该写进测试里。
const blocksOf = (pages) => pages.flatMap((page) => page.blocks);
const proseOf = (pages) => blocksOf(pages).filter((block) => !block.concepts);
const subheadsOf = (pages) => proseOf(pages).filter((b) => b.subhead).map((b) => b.subhead);

// 独立于产品代码再算一遍一块占多高,用来验「这一页塞过头了没有」。
const heightOf = (block) =>
  (block.subhead ? LH_SUB + 2 : 0) + Math.max(1, lineCount(block.text, PANEL_W, 11)) * LH_BODY;

describe("pagesOf", () => {
  it("puts the concept index last, once", () => {
    const pages = pagesOf(richCard);
    const blocks = blocksOf(pages);

    expect(blocks.filter((block) => block.concepts).length).toBe(1);
    expect(blocks[blocks.length - 1].concepts).toBe(true);
  });

  it("still returns one body page when the card has no prose and no concepts", () => {
    expect(pagesOf({ title: "光秃秃的卡", conceptIds: [] })).toEqual([
      { kind: "body", blocks: [{ text: "" }] }
    ]);
  });

  // 这是放大面板的目的:一段一百来字的 thread 独占一整页,在 512 点高的面板上只填得掉一成,
  // 剩下九成全是黑的。装得下就得接着往同一页上放。
  it("packs short sections onto the same page as the lead instead of one page each", () => {
    const card = {
      ...richCard,
      sections: [
        { title: "为什么 bias 循环能替代 auxiliary loss？", body: "核心机制是在 top-K 路由前给每个 expert 加 bias。" },
        { title: "一个 expert 过载时会发生什么？", body: "假设某层里 expert A 吸引了过多 token，负载明显高于其他 expert。" }
      ]
    };

    const pages = pagesOf(card);

    expect(pages.length).toBe(1);
    // 导语正文在最前,两段各带小题跟在后面,概念索引框收尾。
    expect(pages[0].blocks[0].subhead).toBeUndefined();
    expect(subheadsOf(pages)).toEqual([
      "为什么 bias 循环能替代 auxiliary loss？",
      "一个 expert 过载时会发生什么？"
    ]);
  });

  // 真机上量过:整张卡的正文正好填满第一页,只有几行高的概念索引框被挤到第二页,
  // 那一页就填掉一成,剩下九成全黑。正文再长也不许出现这种页。
  it("never leaves the concept index alone on a page", () => {
    const lonely = [];

    for (let n = 1; n <= 24; n += 1) {
      const body = longerThanOnePage(n / 8);
      const cards = [
        { ...richCard, sections: [{ title: "一段", body }] },
        { ...richCard, shortBody: body, summary: body }
      ];

      for (const card of cards) {
        const last = pagesOf(card).slice(-1)[0];

        if (last.blocks.length === 1 && last.blocks[0].concepts) {
          lonely.push(`${n}/8 页正文,${card.sections ? "有段落" : "只有概要"}`);
        }
      }
    }

    expect(lonely).toEqual([]);
  });

  // 一路塞满了往下翻,末页只剩一小截:前一页一行黑边都没有,末页黑掉三分之二。
  it("evens out the last page instead of leaving it nearly empty", () => {
    const sections = Array.from({ length: 6 }, (_, i) => ({
      title: `第 ${i + 1} 段`,
      body: longerThanOnePage(0.18)
    }));
    const pages = pagesOf({ ...richCard, sections });
    const filled = pages.map((page) =>
      page.blocks.reduce((sum, block) => sum + (block.concepts ? 0 : heightOf(block)), 0)
    );

    expect(pages.length).toBeGreaterThan(1);
    // 末页装的正文不许少于最满那页的一半(不均衡时这里只有三分之一)。
    expect(filled[filled.length - 1]).toBeGreaterThan(Math.max(...filled) * 0.5);
  });

  // 塞归塞,不能塞到版心外面去 —— 塞过头就是文字被裁掉,比留黑更糟。
  it("never packs a page past the height it has", () => {
    const card = {
      ...richCard,
      conceptIds: [],
      sections: [
        { title: "一", body: longerThanOnePage(0.4) },
        { title: "二", body: longerThanOnePage(0.5) },
        { title: "三", body: longerThanOnePage(1.4) },
        { title: "四", body: "短短一句。" }
      ]
    };

    const pages = pagesOf(card);
    const room = [layoutOf(card).bodyLines * LH_BODY, CONT_LINES * LH_BODY];

    expect(pages.length).toBeGreaterThan(1);

    pages.forEach((page, i) => {
      const used = page.blocks.reduce((sum, block) => sum + heightOf(block), 0);

      expect(used + (page.blocks.length - 1) * BLOCK_GAP).toBeLessThanOrEqual(room[i ? 1 : 0]);
    });
  });

  // 曾经切出过 10 页,第二页只有「实验在 o」四个字 —— 余量是估的,不是第一页真断在哪。
  it("never leaves a sliver: every body block carries a real share of the text", () => {
    // 关键是「总量刚过第一页容量,而第一句很早就有句号」:第一页在句号处提前断,
    // 真实余量远大于「总量减去第一页容量」这个估算值。这正是线上切出十页的那一种。
    const card = { ...richCard, shortBody: "很短的第一句。" + longerThanOnePage(1.2) + "。" };
    const blocks = proseOf(pagesOf(card));
    const longest = Math.max(...blocks.map((block) => block.text.length));

    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks.length).toBeLessThanOrEqual(3);

    // 第一块是完整的一句,短是正常的;从第二块起不许出现只有几个字的碎块。
    for (const block of blocks.slice(1)) {
      expect(block.text.length).toBeGreaterThan(longest * 0.4);
    }
  });

  it("keeps every character of every section across its pages", () => {
    // 长度按画布算,画布再变也还是「超过一页」,不会退化成空跑一遍断言。
    const long = longerThanOnePage(3);
    const parts = proseOf(pagesOf({ ...richCard, sections: [{ title: "长段", body: long }] })).filter(
      (block) => block.subhead === "长段"
    );

    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((block) => block.text).join("").replace(/\s/g, "")).toBe(long.replace(/\s/g, ""));
  });

  // 真机渲染出来看到的:一段 333 字的 thread 切成「装满的一页 + 只有一行的一页」,
  // 第二页下面一大片黑。按上限硬切必然这样,要先算出至少几页再均分。
  it("splits an overflowing section evenly instead of leaving a one-line page", () => {
    const parts = proseOf(
      pagesOf({ ...richCard, sections: [{ title: "长段", body: longerThanOnePage(1.6) }] })
    ).filter((block) => block.subhead === "长段");
    const sizes = parts.map((block) => block.text.length);

    expect(parts.length).toBeGreaterThan(1);
    // 最短的一片不许短于最长那片的六成 —— 这就是「碎页」的判据。
    expect(Math.min(...sizes)).toBeGreaterThan(Math.max(...sizes) * 0.6);
  });

  it("drops the tail of an over-long lead when sections say the same thing in more detail", () => {
    const lead = longerThanOnePage(2);
    const withSections = proseOf(pagesOf({ ...richCard, shortBody: lead, summary: lead, sections: [{ title: "细说", body: "这一段把概要展开讲。" }] }));

    // 导语只占头版一块,后面接的是带小题的段落,不为导语的尾巴再开一块。
    expect(withSections.filter((block) => !block.subhead).length).toBe(1);
    expect(subheadsOf([{ blocks: withSections }])).toEqual(["细说"]);
  });

  it("still pages the lead to the end when the card has no sections", () => {
    // 长度按画布算,保证真的要翻页。
    const lead = longerThanOnePage(2);
    const blocks = proseOf(pagesOf({ ...richCard, shortBody: lead, summary: lead }));

    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks.map((block) => block.text).join("").replace(/\s/g, "")).toBe(lead.replace(/\s/g, ""));
  });

  it("skips sections with no prose instead of emitting a blank block", () => {
    const pages = pagesOf({
      ...richCard,
      sections: [{ title: "空的", body: "   " }, { title: "有内容", body: "真的有正文。" }]
    });

    expect(subheadsOf(pages)).toEqual(["有内容"]);
  });

  it("keeps every character of the body across its pages", () => {
    const joined = proseOf(pagesOf(richCard))
      .map((block) => block.text)
      .join("")
      .replace(/\s/g, "");

    expect(joined).toBe(bodyTextOf(richCard).replace(/\s/g, ""));
  });
});
