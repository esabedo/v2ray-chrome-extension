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
const statusPill = document.querySelector<HTMLElement>("#statusPill");

type StatusKind = "idle" | "connected" | "disconnected" | "error" | "working";

function setPill(kind: StatusKind, label: string): void {
  if (!statusPill) return;
  statusPill.textContent = label;
  statusPill.className = `status-pill status-${kind}`;
}

function setStatus(text: string, kind: StatusKind = "idle"): void {
  if (statusNode) statusNode.textContent = text;
  const labelByKind: Record<StatusKind, string> = {
    idle: "Idle",
    connected: "Connected",
    disconnected: "Disconnected",
    error: "Error",
    working: "Working"
  };
  setPill(kind, labelByKind[kind]);
}

function setBusy(busy: boolean): void {
  if (saveButton) saveButton.disabled = busy;
  if (connectButton) connectButton.disabled = busy;
  if (disconnectButton) disconnectButton.disabled = busy;
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
    if (state.connected) {
      setStatus("Connection active", "connected");
      return;
    }
    setStatus(state.message ? `Disconnected: ${state.message}` : "Disconnected", "disconnected");
    return;
  }
  setStatus(state.message ?? "Unable to fetch status", "error");
}

saveButton?.addEventListener("click", async () => {
  const vlessUrl = vlessInput?.value.trim() ?? "";
  if (!vlessUrl) {
    setStatus("Paste VLESS URL first", "error");
    return;
  }
  setBusy(true);
  setStatus("Saving profile...", "working");
  const result = await sendMessage({ type: "profile/save", vlessUrl });
  setBusy(false);
  setStatus(result.ok ? "Profile saved successfully" : `Error: ${result.message}`, result.ok ? "idle" : "error");
});

connectButton?.addEventListener("click", async () => {
  setBusy(true);
  setStatus("Connecting...", "working");
  const result = await sendMessage({ type: "connection/connect" });
  setBusy(false);
  setStatus(result.ok ? "Connected via local agent" : `Error: ${result.message}`, result.ok ? "connected" : "error");
});

disconnectButton?.addEventListener("click", async () => {
  setBusy(true);
  setStatus("Disconnecting...", "working");
  const result = await sendMessage({ type: "connection/disconnect" });
  setBusy(false);
  setStatus(result.ok ? "Disconnected and proxy reset" : `Error: ${result.message}`, result.ok ? "disconnected" : "error");
});

void bootstrap();
