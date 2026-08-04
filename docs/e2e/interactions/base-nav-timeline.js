// From the 基地 first screen, clicks the 时间线 nav tab and waits for feed
// cards, proving the demoted feed still works unchanged.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(1500);
  const btn = Array.from(document.querySelectorAll(".x-navbtn")).find((b) => b.textContent?.includes("时间线"));
  if (!btn) return "no-timeline-nav";
  btn.click();
  for (let i = 0; i < 200; i += 1) {
    const posts = document.querySelectorAll(".x-post").length;
    if (posts > 0) {
      await sleep(1000);
      return "posts=" + posts;
    }
    await sleep(500);
  }
  return "timeout-no-posts";
})();
