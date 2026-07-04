// Opens the first card's main-column detail page and submits two Ask-AI questions
// so the grounded user/assistant thread renders before capture.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const setValue = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    ).set;
    setter.call(el, v);
    el.focus();
    el.dispatchEvent(new FocusEvent("focus", { bubbles: false }));
    el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const open = document.querySelector(".x-post .x-open");
  if (!open) return "no-open-button";
  open.click();
  await sleep(600);
  const input = document.querySelector(".x-detail-ask input");
  if (!input) return "no-ask-input";
  const form = input.closest("form");
  const submit = () =>
    form.requestSubmit
      ? form.requestSubmit()
      : form.querySelector('button[type="submit"]').click();

  setValue(input, "How does this connect to my memory and review queue?");
  await sleep(180);
  submit();
  await sleep(600);

  setValue(input, "What failure modes should I watch for here?");
  await sleep(180);
  submit();
  await sleep(700);

  window.scrollTo(0, document.documentElement.scrollHeight);
  await sleep(300);
  return "detail-ai-messages=" + document.querySelectorAll(".x-detail-msg").length;
})();
