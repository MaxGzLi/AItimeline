// Expands the "自动生产" budget-ledger row in the column header so the
// one-line today's-budget account is visible before the screenshot is taken.
// Used with docs/e2e/cdp-shot.mjs to verify the supply ledger UI.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(1200);
  const toggle = document.querySelector(".x-scout-ledger-toggle");
  if (!toggle) return "no-ledger-toggle";
  toggle.click();
  await sleep(500);
  const ledger = document.querySelector(".x-scout-ledger");
  return "ledger=" + (ledger?.textContent ?? "missing");
})();
