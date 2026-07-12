(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, timeoutMs = 10000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const value = predicate();
      if (value) return value;
      await sleep(100);
    }
    return null;
  };

  await sleep(700);
  for (let i = 0; i < 4; i += 1) {
    if ((document.documentElement.getAttribute("data-theme") ?? "dark") === "light") break;
    document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "t" }));
    await sleep(150);
  }

  await waitFor(() => document.querySelector(".x-ctxline"));

  // 同源兜底卡可能排得靠后:逐屏滚动直到渲染出超出来源徽章。
  let chip = null;
  for (let i = 0; i < 30 && !chip; i += 1) {
    chip = document.querySelector(".x-beyond");
    if (chip) break;
    window.scrollBy(0, 1600);
    await sleep(350);
  }
  if (!chip) return "error=no-beyond-chip";

  chip.scrollIntoView({ block: "center" });
  await sleep(400);
  return `chip=${chip.textContent}`;
})();
