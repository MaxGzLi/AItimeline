(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const dispatchThemeToggle = () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "t" }));
  };

  const setTheme = async () => {
    const wantTheme = location.hash.includes("dark") ? "dark" : "light";

    for (let i = 0; i < 4; i += 1) {
      const current = document.documentElement.getAttribute("data-theme") ?? "dark";
      if (current === wantTheme) {
        return;
      }
      dispatchThemeToggle();
      await sleep(150);
    }
  };

  const setInputValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.focus();
    input.dispatchEvent(new FocusEvent("focus", { bubbles: false }));
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const waitFor = async (predicate, timeoutMs = 5000) => {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const value = predicate();
      if (value) {
        return value;
      }
      await sleep(100);
    }

    return null;
  };

  const submitForm = (form) => {
    if (form.requestSubmit) {
      form.requestSubmit();
      return;
    }

    form.querySelector('button[type="submit"]')?.click();
  };

  await sleep(700);
  await setTheme();

  const mode = location.hash.includes("detail") ? "detail" : "feed";

  if (mode === "feed") {
    const showMore = await waitFor(() => document.querySelector(".x-showmore"), 4000);

    if (showMore) {
      showMore.scrollIntoView({ block: "center" });
      await sleep(300);
    }

    return [
      "mode=feed",
      `theme=${document.documentElement.getAttribute("data-theme")}`,
      `posts=${document.querySelectorAll(".x-post").length}`,
      `showMore=${document.querySelectorAll(".x-showmore").length}`
    ].join(";");
  }

  const targetPost = await waitFor(() => {
    const posts = Array.from(document.querySelectorAll(".x-post"));
    return posts.find((post) => post.querySelector(".x-title")) ?? posts[0] ?? null;
  });

  if (!targetPost) {
    return "mode=detail;error=no-post";
  }

  targetPost.querySelector(".x-open")?.click();
  const detail = await waitFor(() => document.querySelector(".x-detail"), 4000);

  if (!detail) {
    return "mode=detail;error=no-detail";
  }

  const replyInput = await waitFor(() => document.querySelector('.x-detail-replies input[aria-label="回复"]'));
  if (replyInput) {
    setInputValue(replyInput, "这个细节和 [[Memory]] 的复习计划怎么接上?");
    await sleep(150);
    submitForm(replyInput.closest("form"));
    await waitFor(() => document.querySelectorAll(".x-detail-replies .x-reply").length >= 2, 5000);
  }

  const askInput = await waitFor(() => document.querySelector('.x-detail-ask input[aria-label="就这张卡片问 AI"]'));
  if (askInput) {
    setInputValue(askInput, "把这张卡和我的复习队列连起来。");
    await sleep(150);
    submitForm(askInput.closest("form"));
    await waitFor(() => document.querySelectorAll(".x-detail-msg").length >= 2, 5000);
  }

  window.scrollTo(0, 0);
  await sleep(300);

  return [
    "mode=detail",
    `theme=${document.documentElement.getAttribute("data-theme")}`,
    `replies=${document.querySelectorAll(".x-detail-replies .x-reply").length}`,
    `askMessages=${document.querySelectorAll(".x-detail-msg").length}`,
    `sections=${document.querySelectorAll(".x-detail-sec").length}`
  ].join(";");
})();
