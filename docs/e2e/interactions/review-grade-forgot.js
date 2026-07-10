(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const findNav = () =>
    Array.from(document.querySelectorAll("button, a")).find((el) => el.textContent?.trim() === "复习");

  for (let i = 0; i < 20 && !findNav(); i += 1) {
    await wait(500);
  }

  findNav()?.click();
  await wait(800);

  const clickGrade = async (label) => {
    const reveal = Array.from(document.querySelectorAll(".x-grade")).find(
      (el) => el.textContent?.trim() === "显示答案"
    );

    if (!reveal) {
      return false;
    }

    reveal.click();
    await wait(400);

    const btn = Array.from(document.querySelectorAll(".x-grade")).find(
      (el) => el.textContent?.trim() === label
    );

    if (!btn) {
      return false;
    }

    btn.click();
    await wait(1500);
    return true;
  };

  const first = await clickGrade("忘了");
  const feedback = document.querySelector(".x-reviewfeedback")?.textContent ?? "no-feedback";

  return `graded:${first}|feedback:${feedback}`;
})()
