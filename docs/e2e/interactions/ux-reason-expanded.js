(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, timeoutMs = 8000) => {
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

  const why = await waitFor(() => document.querySelector(".x-ctxwhy"));
  if (!why) return "error=no-why-button";
  why.scrollIntoView({ block: "center" });
  await sleep(200);
  why.click();

  const detail = await waitFor(() => document.querySelector(".x-ctxdetail"));
  await sleep(300);
  return `detail=${detail ? detail.textContent.slice(0, 40) : "missing"}`;
})();
