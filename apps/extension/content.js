// AITimeline Clipper — content script for x.com / twitter.com.
// Adds one restrained "保存" button to each tweet's action bar; clicking sends
// the tweet (text + author + permalink + time) to the background service
// worker, which relays it to the local AITimeline API.

(() => {
  const BUTTON_CLASS = "aitl-save";
  const PROCESSED_ATTR = "data-aitl-processed";
  const LABELS = {
    idle: "保存",
    saving: "保存中…",
    saved: "已保存",
    known: "已存过",
    error: "重试"
  };

  function extractTweet(article) {
    const timeEl = article.querySelector("time[datetime]");
    const permalinkEl = timeEl ? timeEl.closest("a[href]") : null;
    const textEl = article.querySelector('[data-testid="tweetText"]');
    const text = textEl ? textEl.innerText.trim() : "";

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

  function setButtonState(button, state) {
    button.dataset.state = state;
    button.textContent = LABELS[state];
    button.disabled = state === "saving";
  }

  function onSaveClick(event) {
    const button = event.currentTarget;

    if (button.dataset.state === "saving" || button.dataset.state === "saved" || button.dataset.state === "known") {
      return;
    }

    const article = button.closest('article[data-testid="tweet"]');
    const tweet = article ? extractTweet(article) : null;

    if (!tweet) {
      setButtonState(button, "error");
      button.title = "没有找到可保存的推文内容";
      return;
    }

    setButtonState(button, "saving");
    chrome.runtime.sendMessage({ type: "AITL_SAVE_TWEET", tweet }, (response) => {
      if (chrome.runtime.lastError || !response || !response.ok) {
        setButtonState(button, "error");
        button.title = chrome.runtime.lastError
          ? "无法连接扩展后台"
          : (response && response.error) || "保存失败,点击重试";
        return;
      }

      setButtonState(button, response.alreadyKnown ? "known" : "saved");
      button.title = "已交给本机 AITimeline";
    });
  }

  function attachButton(article) {
    if (article.hasAttribute(PROCESSED_ATTR)) {
      return;
    }

    article.setAttribute(PROCESSED_ATTR, "1");

    const actionBar = article.querySelector('div[role="group"]');

    if (!actionBar) {
      return;
    }

    const button = document.createElement("button");

    button.type = "button";
    button.className = BUTTON_CLASS;
    button.title = "保存到 AITimeline";
    setButtonState(button, "idle");
    button.addEventListener("click", onSaveClick);
    actionBar.appendChild(button);
  }

  function scan() {
    document.querySelectorAll(`article[data-testid="tweet"]:not([${PROCESSED_ATTR}])`).forEach(attachButton);
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
