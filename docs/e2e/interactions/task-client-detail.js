// Opens the first finished task that produced cards, so the capture shows a
// full step stream plus the produced-card blocks rather than a queued stub.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  for (let i = 0; i < 40; i += 1) {
    if (document.querySelectorAll(".x-task-row").length > 0) break;
    await sleep(500);
  }

  const rows = Array.from(document.querySelectorAll(".x-task-row"));
  const withCards = rows.find((row) => /张卡|card/.test(row.textContent ?? ""));

  if (!withCards) return "no-row-with-cards";

  withCards.click();

  for (let i = 0; i < 40; i += 1) {
    if (document.querySelector(".x-task-card")) {
      await sleep(600);
      return "steps=" + document.querySelectorAll(".x-task-step,.x-task-rule").length +
        " cards=" + document.querySelectorAll(".x-task-card").length;
    }
    await sleep(500);
  }

  return "timeout-no-cards";
})();
