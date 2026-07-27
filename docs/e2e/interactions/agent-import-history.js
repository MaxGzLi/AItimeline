// Navigates to the "智能体" (agent) nav tab and scrolls the 导入记录 section to
// the top of the viewport so the import-history list is fully captured.
// Used with docs/e2e/cdp-shot.mjs to verify the grouped import history.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(1500);
  const agentBtn = Array.from(document.querySelectorAll(".x-navbtn")).find((btn) =>
    btn.textContent?.includes("智能体")
  );
  if (!agentBtn) return "no-agent-nav";
  agentBtn.click();
  await sleep(1200);
  const imports = Array.from(document.querySelectorAll(".x-mr")).find(
    (section) => section.getAttribute("aria-label") === "导入记录"
  );
  if (!imports) return "no-imports-section";
  imports.scrollIntoView({ block: "start" });
  await sleep(600);
  return "rows=" + imports.querySelectorAll(".x-import-row").length;
})();
