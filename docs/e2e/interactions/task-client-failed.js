// Forces light mode and opens a failed task, so the capture proves the failure
// reason and the retry button are both visible — the point of the clip-reliability fix.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  for (let i = 0; i < 40; i += 1) {
    if (document.querySelectorAll(".x-task-row").length > 0) break;
    await sleep(500);
  }

  const failed = Array.from(document.querySelectorAll(".x-task-row")).find((row) =>
    row.querySelector(".x-task-dot.failed")
  );

  if (!failed) return "no-failed-row";

  failed.scrollIntoView({ block: "center" });
  failed.click();

  for (let i = 0; i < 40; i += 1) {
    if (document.querySelector(".x-task-retry")) {
      // 主题在 React 挂载后才落到 documentElement 上,所以放到最后再切,
      // 否则会拍到一半深色一半浅色的画面。
      document.documentElement.setAttribute("data-theme", "light");
      await sleep(1200);
      return "retry-button-visible theme=" + document.documentElement.getAttribute("data-theme");
    }
    await sleep(500);
  }

  return "timeout-no-retry-button";
})();
