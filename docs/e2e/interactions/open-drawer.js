// Opens the first card's detail drawer (no Ask-AI, no scroll) so the drawer's
// detail sections (Source Chunks, Graph Edges, Thread, Review) are visible for
// a screenshot. Used with docs/e2e/cdp-shot.mjs at a tall viewport (the drawer
// is height:100vh, so a tall window shows all stacked sections without scroll).
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(500);
  const open = document.querySelector(".post-open-button");
  if (!open) return "no-open-button";
  open.click();
  await sleep(600);
  return "drawer-open=" + !!document.querySelector(".detail-drawer");
})();
