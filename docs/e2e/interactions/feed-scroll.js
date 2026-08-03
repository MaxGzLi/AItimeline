// Scrolls the timeline to a chosen card so a screenshot can frame one state.
// Target comes from the URL: ?e2eScroll=media[:n], diagram[:n], text[:n]
// (media = source image, diagram = concept map, text = neither) or
// find:<text> to land on the first card containing that text — the only stable
// target once the feed rotates cards per page load.
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

  const request = new URLSearchParams(location.search).get("e2eScroll") ?? "media";
  const [kind = "media", ...rest] = request.split(":");
  const needle = decodeURIComponent(rest.join(":"));
  const index = Math.max(1, Number(rest[0]) || 1);

  const posts = await waitFor(() => {
    const all = Array.from(document.querySelectorAll(".x-post"));
    return all.length > 3 ? all : null;
  });
  if (!posts) return "error=no-posts";

  const hasMedia = (post) => Boolean(post.querySelector(".x-media img"));
  const hasDiagram = (post) => Boolean(post.querySelector(".x-diagram svg"));
  const matchers = {
    media: hasMedia,
    diagram: hasDiagram,
    text: (post) => !hasMedia(post) && !hasDiagram(post)
  };
  const matches = kind === "find" ? posts.filter((post) => post.textContent.includes(needle)) : posts.filter(matchers[kind] ?? matchers.text);
  const target = kind === "find" ? matches[0] : matches[index - 1];
  if (!target) return `error=no-${kind}-card-${kind === "find" ? needle : index}`;

  target.scrollIntoView({ block: "start" });
  window.scrollBy(0, -80);
  await sleep(900);

  return `scrolled=${request} of ${matches.length}`;
})();
