// On the 基地 first screen: waits for data, types into the 对话入口 and submits,
// so the capture shows the front-end-only "coming soon" notice.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 200; i += 1) {
    if (document.querySelectorAll(".x-mr .x-import-row").length > 0) break;
    await sleep(500);
  }
  const input = document.querySelector(".x-base-chat input");
  if (!input) return "no-chat-input";
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, "我最近想搞懂 MoE 的负载均衡");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(300);
  document.querySelector(".x-base-chat button[type=submit]")?.click();
  await sleep(600);
  const notice = Array.from(document.querySelectorAll(".x-mrnote")).find((p) => p.getAttribute("role") === "status");
  return "notice=" + (notice?.textContent ?? "none");
})();
