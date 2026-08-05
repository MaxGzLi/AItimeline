// Opens the first finished task that produced cards, so the capture shows a
// full step stream plus the produced-card blocks rather than a queued stub.
// 侧栏一行只剩标题和时间了,行文字里看不出这条出没出卡,所以只能挨个点开看。
//
// 判断「点开好了」不能只看页面上有没有卡:切换的一瞬间,上一条的卡还挂在
// 那儿,这么截出来的图是假的——高亮在新行、内容还是旧的。所以要等到
// 高亮那行的标题和正文里显示的标题对上,才算这一条真的打开了。
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const text = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;

  for (let i = 0; i < 40; i += 1) {
    if (document.querySelectorAll(".x-task-row").length > 0) break;
    await sleep(500);
  }

  const rows = Array.from(document.querySelectorAll(".x-task-row")).slice(0, 12);

  if (!rows.length) return "no-rows";

  for (const row of rows) {
    row.click();

    for (let i = 0; i < 24; i += 1) {
      const active = text(".x-task-row.active .x-task-rowtitle");
      const shown = text(".x-task-you") ?? text(".x-task-lead");

      if (active && shown && active === shown && document.querySelector(".x-task-card")) {
        await sleep(600);
        return "steps=" + document.querySelectorAll(".x-task-step,.x-task-runline").length +
          " cards=" + document.querySelectorAll(".x-task-card").length +
          " row=" + active;
      }

      await sleep(250);
    }
  }

  return "timeout-no-cards";
})();
