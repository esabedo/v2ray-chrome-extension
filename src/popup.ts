import { parseVlessUrl } from "./vless.js";

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

const onboardingCard = document.querySelector<HTMLElement>("#onboardingCard");
const onboardingText = document.querySelector<HTMLElement>("#onboardingText");
const checkAgentButton = document.querySelector<HTMLButtonElement>("#checkAgentButton");
const copyAgentCommandButton = document.querySelector<HTMLButtonElement>("#copyAgentCommandButton");
const toastHost = document.querySelector<HTMLElement>("#toastHost");
const profileNameInput = document.querySelector<HTMLInputElement>("#profileNameInput");
const vlessInput = document.querySelector<HTMLTextAreaElement>("#vlessInput");
const validationHint = document.querySelector<HTMLElement>("#validationHint");
const profileSelect = document.querySelector<HTMLSelectElement>("#profileSelect");
const saveButton = document.querySelector<HTMLButtonElement>("#saveButton");
const connectButton = document.querySelector<HTMLButtonElement>("#connectButton");
const disconnectButton = document.querySelector<HTMLButtonElement>("#disconnectButton");
const useProfileButton = document.querySelector<HTMLButtonElement>("#useProfileButton");
const deleteProfileButton = document.querySelector<HTMLButtonElement>("#deleteProfileButton");
const statusNode = document.querySelector<HTMLElement>("#status");
const statusPill = document.querySelector<HTMLElement>("#statusPill");

type StatusKind = "idle" | "connected" | "disconnected" | "error" | "working";
let profilesCache: StoredProfile[] = [];

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
  if (useProfileButton) useProfileButton.disabled = busy || profilesCache.length === 0;
  if (deleteProfileButton) deleteProfileButton.disabled = busy || profilesCache.length === 0;
  if (checkAgentButton) checkAgentButton.disabled = busy;
  if (copyAgentCommandButton) copyAgentCommandButton.disabled = busy;
}

function setValidationHint(text: string, kind: "ok" | "error" | "neutral"): void {
  if (!validationHint) return;
  validationHint.textContent = text;
  validationHint.className = kind === "neutral" ? "validation-hint" : `validation-hint ${kind}`;
}

function showOnboarding(text: string): void {
  if (onboardingText) onboardingText.textContent = text;
  onboardingCard?.classList.remove("hidden");
}

function hideOnboarding(): void {
  onboardingCard?.classList.add("hidden");
}

