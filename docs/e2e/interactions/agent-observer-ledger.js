// Navigates to the "智能体" (agent) nav tab and scrolls the 观察员 section into
// view so its today's-budget account line is captured.
// Used with docs/e2e/cdp-shot.mjs to verify the supply ledger UI.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(1200);
  const agentBtn = Array.from(document.querySelectorAll(".x-navbtn")).find((btn) =>
    btn.textContent?.includes("智能体")
  );
  if (!agentBtn) return "no-agent-nav";
  agentBtn.click();
  await sleep(1000);
  const observer = Array.from(document.querySelectorAll(".x-mr")).find((section) =>
    section.getAttribute("aria-label") === "观察员"
  );
  if (!observer) return "no-observer-section";
  observer.scrollIntoView({ block: "start" });
  await sleep(500);
  return "observer=" + (observer.querySelector(".x-mrnote")?.textContent ?? "missing");
})();
