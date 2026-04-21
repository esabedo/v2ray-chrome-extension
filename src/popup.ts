const pingButton = document.querySelector<HTMLButtonElement>("#pingButton");
const statusNode = document.querySelector<HTMLElement>("#status");

function setStatus(text: string): void {
  if (statusNode) statusNode.textContent = text;
}

pingButton?.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "ping" });
  setStatus(JSON.stringify(response, null, 2));
});
