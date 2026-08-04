// On the 基地 first screen: waits for data, types into the 对话入口 and submits,
// then waits for the observer's real confirmation reply from /api/agent/preferences.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 60; i += 1) {
    if (document.querySelectorAll(".x-mr .x-import-row").length > 0) break;
    await sleep(500);
  }
  const input = document.querySelector(".x-base-chat input");
  if (!input) return "no-chat-input";
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, "我最近想搞懂具身智能");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(300);
  document.querySelector(".x-base-chat button[type=submit]")?.click();
  let notice = null;
  // 大快照下服务端要写多次全量文件,真实回复可能要 ~20s。
  for (let i = 0; i < 100; i += 1) {
    await sleep(500);
    notice = Array.from(document.querySelectorAll(".x-mrnote")).find((p) => p.getAttribute("role") === "status");
    if (notice) break;
  }
  return "notice=" + (notice?.textContent ?? "none");
})();
