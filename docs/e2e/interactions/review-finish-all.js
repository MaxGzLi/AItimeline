(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const findNav = () =>
    Array.from(document.querySelectorAll("button, a")).find((el) => el.textContent?.trim() === "复习");

  for (let i = 0; i < 20 && !findNav(); i += 1) {
    await wait(500);
  }

  findNav()?.click();
  await wait(800);

  const grades = ["忘了", "记得", "记得", "模糊", "记得"];

  for (const label of grades) {
    const reveal = Array.from(document.querySelectorAll(".x-grade")).find(
      (el) => el.textContent?.trim() === "显示答案"
    );

    if (!reveal) {
      break;
    }

    reveal.click();
    await wait(400);

    const btn = Array.from(document.querySelectorAll(".x-grade")).find(
      (el) => el.textContent?.trim() === label
    );

    if (!btn) {
      break;
    }

    btn.click();
    await wait(1500);
  }

  const done = document.querySelector(".x-reviewdone")?.textContent ?? "not-done";
  const summary = Array.from(document.querySelectorAll(".x-reviewsummary"))
    .map((el) => el.textContent)
    .join(" / ");

  return `done:${done}|summary:${summary}`;
})()
