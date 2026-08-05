// Opens the first finished task that produced cards, so the capture shows a
// full step stream plus the produced-card blocks rather than a queued stub.
// 侧栏一行只剩标题和时间了,行文字里看不出这条出没出卡,所以只能挨个点开看。
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  for (let i = 0; i < 40; i += 1) {
    if (document.querySelectorAll(".x-task-row").length > 0) break;
    await sleep(500);
  }

  const rows = Array.from(document.querySelectorAll(".x-task-row")).slice(0, 12);

  if (!rows.length) return "no-rows";

  for (const row of rows) {
    row.click();

    for (let i = 0; i < 16; i += 1) {
      if (document.querySelector(".x-task-card")) {
        await sleep(600);
        return "steps=" + document.querySelectorAll(".x-task-step,.x-task-runline").length +
          " cards=" + document.querySelectorAll(".x-task-card").length;
      }
      await sleep(250);
    }
  }

  return "timeout-no-cards";
})();
