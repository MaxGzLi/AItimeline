(async () => {
  const input = document.querySelector('input[aria-label="Ask the agent a question"]');

  if (!input) {
    return "agent-input-missing";
  }

  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, "Tell me more about AI Agent");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 300));
  input.closest("form").requestSubmit();
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const answer = document.querySelector(".agent-answer");

  return answer ? `agent-answered:${answer.textContent.slice(0, 60)}` : "agent-no-answer";
})()
