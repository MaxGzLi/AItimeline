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
    if ((document.documentElement.getAttribute("data-theme") ?? "light") === "dark") break;
    document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "t" }));
    await sleep(150);
  }

  const ctx = await waitFor(() => document.querySelector(".x-ctxline"));
  if (!ctx) return "error=no-ctxline";
  await sleep(400);
  return `theme=${document.documentElement.getAttribute("data-theme")}`;
})();
