(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const setInputValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.focus();
    // Headless pages have no window focus; React 17+ delegates onFocus via focusin.
    input.dispatchEvent(new FocusEvent("focus", { bubbles: false }));
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
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
  // Light theme (headless prefers dark).
  for (let i = 0; i < 4; i += 1) {
    if ((document.documentElement.getAttribute("data-theme") ?? "dark") === "light") break;
    document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "t" }));
    await sleep(150);
  }

  const composer = document.querySelector('input[aria-label="问知识库"]');
  if (!composer) return "error=no-composer";

  setInputValue(composer, "RAG 和微调该怎么选?");
  await sleep(150);
  composer.closest("form")?.requestSubmit();

  const chip = await waitFor(() => document.querySelector("button.x-chip.action"));
  if (!chip) return "error=no-chip";

  if (location.hash.includes("clicked")) {
    chip.click();
    const note = await waitFor(() => document.querySelector(".x-discover-note"));
    return `mode=clicked;note=${note ? note.textContent.slice(0, 30) : "missing"}`;
  }

  return `mode=chip;label=${chip.textContent}`;
})();
