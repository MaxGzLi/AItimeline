// Opens the first card's detail page (main-column) and scrolls the local
// knowledge-graph panel in the right rail into view.
// Used with docs/e2e/cdp-shot.mjs to verify fit-to-view on the small local graph.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(500);
  const open = document.querySelector(".x-post .x-open");
  if (!open) return "no-open-button";
  open.click();
  await sleep(700);
  const localGraph = document.querySelector(".x-localgraph");
  if (!localGraph) return "no-localgraph";
  localGraph.scrollIntoView({ block: "center" });
  await sleep(900);
  const canvas = localGraph.querySelector(".x-graphcanvas canvas");
  return "canvas=" + !!canvas;
})();
