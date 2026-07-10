(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const findNav = () =>
    Array.from(document.querySelectorAll("button, a")).find((el) => el.textContent?.trim() === "复习");

  for (let i = 0; i < 20 && !findNav(); i += 1) {
    await wait(500);
  }

  findNav()?.click();
  await wait(800);

  const reveal = Array.from(document.querySelectorAll(".x-grade")).find(
    (el) => el.textContent?.trim() === "显示答案"
  );

  if (!reveal) {
    return "no-reveal-btn";
  }

  reveal.click();
  await wait(400);

  // 模拟网络故障:评分请求必然失败。
  window.fetch = () => Promise.reject(new Error("simulated network failure"));

  const btn = Array.from(document.querySelectorAll(".x-grade")).find(
    (el) => el.textContent?.trim() === "模糊"
  );

  btn?.click();
  await wait(1200);

  const error = document.querySelector(".x-reviewfeedback.error")?.textContent ?? "no-error-shown";
  const stillHasQuestion = Boolean(document.querySelector(".x-reviewq"));

  return `error:${error}|questionStays:${stillHasQuestion}`;
})()
