// Asks a frontier question and stops at the consent prompt, proving the observer
// answers from the library first and asks before spending a web search.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  for (let i = 0; i < 40; i += 1) {
    if (document.querySelector(".x-task-dispatch-input")) break;
    await sleep(500);
  }

  const input = document.querySelector(".x-task-dispatch-input");
  if (!input) return "no-dispatch-input";

  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(input, "混合专家是什么");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(300);
  input.closest("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

  for (let i = 0; i < 120; i += 1) {
    if (document.querySelector(".x-task-confirm")) break;
    await sleep(500);
  }

  const choices = document.querySelectorAll(".x-task-choice");
  if (!choices.length) return "timeout-no-confirm-prompt";

  const go = document.querySelector(".x-task-confirmgo");
  const disabledBefore = go.disabled;

  // 每组选第一个,证明选满之后按钮才能点。
  const groups = document.querySelectorAll(".x-task-confirmrow");
  for (const group of groups) group.querySelector(".x-task-choice").click();
  await sleep(600);

  return "prompt-shown disabledBeforePicking=" + disabledBefore + " enabledAfter=" + !go.disabled;
})();
