// Focuses the URL-import input so :focus-within affordances (the X-style blue
// compose ring) render for a screenshot. Used with docs/e2e/cdp-shot.mjs.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(400);
  const input = document.querySelector(".source-input-shell input");
  if (!input) return "no-import-input";
  input.focus();
  await sleep(350);
  return "focused=" + (document.activeElement === input);
})();
