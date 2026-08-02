// Scrolls the timeline to a chosen card so a screenshot can frame one state.
// Target comes from the URL: ?e2eScroll=media[:n] or ?e2eScroll=text[:n].
//   node docs/e2e/cdp-shot.mjs out.png 'http://127.0.0.1:5174/?e2eScroll=media:2' 1440 1200 docs/e2e/interactions/feed-scroll.js
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, timeoutMs = 10000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const value = predicate();
      if (value) return value;
      await sleep(100);
    }
    return null;
  };

  const [kind = "media", indexText = "1"] = (new URLSearchParams(location.search).get("e2eScroll") ?? "media").split(":");
  const index = Math.max(1, Number(indexText) || 1);

  const posts = await waitFor(() => {
    const all = Array.from(document.querySelectorAll(".x-post"));
    return all.length > 3 ? all : null;
  });
  if (!posts) return "error=no-posts";

  const matches = posts.filter((post) => Boolean(post.querySelector(".x-media img")) === (kind === "media"));
  const target = matches[index - 1];
  if (!target) return `error=no-${kind}-card-${index}`;

  target.scrollIntoView({ block: "start" });
  window.scrollBy(0, -80);
  await sleep(900);

  return `scrolled=${kind}:${index} of ${matches.length}`;
})();
