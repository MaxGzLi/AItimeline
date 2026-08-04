// Waits until the timeline feed has rendered cards from the API before
// capturing. The local snapshot payload is large and the first request batch
// can time out, so wait long enough (~100s) to catch the 60s re-poll.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
