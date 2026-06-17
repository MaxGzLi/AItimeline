// Opens the first card's detail drawer and submits two Ask-AI questions so the
// .chat-list renders a real user/assistant thread (offline via buildGroundedAnswer).
// Used with docs/e2e/cdp-shot.mjs to verify the SourceDetailDrawer.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const setValue = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    ).set;
    setter.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const open = document.querySelector(".post-open-button");
  if (!open) return "no-open-button";
  open.click();
  await sleep(600);
  const input = document.querySelector(".detail-drawer .ask-form input");
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

  const drawer = document.querySelector(".detail-drawer");
  if (drawer) drawer.scrollTop = drawer.scrollHeight;
  await sleep(300);
  return "chat-messages=" + document.querySelectorAll(".chat-message").length;
})();
