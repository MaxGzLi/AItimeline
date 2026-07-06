// Navigates to the "图谱" (graph) nav tab and waits for the force-directed
// layout to settle before the screenshot is taken.
// Used with docs/e2e/cdp-shot.mjs to verify the graph fit-to-view behavior.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(400);
  const buttons = Array.from(document.querySelectorAll(".x-navbtn"));
  const graphBtn = buttons.find((btn) => btn.textContent?.includes("图谱"));
  if (!graphBtn) return "no-graph-nav";
  graphBtn.click();
  await sleep(900);
  const canvas = document.querySelector(".x-graphcanvas canvas");
  return "canvas=" + !!canvas;
})();
