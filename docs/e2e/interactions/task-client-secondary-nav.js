// Leaves the task client through the demoted 时间线 entry and waits for feed
// cards, proving the eight older views still work from their secondary entries.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  for (let i = 0; i < 40; i += 1) {
    if (document.querySelector(".x-task-secondary")) break;
    await sleep(500);
  }

  const entry = Array.from(document.querySelectorAll(".x-task-secondary button")).find((button) =>
    /时间线|Feed|Timeline/.test(button.textContent ?? "")
  );

  if (!entry) return "no-timeline-entry";

  entry.click();

  for (let i = 0; i < 200; i += 1) {
    const posts = document.querySelectorAll(".x-post").length;
    if (posts > 0) {
      await sleep(1200);
      return "posts=" + posts;
    }
    await sleep(500);
  }

  return "timeout-no-posts";
})();
