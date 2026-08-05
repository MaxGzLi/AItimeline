// Types a question into the dispatch box and submits it, proving the observer's
// grounded reply (with its verbatim quote) actually reaches the screen.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  for (let i = 0; i < 40; i += 1) {
    if (document.querySelector(".x-task-dispatch-input")) break;
    await sleep(500);
  }

  const input = document.querySelector(".x-task-dispatch-input");
  if (!input) return "no-dispatch-input";

  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(input, "MoE 是什么");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(400);

  const form = input.closest("form");
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

  for (let i = 0; i < 120; i += 1) {
    const reply = document.querySelector(".x-task-replytext");
    if (reply && reply.textContent.trim()) {
      await sleep(1200);
      return "reply=" + reply.textContent.slice(0, 40) + " quote=" + Boolean(document.querySelector(".x-task-replyquote"));
    }
    await sleep(500);
  }

  return "timeout-no-reply";
})();
