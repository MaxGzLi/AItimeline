(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const findNav = () =>
    Array.from(document.querySelectorAll("button, a")).find((el) => el.textContent?.trim() === "复习");

  for (let i = 0; i < 20 && !findNav(); i += 1) {
    await wait(500);
  }

  const nav = findNav();

  if (!nav) {
    return "review-nav-missing";
  }

  nav.click();
  await wait(800);

  const reveal = Array.from(document.querySelectorAll(".x-grade")).find(
    (el) => el.textContent?.trim() === "显示答案"
  );

  if (!reveal) {
    return `no-reveal-btn:${document.querySelector(".x-reviewdone")?.textContent ?? "unknown"}`;
  }

  reveal.click();
  await wait(500);

  const q = document.querySelector(".x-reviewq")?.textContent ?? "";
  const a = document.querySelector(".x-reviewa")?.textContent ?? "";

  return `Q:${q.slice(0, 50)}|A:${a.slice(0, 60)}`;
})()
