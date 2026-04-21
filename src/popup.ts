type ResponsePayload = {
  ok: boolean;
  message?: string;
  connected?: boolean;
};

const vlessInput = document.querySelector<HTMLTextAreaElement>("#vlessInput");
const saveButton = document.querySelector<HTMLButtonElement>("#saveButton");
const connectButton = document.querySelector<HTMLButtonElement>("#connectButton");
const disconnectButton = document.querySelector<HTMLButtonElement>("#disconnectButton");
const statusNode = document.querySelector<HTMLElement>("#status");

function setStatus(text: string): void {
  if (statusNode) statusNode.textContent = text;
}

async function sendMessage(message: object): Promise<ResponsePayload> {
  return chrome.runtime.sendMessage(message);
}

async function bootstrap(): Promise<void> {
  const stored = await chrome.storage.local.get(["vlessUrl"]);
  if (vlessInput && typeof stored.vlessUrl === "string") {
    vlessInput.value = stored.vlessUrl;
  }

  const state = await sendMessage({ type: "connection/status" });
  if (state.ok) {
    setStatus(state.connected ? "Connected" : "Disconnected");
    return;
  }
  setStatus(state.message ?? "Unable to fetch status");
}

saveButton?.addEventListener("click", async () => {
  const vlessUrl = vlessInput?.value.trim() ?? "";
  if (!vlessUrl) {
    setStatus("Paste VLESS URL first");
    return;
  }

  const result = await sendMessage({ type: "profile/save", vlessUrl });
  setStatus(result.ok ? "Profile saved" : `Error: ${result.message}`);
});

connectButton?.addEventListener("click", async () => {
  const result = await sendMessage({ type: "connection/connect" });
  setStatus(result.ok ? "Connected" : `Error: ${result.message}`);
});

disconnectButton?.addEventListener("click", async () => {
  const result = await sendMessage({ type: "connection/disconnect" });
  setStatus(result.ok ? "Disconnected" : `Error: ${result.message}`);
});

void bootstrap();
