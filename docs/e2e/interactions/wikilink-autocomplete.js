(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const setInputValue = (input, value, cursor = value.length) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.focus();
    // Headless pages never gain window focus (document.hasFocus() === false),
    // so native focus events don't fire and React's onFocus won't run.
    // React 17+ delegates onFocus via the bubbling focusin event — dispatch
    // both so the dropdown's focused-gate opens.
    input.dispatchEvent(new FocusEvent("focus", { bubbles: false }));
    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    input.setSelectionRange(cursor, cursor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("select", { bubbles: true }));
  };
  // Theme via URL hash: append "#dark" to capture dark mode. Headless Chrome
  // reports prefers-color-scheme: dark, so light must be toggled explicitly.
  const wantTheme = location.hash.includes("dark") ? "dark" : "light";
  for (let i = 0; i < 4; i += 1) {
    const current = document.documentElement.getAttribute("data-theme") ?? "dark";
    if (current === wantTheme) break;
    document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "t" }));
    await sleep(150);
  }
  const dispatchKey = (input, key) => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key });
    const allowed = input.dispatchEvent(event);
    return !allowed || event.defaultPrevented;
  };
  const waitForOptions = async (minCount = 1) => {
    for (let i = 0; i < 30; i += 1) {
      const options = Array.from(document.querySelectorAll(".x-wikilink-option"));

      if (options.length >= minCount) {
        return options;
      }

      await sleep(100);
    }

    return [];
  };

  await sleep(500);

  const composer = document.querySelector('input[aria-label="问知识库"]');

  if (!composer) {
    return "composer-missing";
  }

  setInputValue(composer, "before [[RA after", "before [[RA".length);
  await waitForOptions();
  const enterPrevented = dispatchKey(composer, "Enter");
  await sleep(250);
  const middleInsertOk =
    composer.value === "before [[RAG]] after" &&
    composer.selectionStart === "before [[RAG]]".length;

  setInputValue(composer, "[[not-a-real-target");
  await sleep(250);
  const noMatchOk = document.querySelectorAll(".x-wikilink-option").length === 0;

  setInputValue(composer, "[[RAG]]");
  await sleep(250);
  const closedOk = document.querySelectorAll(".x-wikilink-option").length === 0;

  const replyToggle = document.querySelector(".x-act[aria-expanded]");
  if (replyToggle) {
    replyToggle.click();
    await sleep(250);
  }

  const replyInput = document.querySelector('input[aria-label="回复"]');
  let replyClickOk = false;

  if (replyInput) {
    setInputValue(replyInput, "[[");
    const replyOptions = await waitForOptions();
    replyOptions[0]?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    await sleep(250);
    replyClickOk = replyInput.value.startsWith("[[") && replyInput.value.endsWith("]]");
  }

  setInputValue(composer, "[[");
  const finalOptions = await waitForOptions();
  dispatchKey(composer, "ArrowDown");
  await sleep(250);

  const optionKinds = Array.from(document.querySelectorAll(".x-wikilink-option-kind")).map((node) =>
    node.textContent.trim()
  );
  const firstLabels = Array.from(document.querySelectorAll(".x-wikilink-option-main"))
    .slice(0, 4)
    .map((node) => node.textContent.trim())
    .join("/");

  return [
    `options=${finalOptions.length}`,
    `kinds=${optionKinds.slice(0, 4).join("/")}`,
    `first=${firstLabels}`,
    `enterPrevented=${enterPrevented}`,
    `middleInsert=${middleInsertOk}`,
    `noMatch=${noMatchOk}`,
    `closed=${closedOk}`,
    `replyClick=${replyClickOk}`
  ].join(";");
})();
