type StoredProfile = {
  id: string;
  name: string;
  vlessUrl: string;
  createdAt: number;
};

type ResponsePayload = {
  ok: boolean;
  message?: string;
  connected?: boolean;
  profiles?: StoredProfile[];
  activeProfileId?: string | null;
};

const vlessInput = document.querySelector<HTMLTextAreaElement>("#vlessInput");
const profileSelect = document.querySelector<HTMLSelectElement>("#profileSelect");
const saveButton = document.querySelector<HTMLButtonElement>("#saveButton");
const connectButton = document.querySelector<HTMLButtonElement>("#connectButton");
const disconnectButton = document.querySelector<HTMLButtonElement>("#disconnectButton");
const useProfileButton = document.querySelector<HTMLButtonElement>("#useProfileButton");
const deleteProfileButton = document.querySelector<HTMLButtonElement>("#deleteProfileButton");
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
  if (useProfileButton) useProfileButton.disabled = busy;
  if (deleteProfileButton) deleteProfileButton.disabled = busy;
}

async function sendMessage(message: object): Promise<ResponsePayload> {
  return chrome.runtime.sendMessage(message);
}

function getSelectedProfileId(): string | null {
  return profileSelect?.value || null;
}

function renderProfiles(profiles: StoredProfile[], activeProfileId: string | null | undefined): void {
  if (!profileSelect) return;
  profileSelect.textContent = "";
  if (profiles.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No profiles yet";
    option.disabled = true;
    option.selected = true;
    profileSelect.append(option);
    if (useProfileButton) useProfileButton.disabled = true;
    if (deleteProfileButton) deleteProfileButton.disabled = true;
    return;
  }

  for (const profile of profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name;
    option.selected = profile.id === activeProfileId;
    profileSelect.append(option);
  }
  if (useProfileButton) useProfileButton.disabled = false;
  if (deleteProfileButton) deleteProfileButton.disabled = false;
}

async function refreshProfiles(): Promise<void> {
  const result = await sendMessage({ type: "profile/list" });
  if (!result.ok) {
    setStatus(result.message ?? "Unable to load profiles", "error");
    return;
  }
  renderProfiles(result.profiles ?? [], result.activeProfileId ?? null);
}

async function bootstrap(): Promise<void> {
  await refreshProfiles();

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
  if (!result.ok) {
    setStatus(`Error: ${result.message}`, "error");
    return;
  }
  renderProfiles(result.profiles ?? [], result.activeProfileId ?? null);
  setStatus("Profile saved and selected", "idle");
});

useProfileButton?.addEventListener("click", async () => {
  const profileId = getSelectedProfileId();
  if (!profileId) return;
  setBusy(true);
  setStatus("Selecting profile...", "working");
  const result = await sendMessage({ type: "profile/select", profileId });
  setBusy(false);
  if (!result.ok) {
    setStatus(`Error: ${result.message}`, "error");
    return;
  }
  renderProfiles(result.profiles ?? [], result.activeProfileId ?? null);
  setStatus("Active profile updated", "idle");
});

deleteProfileButton?.addEventListener("click", async () => {
  const profileId = getSelectedProfileId();
  if (!profileId) return;
  setBusy(true);
  setStatus("Removing profile...", "working");
  const result = await sendMessage({ type: "profile/delete", profileId });
  setBusy(false);
  if (!result.ok) {
    setStatus(`Error: ${result.message}`, "error");
    return;
  }
  renderProfiles(result.profiles ?? [], result.activeProfileId ?? null);
  setStatus("Profile removed", "disconnected");
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
