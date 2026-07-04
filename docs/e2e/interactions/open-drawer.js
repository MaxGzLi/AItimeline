// Opens the first card's main-column detail page with no Ask-AI interaction.
// Used with docs/e2e/cdp-shot.mjs when a tall viewport should show the stacked
// source, graph, thread, and review sections in one capture.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(500);
  const open = document.querySelector(".x-post .x-open");
  if (!open) return "no-open-button";
  open.click();
  await sleep(600);
  return "detail-open=" + !!document.querySelector(".x-detail");
})();
