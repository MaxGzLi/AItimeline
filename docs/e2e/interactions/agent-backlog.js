// Navigates to the "智能体" (agent) nav tab, scrolls to the subscriptions
// panel, and expands the channel backlog catalog (目录) so the entry list
// with per-video statuses is visible before the screenshot is taken.
// Used with docs/e2e/cdp-shot.mjs to verify the channel-backlog UI.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(600);
  const buttons = Array.from(document.querySelectorAll(".x-navbtn"));
  const agentBtn = buttons.find((btn) => btn.textContent?.includes("智能体"));
  if (!agentBtn) return "no-agent-nav";
  agentBtn.click();
  await sleep(800);
  const catalogBtn = Array.from(document.querySelectorAll(".x-sub-backlog-head button")).find((btn) =>
    btn.textContent?.includes("目录")
  );
  if (!catalogBtn) return "no-catalog-btn";
  catalogBtn.click();
  await sleep(1200);
  // Full-page capture already includes everything; scroll back to top so the
  // sticky nav rail paints at its real position instead of mid-page.
  window.scrollTo(0, 0);
  await sleep(400);
  const items = document.querySelectorAll(".x-sub-backlog-item").length;
  return "backlog-items=" + items;
})();
