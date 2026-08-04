// AITimeline Clipper — content script for x.com / twitter.com.
// Adds one restrained "保存" button to each tweet's action bar; clicking sends
// the tweet (text + author + permalink + time) to the background service
// worker, which relays it to the local AITimeline API.
//
// 保存之上的三层体验(spec: docs/specs/2026-08-04-extension-refinement.md):
// - 悬停「保存」浮出分类条(候选来自本机知识库的兴趣主题+学习目标,可自由输入),
//   点分类=带 topic 保存;直接点「保存」的一键心流不变。
// - 折叠长推文不静默存半截:按钮变「点开存全文」导流到详情页(幂等去重意味着
//   第一次存半截会永久污染,必须在源头拦);X Article 页面提取完整正文。
// - 成卡回执:background 轮询到剪藏转成知识卡后通知本页,按钮推进「已成卡」,
//   页面底部滑入一条可点开知识库的回执。

(() => {
  const BUTTON_CLASS = "aitl-save";
  const PROCESSED_ATTR = "data-aitl-processed";
  const WEB_APP_URL = "http://127.0.0.1:5173/";
  const LABELS = {
    idle: "保存",
    saving: "保存中…",
    saved: "已保存",
    known: "已存过",
    carded: "已成卡",
    expand: "点开存全文",
    error: "重试"
  };

  function extractArticleText(article) {
    // X Article(长文)在详情页展开成 twitterArticle 结构,tweetText 只有摘要;
    // 有这个结构就用它的全文。选择器以真机验证为准(README 已知限制)。
    const articleEl = article.querySelector('[data-testid="twitterArticle"]');
    const text = articleEl ? articleEl.innerText.trim() : "";

    return text || null;
  }

  function extractTweet(article) {
    const timeEl = article.querySelector("time[datetime]");
    const permalinkEl = timeEl ? timeEl.closest("a[href]") : null;
    const textEl = article.querySelector('[data-testid="tweetText"]');
    const text = extractArticleText(article) || (textEl ? textEl.innerText.trim() : "");

    if (!permalinkEl || !text) {
      return null;
    }

    // Canonicalize to x.com so the same tweet dedupes across both hostnames.
    const permalinkPath = new URL(permalinkEl.getAttribute("href"), "https://x.com").pathname;
    const userNameEl = article.querySelector('[data-testid="User-Name"]');
    const authorParts = userNameEl
      ? userNameEl.innerText.split("\n").map((part) => part.trim()).filter(Boolean)
      : [];

    return {
      url: `https://x.com${permalinkPath}`,
      text,
      author: authorParts[0] || "",
      handle: authorParts.find((part) => part.startsWith("@")) || "",
      postedAt: timeEl ? timeEl.getAttribute("datetime") : null
    };
  }

  /** 时间线上被折叠的长推文(「显示更多」标记)。详情页正文全展开,不会命中。 */
  function isFoldedTweet(article) {
    const marker = article.querySelector('[data-testid="tweet-text-show-more-link"]');

    return Boolean(marker) && !article.querySelector('[data-testid="twitterArticle"]');
  }

  function setButtonState(button, state) {
    button.dataset.state = state;
    button.textContent = LABELS[state];
    button.disabled = state === "saving";
  }

  function currentTheme() {
    // injectCore 在 manifest 里先于本文件加载;万一没有(加载序被改),退回纯黑。
    const core = globalThis.AITLInjectCore;

    return core ? core.classifyXTheme(getComputedStyle(document.body).backgroundColor) : "dark";
  }

  function startSave(button, topic) {
    if (["saving", "saved", "known", "carded"].includes(button.dataset.state)) {
      return;
    }

    const article = button.closest('article[data-testid="tweet"]');
    const tweet = article ? extractTweet(article) : null;

    if (!tweet) {
      setButtonState(button, "error");
      button.title = "没有找到可保存的推文内容";
      return;
    }

    hideChipBar();
    setButtonState(button, "saving");

    try {
      chrome.runtime.sendMessage({ type: "AITL_SAVE_TWEET", tweet: { ...tweet, topic: topic || undefined } }, (response) => {
        if (chrome.runtime.lastError || !response || !response.ok) {
          setButtonState(button, "error");
          button.title = chrome.runtime.lastError
            ? "无法连接扩展后台,刷新页面重试"
            : (response && response.error) || "保存失败,点击重试";
          return;
        }

        // 成卡回执按 URL 找回按钮(React 重渲染会换节点,兜底也扫得到)。
        button.dataset.aitlUrl = tweet.url;

        if (response.status === "imported") {
          setButtonState(button, "carded");
          button.title = "已经是知识卡了";
          return;
        }

        setButtonState(button, response.alreadyKnown ? "known" : "saved");
        button.title = "已交给本机 AITimeline";
      });
    } catch {
      // 扩展被重载/更新后旧页面的 chrome.runtime 失效,不再永久卡「保存中…」。
      setButtonState(button, "error");
      button.title = "扩展已更新,请刷新页面";
    }
  }

  function onSaveClick(event) {
    const button = event.currentTarget;

    if (button.dataset.state === "expand") {
      const article = button.closest('article[data-testid="tweet"]');
      const tweet = article ? extractTweet(article) : null;

      if (tweet) {
        location.assign(tweet.url);
      }

      return;
    }

    startSave(button, null);
  }

  // ---------- 分类条(悬停「保存」浮出) ----------
  // 壳用 X 的悬浮菜单语法;候选来自 GET /api/captures/context(经 background),
  // 拉不到就只剩自由输入。点分类 = 带 topic 保存,不点 = 现有一键保存不变。

  const CHIP_LIMIT = 8;
  let chipBar = null;
  let chipInput = null;
  let chipTargetButton = null;
  let chipShowTimer = null;
  let chipHideTimer = null;
  let chipTopics = null;
  let chipContextRequested = false;

  function requestCaptureContext() {
    if (chipContextRequested) {
      return;
    }

    chipContextRequested = true;

    try {
      chrome.runtime.sendMessage({ type: "AITL_FETCH_CAPTURE_CONTEXT" }, (response) => {
        if (chrome.runtime.lastError || !response || !response.ok) {
          // 允许下次悬停重试(API 可能晚于浏览器启动)。
          chipContextRequested = false;
          return;
        }

        chipTopics = response.topics;

        if (chipBar && chipBar.style.display !== "none") {
          renderChips();
        }
      });
    } catch {
      chipContextRequested = false;
    }
  }

  function ensureChipBar() {
    if (chipBar) {
      return chipBar;
    }

    chipBar = document.createElement("div");
    chipBar.className = "aitl-chipbar";
    chipBar.style.display = "none";

    const hint = document.createElement("div");

    hint.className = "aitl-chipbar-hint";
    hint.textContent = "存进分类";

    const chips = document.createElement("div");

    chips.className = "aitl-chipbar-chips";

    chipInput = document.createElement("input");
    chipInput.className = "aitl-chipbar-input";
    chipInput.type = "text";
    chipInput.placeholder = "自定义分类,回车保存";
    chipInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && chipInput.value.trim() && chipTargetButton) {
        startSave(chipTargetButton, chipInput.value.trim());
      }

      // 别让 X 的全局快捷键(j/k/l 等)吃掉输入。
      event.stopPropagation();
    });

    chipBar.append(hint, chips, chipInput);
    chipBar.addEventListener("mouseenter", () => {
      if (chipHideTimer !== null) {
        clearTimeout(chipHideTimer);
        chipHideTimer = null;
      }
    });
    chipBar.addEventListener("mouseleave", scheduleChipBarHide);
    document.body.appendChild(chipBar);

    return chipBar;
  }

  function renderChips() {
    const chips = chipBar.querySelector(".aitl-chipbar-chips");

    chips.textContent = "";

    for (const topic of (chipTopics || []).slice(0, CHIP_LIMIT)) {
      const chip = document.createElement("button");

      chip.type = "button";
      chip.className = "aitl-chipbar-chip";
      chip.textContent = topic;
      chip.addEventListener("click", () => {
        if (chipTargetButton) {
          startSave(chipTargetButton, topic);
        }
      });
      chips.appendChild(chip);
    }

    chips.style.display = chips.childElementCount ? "" : "none";
  }

  function showChipBar(button) {
    ensureChipBar();
    requestCaptureContext();
    chipTargetButton = button;
    chipBar.dataset.aitlTheme = currentTheme();
    renderChips();
    chipInput.value = "";
    chipBar.style.display = "";

    const rect = button.getBoundingClientRect();
    const barRect = chipBar.getBoundingClientRect();

    chipBar.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - barRect.width - 8))}px`;
    chipBar.style.top =
      rect.bottom + barRect.height + 8 > window.innerHeight
        ? `${rect.top - barRect.height - 6}px`
        : `${rect.bottom + 6}px`;
  }

  function hideChipBar() {
    if (chipShowTimer !== null) {
      clearTimeout(chipShowTimer);
      chipShowTimer = null;
    }

    if (chipBar) {
      chipBar.style.display = "none";
    }

    chipTargetButton = null;
  }

  function scheduleChipBarHide() {
    if (chipHideTimer !== null) {
      clearTimeout(chipHideTimer);
    }

    chipHideTimer = setTimeout(() => {
      chipHideTimer = null;
      hideChipBar();
    }, 250);
  }

  function onSaveButtonEnter(event) {
    const button = event.currentTarget;

    if (chipHideTimer !== null) {
      clearTimeout(chipHideTimer);
      chipHideTimer = null;
    }

    if (button.dataset.state !== "idle" && button.dataset.state !== "error") {
      return;
    }

    if (chipShowTimer !== null) {
      clearTimeout(chipShowTimer);
    }

    // 略延迟再浮出:扫过按钮不弹,停住才弹。
    chipShowTimer = setTimeout(() => {
      chipShowTimer = null;

      if (button.isConnected && (button.dataset.state === "idle" || button.dataset.state === "error")) {
        showChipBar(button);
      }
    }, 250);
  }

  // ---------- 成卡回执 ----------

  let receiptTimer = null;

  function showReceipt() {
    let receipt = document.querySelector(".aitl-receipt");

    if (!receipt) {
      receipt = document.createElement("div");
      receipt.className = "aitl-receipt";
      receipt.textContent = "已转成知识卡 · 在知识库中打开";
      receipt.addEventListener("click", () => {
        window.open(WEB_APP_URL, "_blank", "noopener");
      });
      document.body.appendChild(receipt);
    }

    if (receiptTimer !== null) {
      clearTimeout(receiptTimer);
    }

    receiptTimer = setTimeout(() => {
      receiptTimer = null;
      receipt.remove();
    }, 8000);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "AITL_CAPTURE_IMPORTED") {
      return;
    }

    for (const button of document.querySelectorAll(`.${BUTTON_CLASS}[data-aitl-url]`)) {
      if (button.dataset.aitlUrl === message.url) {
        setButtonState(button, "carded");
        button.title = "已转成知识卡";
      }
    }

    showReceipt();
  });

  // ---------- 挂载 ----------

  function attachButton(article) {
    const actionBar = article.querySelector('div[role="group"]');

    if (!actionBar) {
      // 操作栏还没渲染出来:不打标记,下轮扫描重试(打了标记就永远没按钮了)。
      return;
    }

    article.setAttribute(PROCESSED_ATTR, "1");

    const button = document.createElement("button");

    button.type = "button";
    button.className = BUTTON_CLASS;

    if (isFoldedTweet(article)) {
      // 折叠长文只有半截正文,存了会被幂等去重永久钉死,导流到详情页存全文。
      setButtonState(button, "expand");
      button.title = "长文被折叠,进详情页保存完整正文";
    } else {
      setButtonState(button, "idle");
      button.title = "保存到 AITimeline";
    }

    button.addEventListener("click", onSaveClick);
    button.addEventListener("mouseenter", onSaveButtonEnter);
    button.addEventListener("mouseleave", scheduleChipBarHide);
    actionBar.appendChild(button);
  }

  function scan() {
    document.querySelectorAll(`article[data-testid="tweet"]:not([${PROCESSED_ATTR}])`).forEach(attachButton);

    // React 重渲染会连按钮一起换掉 DOM,标记还留在 article 上:补挂。
    document.querySelectorAll(`article[data-testid="tweet"][${PROCESSED_ATTR}]`).forEach((article) => {
      if (!article.querySelector(`.${BUTTON_CLASS}`)) {
        article.removeAttribute(PROCESSED_ATTR);
        attachButton(article);
      }
    });
  }

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

  observer.observe(document.body, { childList: true, subtree: true });
  scan();
})();
