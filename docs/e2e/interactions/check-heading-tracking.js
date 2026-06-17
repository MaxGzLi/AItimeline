// Returns the computed letter-spacing of the three display headings (page title,
// post title, drawer title). Opens the drawer so .drawer-header h2 exists.
// Used with docs/e2e/cdp-shot.mjs to prove the tracking rules actually apply.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(400);
  const ls = (sel) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el).letterSpacing : "MISSING";
  };
  const h1 = ls(".timeline-header h1");
  const cardH2 = ls(".knowledge-card h2");
  document.querySelector(".post-open-button")?.click();
  await sleep(500);
  const drawerH2 = ls(".drawer-header h2");
  return JSON.stringify({ h1, cardH2, drawerH2 });
})();
