// Navigates to the "智能体" (agent) nav tab, pastes a YouTube *channel* URL
// into the single-source import box and submits, so the screenshot captures
// the channel-URL guidance (error hint + URL handed off to the subscription
// form). Used with docs/e2e/cdp-shot.mjs.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(600);
  const buttons = Array.from(document.querySelectorAll(".x-navbtn"));
  const agentBtn = buttons.find((btn) => btn.textContent?.includes("智能体"));
  if (!agentBtn) return "no-agent-nav";
  agentBtn.click();
  await sleep(800);
  const input = document.querySelector("#agent-source-import .x-import-field input");
  if (!input) return "no-import-input";
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, "https://www.youtube.com/@QuantPy");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(200);
  const form = input.closest("form");
  if (!form) return "no-import-form";
  form.requestSubmit();
  await sleep(900);
  document.querySelector("#agent-source-import")?.scrollIntoView();
  await sleep(300);
  const error = document.querySelector("#agent-source-import .x-import-err")?.textContent ?? "";
  return "guide=" + error.slice(0, 40);
})();