function showToast(message: string, kind: "ok" | "error" = "ok", ttlMs = 2800): void {
  if (!toastHost) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${kind}`;
  toast.textContent = message;
  toastHost.append(toast);
  requestAnimationFrame(() => {
    toast.classList.add("visible");
  });
  window.setTimeout(() => {
    toast.classList.remove("visible");
    window.setTimeout(() => toast.remove(), 180);
  }, ttlMs);
}

function getAgentSetupCommand(): string {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("windows")) {
    return "npm run singbox:install:windows && npm run agent:run";
  }
  if (ua.includes("mac")) {
    return "npm run singbox:install:macos && npm run agent:run";
  }
  return "npm run agent:run";
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const node = document.createElement("textarea");
  node.value = text;
  node.style.position = "fixed";
  node.style.opacity = "0";
  document.body.append(node);
  node.focus();
  node.select();
  const ok = document.execCommand("copy");
  node.remove();
  return ok;
}

async function sendMessage(message: object): Promise<ResponsePayload> {
  return chrome.runtime.sendMessage(message);
}

function getSelectedProfileId(): string | null {
  return profileSelect?.value || null;
}

function autofillNameFromVless(): void {
  const raw = vlessInput?.value.trim() ?? "";
  if (!raw) return;
  if (profileNameInput?.value.trim()) return;
  try {
    const parsed = parseVlessUrl(raw);
    profileNameInput!.value = parsed.remark || `${parsed.host}:${parsed.port}`;
  } catch {
    // ignore
  }
}

function validateVlessInput(): boolean {
  const raw = vlessInput?.value.trim() ?? "";
  if (!raw) {
    vlessInput?.classList.remove("valid", "invalid");
    setValidationHint("Paste a valid VLESS URL to save profile.", "neutral");
    return false;
  }
  try {
    const parsed = parseVlessUrl(raw);
    vlessInput?.classList.remove("invalid");
    vlessInput?.classList.add("valid");
    setValidationHint(`Valid profile: ${parsed.host}:${parsed.port}`, "ok");
    return true;
  } catch (error: unknown) {
    vlessInput?.classList.remove("valid");
    vlessInput?.classList.add("invalid");
    const text = error instanceof Error ? error.message : "Invalid VLESS URL";
    setValidationHint(text, "error");
    return false;
  }
}

function fillInputsFromProfile(profileId: string | null | undefined): void {
  if (!profileId) return;
  const profile = profilesCache.find((p) => p.id === profileId);
  if (!profile) return;
  if (vlessInput) vlessInput.value = profile.vlessUrl;
  if (profileNameInput) profileNameInput.value = profile.name;
  validateVlessInput();
}

function renderProfiles(profiles: StoredProfile[], activeProfileId: string | null | undefined): void {
  profilesCache = profiles;
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
    if (profileNameInput) profileNameInput.value = "";
    if (vlessInput) vlessInput.value = "";
    validateVlessInput();
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
  fillInputsFromProfile(activeProfileId ?? profiles[0].id);
}

async function refreshProfiles(): Promise<void> {
  const result = await sendMessage({ type: "profile/list" });
  if (!result.ok) {
    setStatus(result.message ?? "Unable to load profiles", "error");
    showToast(result.message ?? "Unable to load profiles", "error");
    return;
  }
  renderProfiles(result.profiles ?? [], result.activeProfileId ?? null);
}

async function refreshConnectionStatus(showToastOnSuccess = false): Promise<boolean> {
  const state = await sendMessage({ type: "connection/status" });
  if (!state.ok) {
    setStatus(state.message ?? "Unable to fetch status", "error");
    showOnboarding("Agent service seems unavailable. Check installer/service status.");
    return false;
  }
  hideOnboarding();
  if (state.connected) {
    setStatus("Connection active", "connected");
    if (showToastOnSuccess) showToast("Agent is reachable", "ok");
    return true;
  }
  setStatus(state.message ? `Disconnected: ${state.message}` : "Disconnected", "disconnected");
  if (showToastOnSuccess) showToast("Agent is reachable", "ok");
  return true;
}

async function bootstrap(): Promise<void> {
  await refreshProfiles();
  await refreshConnectionStatus();
}

vlessInput?.addEventListener("input", () => {
  validateVlessInput();
  autofillNameFromVless();
});

profileSelect?.addEventListener("change", () => {
  fillInputsFromProfile(getSelectedProfileId());
});

saveButton?.addEventListener("click", async () => {
  const vlessUrl = vlessInput?.value.trim() ?? "";
  if (!validateVlessInput()) {
    setStatus("Cannot save invalid profile", "error");
    showToast("Invalid VLESS URL", "error");
    return;
  }
  setBusy(true);
  setStatus("Saving profile...", "working");
  const result = await sendMessage({
    type: "profile/save",
    vlessUrl,
    name: profileNameInput?.value.trim() || undefined
  });
  setBusy(false);
  if (!result.ok) {
    setStatus(`Error: ${result.message}`, "error");
    showToast(result.message ?? "Save failed", "error");
    return;
  }
  renderProfiles(result.profiles ?? [], result.activeProfileId ?? null);
  setStatus("Profile saved and selected", "idle");
  showToast("Profile saved", "ok");
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
    showToast(result.message ?? "Select failed", "error");
    return;
  }
  renderProfiles(result.profiles ?? [], result.activeProfileId ?? null);
  setStatus("Active profile updated", "idle");
  showToast("Profile switched", "ok");
});

deleteProfileButton?.addEventListener("click", async () => {
  const profileId = getSelectedProfileId();
  if (!profileId) return;
  const profile = profilesCache.find((p) => p.id === profileId);
  const title = profile?.name ?? "selected profile";
  const accepted = window.confirm(`Delete profile "${title}"?`);
  if (!accepted) return;

  setBusy(true);
  setStatus("Removing profile...", "working");
  const result = await sendMessage({ type: "profile/delete", profileId });
  setBusy(false);
  if (!result.ok) {
    setStatus(`Error: ${result.message}`, "error");
    showToast(result.message ?? "Delete failed", "error");
    return;
  }
  renderProfiles(result.profiles ?? [], result.activeProfileId ?? null);
  setStatus("Profile removed", "disconnected");
  showToast("Profile deleted", "ok");
});

connectButton?.addEventListener("click", async () => {
  setBusy(true);
  setStatus("Connecting...", "working");
  const result = await sendMessage({ type: "connection/connect" });
  setBusy(false);
  if (!result.ok) {
    setStatus(`Error: ${result.message}`, "error");
    showToast(result.message ?? "Connect failed", "error");
    showOnboarding("Agent service seems unavailable. Check installer/service status.");
    return;
  }
  hideOnboarding();
  setStatus("Connected via local agent", "connected");
  showToast("Connected", "ok");
});

disconnectButton?.addEventListener("click", async () => {
  setBusy(true);
  setStatus("Disconnecting...", "working");
  const result = await sendMessage({ type: "connection/disconnect" });
  setBusy(false);
  if (!result.ok) {
    setStatus(`Error: ${result.message}`, "error");
    showToast(result.message ?? "Disconnect failed", "error");
    return;
  }
  setStatus("Disconnected and proxy reset", "disconnected");
  showToast("Disconnected", "ok");
});

checkAgentButton?.addEventListener("click", async () => {
  setBusy(true);
  setStatus("Checking agent...", "working");
  const ok = await refreshConnectionStatus(true).catch(() => false);
  if (!ok) {
    showToast("Agent is still unavailable", "error");
  }
  setBusy(false);
});

copyAgentCommandButton?.addEventListener("click", async () => {
  const command = getAgentSetupCommand();
  try {
    const copied = await copyTextToClipboard(command);
    if (!copied) {
      throw new Error("Unable to access clipboard");
    }
    showToast("Setup command copied", "ok");
  } catch (error: unknown) {
    const text = error instanceof Error ? error.message : "Copy failed";
    showToast(text, "error");
  }
});

void bootstrap();
