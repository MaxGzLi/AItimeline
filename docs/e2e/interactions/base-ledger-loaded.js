// Waits on the 基地 first screen until the API data has hydrated the ledger
// (the import list shows rows), so the capture shows real numbers instead of
// the pre-fetch zeros. The snapshot payload is large locally and the first
// request batch can time out, so wait ~100s to catch the 60s re-poll.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 200; i += 1) {
    const rows = document.querySelectorAll(".x-mr .x-import-row").length;
    if (rows > 0) {
      await sleep(1500); // let the graph canvas settle too
      return "rows=" + rows;
    }
    await sleep(500);
  }
  return "timeout-no-rows";
})();
