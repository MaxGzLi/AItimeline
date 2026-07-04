// Returns the computed letter-spacing of the main display headings. Opens the
// first post's detail page so the detail title exists.
// Used with docs/e2e/cdp-shot.mjs to prove the tracking rules actually apply.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(400);
  const ls = (sel) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el).letterSpacing : "MISSING";
  };
  const h1 = ls(".x-coltitle h1");
  const cardTitle = ls(".x-title");
  document.querySelector(".x-post .x-open")?.click();
  await sleep(500);
  const detailTitle = ls(".x-detail-title");
  return JSON.stringify({ h1, cardTitle, detailTitle });
})();
