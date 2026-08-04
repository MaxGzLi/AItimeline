// AITimeline Clipper — content script for x.com / twitter.com.
// Adds one restrained "保存" button to each tweet's action bar; clicking sends
// the tweet (text + author + permalink + time) to the background service
// worker, which relays it to the local AITimeline API.
//
// 保存之上的三层体验(spec: docs/specs/2026-08-04-extension-refinement.md):
// - 悬停「保存」浮出分类条(候选来自本机知识库的兴趣主题+学习目标,可自由输入),
//   点分类=带 topic 保存;直接点「保存」的一键心流不变。
// - 折叠长推文不静默存半截:点保存时先就地点开 X 的「显示更多」把正文补全再存
//   (幂等去重意味着第一次存半截会永久污染,必须在源头拦);X Article 页面
//   提取完整正文。
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
    error: "重试"
  };

  function extractArticleText(article) {
    // X Article(长文)在详情页展开成 twitterArticle 结构,tweetText 只有摘要;
    // 有这个结构就用它的全文。选择器以真机验证为准(README 已知限制)。
    const articleEl = article.querySelector('[data-testid="twitterArticle"]');
    const text = articleEl ? articleEl.innerText.trim() : "";

    return text || null;
  }

  /** 推文自带的配图与视频 poster(排除引用块里的、头像表情等非正文图)。
   *  只收 URL,下载在服务端做;video 的 url 由调用方补推文永久链接。 */
  function extractCapturedMedia(article) {
    const media = [];

    for (const img of article.querySelectorAll('[data-testid="tweetPhoto"] img')) {
      if (media.length >= 4) {
        break;
      }

      if (img.closest('div[role="link"]')) {
        continue;
      }

      const src = img.currentSrc || img.src || "";

      if (!src.includes("pbs.twimg.com/media")) {
        continue;
      }

      let url = src;

      try {
        // 时间线上是缩略图(name=small/medium),存大图。
        const parsed = new URL(src);

        parsed.searchParams.set("name", "large");
        url = parsed.toString();
      } catch {
        // URL 解析不了就按原样存。
      }

      media.push({ kind: "image", url });
    }

    const video = article.querySelector("video[poster]");

    if (video && !video.closest('div[role="link"]') && /^https?:/.test(video.poster)) {
      media.push({ kind: "video", url: "", posterUrl: video.poster });
    }

    return media;
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
    const url = `https://x.com${permalinkPath}`;
    const userNameEl = article.querySelector('[data-testid="User-Name"]');
    const authorParts = userNameEl
      ? userNameEl.innerText.split("\n").map((part) => part.trim()).filter(Boolean)
      : [];

    return {
      url,
      text,
      author: authorParts[0] || "",
      handle: authorParts.find((part) => part.startsWith("@")) || "",
      postedAt: timeEl ? timeEl.getAttribute("datetime") : null,
      // 视频没有独立文件链接,推文永久链接就是它的链接。
      media: extractCapturedMedia(article).map((item) => (item.kind === "video" ? { ...item, url } : item))
    };
  }

  /** 时间线上被折叠的长推文(「显示更多」标记)。只认外层推文自己的折叠:
   *  内嵌引用块(div[role="link"])里的标记不算,否则「引用了长推的普通推文」
   *  会被永久钉在导流态,在详情页也解不开。 */
  function isFoldedTweet(article) {
    if (article.querySelector('[data-testid="twitterArticle"]')) {
      return false;
    }

    return [...article.querySelectorAll('[data-testid="tweet-text-show-more-link"]')].some(
      (marker) => !marker.closest('div[role="link"]')
    );
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

  // 保存状态的真身:URL → "saved"|"known"|"carded"。按钮节点会被 X 的 React
  // 重渲染整个换掉,状态只写在节点上就丢了;补挂时从这里恢复,回执也靠它落地。
  const stateByUrl = new Map();

  function startSave(button, topic) {
    if (["saving", "saved", "known", "carded"].includes(button.dataset.state)) {
      return;
    }

    const article = button.closest('article[data-testid="tweet"]');
    const tweet = article ? extractTweet(article) : null;

    if (!tweet) {
      hideChipBar();
      setButtonState(button, "error");
      button.title = "没有找到可保存的推文内容";
      return;
    }

    hideChipBar();
    setButtonState(button, "saving");

    try {
      chrome.runtime.sendMessage({ type: "AITL_SAVE_TWEET", tweet: { ...tweet, topic: topic || undefined } }, (response) => {
        // 响应回来时原按钮可能已被 React 换掉:状态写到当前挂载的那个上。
        const target = button.isConnected ? button : findButtonByUrl(tweet.url) || button;

        if (chrome.runtime.lastError || !response || !response.ok) {
          // 失败时记住已选分类,点「重试」不丢。
          target.dataset.aitlTopic = topic || "";
          setButtonState(target, "error");
          target.title = chrome.runtime.lastError
            ? "无法连接扩展后台,刷新页面重试"
            : (response && response.error) || "保存失败,点击重试";
          return;
        }

        delete target.dataset.aitlTopic;
        target.dataset.aitlUrl = tweet.url;

        const state = response.status === "imported" ? "carded" : response.alreadyKnown ? "known" : "saved";

        stateByUrl.set(tweet.url, state);
        setButtonState(target, state);
        target.title = state === "carded" ? "已经是知识卡了" : "已交给本机 AITimeline";
      });
    } catch {
      // 扩展被重载/更新后旧页面的 chrome.runtime 失效,不再永久卡「保存中…」。
      button.dataset.aitlTopic = topic || "";
      setButtonState(button, "error");
      button.title = "扩展已更新,请刷新页面";
    }
  }

  /** 按已知的推文 URL 找当前挂载的保存按钮(先认 dataset,再逐个比对永久链接)。 */
  function findButtonByUrl(url) {
    for (const candidate of document.querySelectorAll(`.${BUTTON_CLASS}`)) {
      if (candidate.dataset.aitlUrl === url) {
        return candidate;
      }
    }

    for (const candidate of document.querySelectorAll(`.${BUTTON_CLASS}`)) {
      const article = candidate.closest('article[data-testid="tweet"]');
      const tweet = article ? extractTweet(article) : null;

      if (tweet && tweet.url === url) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * 就地展开被折叠的长推文:X 的「显示更多」是个 button(没有 href),点它
   * 当场把正文补全、不跳转(2026-08-04 真机实测:169 字 → 364 字,标记消失)。
   * 展开成功返回 true;超时说明这版 X 不是就地展开,交给调用方走详情页兜底。
   */
  async function expandFoldedTweet(article) {
    const marker = [...article.querySelectorAll('[data-testid="tweet-text-show-more-link"]')].find(
      (item) => !item.closest('div[role="link"]')
    );

    if (!marker) {
      return true;
    }

    marker.click();

    // 实测就地展开耗时 0.9-1.0 秒,留到 2.5 秒:超时会白跑一次详情页跳转。
    for (let attempt = 0; attempt < 25; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));

      if (!isFoldedTweet(article)) {
        return true;
      }
    }

    return false;
  }

  async function onSaveClick(event) {
    const button = event.currentTarget;
    const topic = button.dataset.aitlTopic || null;
    const article = button.closest('article[data-testid="tweet"]');
    const tweet = article ? extractTweet(article) : null;

    if (tweet && isFoldedTweet(article)) {
      // 折叠的长推只有半截正文,直接存会被 URL 幂等去重永久钉死。先当场展开,
      // 展开完再存全文——一次点击,不离开时间线。
      hideChipBar();
      setButtonState(button, "saving");

      const expanded = await expandFoldedTweet(article);
      // 展开过程中 X 可能重渲染掉按钮节点。
      const target = button.isConnected ? button : findButtonByUrl(tweet.url) || button;

      if (expanded) {
        setButtonState(target, "idle");
        startSave(target, topic);
        return;
      }

      // 就地展开不成:退回详情页存全文;已经在详情页就照常存(避免原地刷新死循环)。
      if (new URL(tweet.url).pathname !== location.pathname) {
        location.assign(tweet.url);
        return;
      }

      setButtonState(target, "idle");
      startSave(target, topic);
      return;
    }

    startSave(button, topic);
  }

  // ---------- 分类条(悬停「保存」浮出) ----------
  // 壳用 X 的悬浮菜单语法;候选来自 GET /api/captures/context(经 background),
  // 拉不到就只剩自由输入。点分类 = 带 topic 保存,不点 = 现有一键保存不变。

  const CHIP_LIMIT = 8;
  let chipBar = null;
  let chipInput = null;
  let chipTargetButton = null;
  let chipTargetUrl = null;
  let chipShowTimer = null;
  let chipHideTimer = null;
  let chipTopics = null;
  let chipContextRequested = false;

  /** 分类条开着的这段时间里按钮可能被 React 换掉:提交时按 URL 找回现挂载的那个。 */
  function resolveChipTarget() {
    if (chipTargetButton && chipTargetButton.isConnected) {
      return chipTargetButton;
    }

    return chipTargetUrl ? findButtonByUrl(chipTargetUrl) : null;
  }

  function commitChipSave(topic) {
    const target = resolveChipTarget();

    if (!target) {
      hideChipBar();
      return;
    }

    startSave(target, topic);
  }

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
          positionChipBar();
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
      if (event.key === "Enter" && chipInput.value.trim()) {
        commitChipSave(chipInput.value.trim());
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
        commitChipSave(topic);
      });
      chips.appendChild(chip);
    }

    chips.style.display = chips.childElementCount ? "" : "none";
  }

  /** 悬浮位置:优先贴按钮下方,放不下翻到上方。候选 chips 异步到达会让条长高,
   *  重新渲染后必须再调用一次,不然可能盖住按钮或伸出视口。 */
  function positionChipBar() {
    const anchor = chipTargetButton && chipTargetButton.isConnected ? chipTargetButton : null;

    if (!anchor) {
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const barRect = chipBar.getBoundingClientRect();

    chipBar.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - barRect.width - 8))}px`;
    chipBar.style.top =
      rect.bottom + barRect.height + 8 > window.innerHeight
        ? `${rect.top - barRect.height - 6}px`
        : `${rect.bottom + 6}px`;
  }

  function showChipBar(button) {
    ensureChipBar();
    requestCaptureContext();
    chipTargetButton = button;

    const article = button.closest('article[data-testid="tweet"]');
    const tweet = article ? extractTweet(article) : null;

    chipTargetUrl = tweet ? tweet.url : null;
    chipBar.dataset.aitlTheme = currentTheme();
    renderChips();
    chipInput.value = "";
    chipBar.style.display = "";
    positionChipBar();
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
    chipTargetUrl = null;
  }

  function scheduleChipBarHide() {
    // 指针离开按钮:待弹的条不再弹,已弹的条略延迟收(给移向条本体留缝)。
    if (chipShowTimer !== null) {
      clearTimeout(chipShowTimer);
      chipShowTimer = null;
    }

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

    if (button.dataset.state !== "idle" && button.dataset.state !== "error") {
      return;
    }

    if (chipHideTimer !== null) {
      clearTimeout(chipHideTimer);
      chipHideTimer = null;
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

    // 先记状态再找按钮:就算此刻按钮被 React 换掉了,补挂时也会恢复成「已成卡」。
    stateByUrl.set(message.url, "carded");

    const button = findButtonByUrl(message.url);

    if (button) {
      setButtonState(button, "carded");
      button.dataset.aitlUrl = message.url;
      button.title = "已转成知识卡";
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

    // 没有永久链接的条目(广告位实测如此:有正文有操作栏,但没有 time 元素)
    // 根本存不了,不挂按钮。标记成 skip,免得补挂逻辑每轮重试。
    const tweet = extractTweet(article);

    if (!tweet) {
      article.setAttribute(PROCESSED_ATTR, "skip");
      return;
    }

    article.setAttribute(PROCESSED_ATTR, "1");

    const button = document.createElement("button");

    button.type = "button";
    button.className = BUTTON_CLASS;

    // 这条推文之前存过的话(按钮被 React 换掉重挂),从 URL 状态表恢复,
    // 不然「已保存/已成卡」会退回「保存」,回执也找不到按钮。
    const savedState = stateByUrl.get(tweet.url);

    if (savedState) {
      setButtonState(button, savedState);
      button.dataset.aitlUrl = tweet.url;
      button.title = savedState === "carded" ? "已转成知识卡" : "已交给本机 AITimeline";
    } else {
      // 折叠的长推也照常显示「保存」:点击时先就地展开再存,不额外多一步。
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
    // skip 的条目本来就没按钮,不参与补挂(否则每轮都白试一次)。
    document.querySelectorAll(`article[data-testid="tweet"][${PROCESSED_ATTR}="1"]`).forEach((article) => {
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
