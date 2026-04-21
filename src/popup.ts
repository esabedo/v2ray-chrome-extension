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
  diagnostics?: AgentDiagnostics;
};

type AgentDiagnostics = {
  agentCore: string;
  singboxBin: string;
  xrayVersion: string;
  httpProxyPort: number;
  socksProxyPort: number;
  profileExists: boolean;
  singboxConfigExists: boolean;
  connected: boolean;
  lastError?: string | null;
  xrayStderrTail?: string[];
};

type FixSuggestion = {
  title: string;
  detail: string;
  command?: string;
  level?: "warn" | "info";
};

const onboardingCard = document.querySelector<HTMLElement>("#onboardingCard");
const onboardingText = document.querySelector<HTMLElement>("#onboardingText");
const checkAgentButton = document.querySelector<HTMLButtonElement>("#checkAgentButton");
const copyAgentCommandButton = document.querySelector<HTMLButtonElement>("#copyAgentCommandButton");
const toggleDiagnosticsButton = document.querySelector<HTMLButtonElement>("#toggleDiagnosticsButton");
const copyDiagnosticsButton = document.querySelector<HTMLButtonElement>("#copyDiagnosticsButton");
const diagnosticsPanel = document.querySelector<HTMLElement>("#diagnosticsPanel");
const diagnosticsText = document.querySelector<HTMLElement>("#diagnosticsText");
const fixesList = document.querySelector<HTMLElement>("#fixesList");
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
const setupProgressText = document.querySelector<HTMLElement>("#setupProgressText");
const stepAgent = document.querySelector<HTMLElement>("#stepAgent");
const stepProfile = document.querySelector<HTMLElement>("#stepProfile");
const stepConnected = document.querySelector<HTMLElement>("#stepConnected");

type StatusKind = "idle" | "connected" | "disconnected" | "error" | "working";
let profilesCache: StoredProfile[] = [];
let diagnosticsCache = "Diagnostics are not loaded yet.";
let lastFixCommands: string[] = [];
const flowState = {
  agentReady: false,
  profileReady: false,
  connected: false
};

function setPill(kind: StatusKind, label: string): void {
  if (!statusPill) return;
  statusPill.textContent = label;
  statusPill.className = `status-pill status-${kind}`;
}

function paintStep(node: HTMLElement | null, state: "pending" | "active" | "done"): void {
  if (!node) return;
  node.classList.remove("pending", "active", "done");
  node.classList.add(state);
}

function refreshSetupFlow(): void {
  const doneCount = [flowState.agentReady, flowState.profileReady, flowState.connected].filter(Boolean).length;
  if (setupProgressText) setupProgressText.textContent = `${doneCount}/3 Ready`;

  paintStep(stepAgent, flowState.agentReady ? "done" : "active");
  if (!flowState.agentReady) {
    paintStep(stepProfile, "pending");
    paintStep(stepConnected, "pending");
    return;
  }

  paintStep(stepProfile, flowState.profileReady ? "done" : "active");
  if (!flowState.profileReady) {
    paintStep(stepConnected, "pending");
    return;
  }

  paintStep(stepConnected, flowState.connected ? "done" : "active");
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
  if (toggleDiagnosticsButton) toggleDiagnosticsButton.disabled = busy;
  if (copyDiagnosticsButton) copyDiagnosticsButton.disabled = busy;
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

function getPortInspectCommand(port: number): string {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("windows")) {
    return `netstat -ano | findstr :${port}`;
  }
  return `lsof -nP -iTCP:${port} -sTCP:LISTEN`;
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

function renderDiagnostics(text: string): void {
  diagnosticsCache = text;
  if (diagnosticsText) diagnosticsText.textContent = text;
}

function formatDiagnostics(data: AgentDiagnostics): string {
  const lines = [
    `Core: ${data.agentCore}`,
    `Connected: ${data.connected ? "yes" : "no"}`,
    `Last error: ${data.lastError || "-"}`,
    `Profile saved: ${data.profileExists ? "yes" : "no"}`,
    `Config generated: ${data.singboxConfigExists ? "yes" : "no"}`,
    `HTTP proxy: 127.0.0.1:${data.httpProxyPort}`,
    `SOCKS proxy: 127.0.0.1:${data.socksProxyPort}`,
    `Core version: ${data.xrayVersion}`,
    `Core binary: ${data.singboxBin}`
  ];
  const tail = data.xrayStderrTail?.filter((line) => line.trim()) ?? [];
  if (tail.length > 0) {
    lines.push("", "Last core log lines:");
    lines.push(...tail.slice(-10));
  }
  return lines.join("\n");
}

function inferFixes(data: AgentDiagnostics): FixSuggestion[] {
  const fixes: FixSuggestion[] = [];
  const lastError = (data.lastError || "").toLowerCase();

  if (!data.profileExists) {
    fixes.push({
      title: "No saved profile",
      detail: "Paste a valid VLESS URL and click Save before connecting.",
      level: "warn"
    });
  }

  if (!data.singboxConfigExists && data.profileExists) {
    fixes.push({
      title: "Core config is missing",
      detail: "Re-select or re-save the active profile to regenerate runtime config.",
      level: "warn"
    });
  }

  if (lastError.includes("binary not found") || lastError.includes("no such file")) {
    fixes.push({
      title: "Core binary is not installed",
      detail: "Install sing-box and run local agent service.",
      command: getAgentSetupCommand(),
      level: "warn"
    });
  }

  if (lastError.includes("port 127.0.0.1")) {
    fixes.push({
      title: "Local proxy port is occupied",
      detail: "Check which process is using the port and stop conflicting service.",
      command: getPortInspectCommand(data.httpProxyPort),
      level: "warn"
    });
  }

  if (!data.connected && lastError === "" && data.profileExists) {
    fixes.push({
      title: "Agent is ready but disconnected",
      detail: "Try Connect in popup. If it fails, run health check and collect diagnostics.",
      command: "curl -s http://127.0.0.1:8777/v1/health",
      level: "info"
    });
  }

  if (fixes.length === 0) {
    fixes.push({
      title: "No critical issues detected",
      detail: "If connection still fails, copy diagnostics and send it for review.",
      level: "info"
    });
  }

  return fixes;
}

function renderFixes(fixes: FixSuggestion[]): void {
  lastFixCommands = fixes.map((fix) => fix.command || "");
  if (!fixesList) return;
  fixesList.textContent = "";
  for (let i = 0; i < fixes.length; i += 1) {
    const fix = fixes[i];
    const item = document.createElement("article");
    item.className = "fix-item";

    const title = document.createElement("p");
    title.className = "fix-title";
    title.textContent = fix.title;

    const detail = document.createElement("p");
    detail.className = "fix-detail";
    detail.textContent = fix.detail;

    item.append(title, detail);

    if (fix.command) {
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "btn btn-secondary btn-small";
      copyBtn.textContent = "Copy Command";
      copyBtn.dataset.fixCommandIndex = String(i);
      item.append(copyBtn);
    }

    fixesList.append(item);
  }
}

async function loadDiagnostics(showPanelAfterLoad = false): Promise<boolean> {
  const result = await sendMessage({ type: "connection/diagnostics" });
  if (!result.ok || !result.diagnostics) {
    flowState.agentReady = false;
    flowState.connected = false;
    renderDiagnostics(`Diagnostics unavailable.\n${result.message ?? "Unknown error"}`);
    renderFixes([
      {
        title: "Diagnostics endpoint unavailable",
        detail: "Start local agent service and run Check Agent from onboarding.",
        command: getAgentSetupCommand(),
        level: "warn"
      }
    ]);
    if (showPanelAfterLoad) diagnosticsPanel?.classList.remove("hidden");
    refreshSetupFlow();
    return false;
  }
  flowState.agentReady = true;
  flowState.profileReady = result.diagnostics.profileExists;
  flowState.connected = result.diagnostics.connected;
  renderDiagnostics(formatDiagnostics(result.diagnostics));
  renderFixes(inferFixes(result.diagnostics));
  if (showPanelAfterLoad) diagnosticsPanel?.classList.remove("hidden");
  refreshSetupFlow();
  return true;
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
    flowState.profileReady = false;
    refreshSetupFlow();
    return;
  }
  renderProfiles(result.profiles ?? [], result.activeProfileId ?? null);
  flowState.profileReady = (result.profiles?.length ?? 0) > 0;
  refreshSetupFlow();
}

async function refreshConnectionStatus(showToastOnSuccess = false): Promise<boolean> {
  const state = await sendMessage({ type: "connection/status" });
  if (!state.ok) {
    setStatus(state.message ?? "Unable to fetch status", "error");
    showOnboarding("Agent service seems unavailable. Check installer/service status.");
    flowState.agentReady = false;
    flowState.connected = false;
    refreshSetupFlow();
    await loadDiagnostics(true).catch(() => undefined);
    return false;
  }
  flowState.agentReady = true;
  flowState.connected = Boolean(state.connected);
  refreshSetupFlow();
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
  refreshSetupFlow();
  await refreshProfiles();
  await refreshConnectionStatus();
  renderDiagnostics(diagnosticsCache);
  renderFixes([
    {
      title: "Load diagnostics",
      detail: "Open Diagnostics to get actionable suggestions for your current environment.",
      level: "info"
    }
  ]);
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
  flowState.profileReady = (result.profiles?.length ?? 0) > 0;
  refreshSetupFlow();
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
  flowState.profileReady = (result.profiles?.length ?? 0) > 0;
  refreshSetupFlow();
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
  flowState.profileReady = (result.profiles?.length ?? 0) > 0;
  if (!flowState.profileReady) {
    flowState.connected = false;
  }
  refreshSetupFlow();
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
    await loadDiagnostics(true).catch(() => undefined);
    return;
  }
  flowState.agentReady = true;
  flowState.connected = true;
  refreshSetupFlow();
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
  flowState.connected = false;
  refreshSetupFlow();
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

toggleDiagnosticsButton?.addEventListener("click", async () => {
  const isHidden = diagnosticsPanel?.classList.contains("hidden") ?? true;
  if (!isHidden) {
    diagnosticsPanel?.classList.add("hidden");
    return;
  }
  setBusy(true);
  setStatus("Loading diagnostics...", "working");
  const ok = await loadDiagnostics(true).catch(() => false);
  if (!ok) {
    showToast("Diagnostics unavailable", "error");
    setStatus("Failed to load diagnostics", "error");
    setBusy(false);
    return;
  }
  showToast("Diagnostics loaded", "ok");
  const state = await sendMessage({ type: "connection/status" }).catch(() => ({ ok: false } as ResponsePayload));
  if (state.ok) {
    if (state.connected) {
      setStatus("Connection active", "connected");
    } else {
      setStatus(state.message ? `Disconnected: ${state.message}` : "Disconnected", "disconnected");
    }
  }
  setBusy(false);
});

copyDiagnosticsButton?.addEventListener("click", async () => {
  try {
    const copied = await copyTextToClipboard(diagnosticsCache);
    if (!copied) {
      throw new Error("Unable to copy diagnostics");
    }
    showToast("Diagnostics copied", "ok");
  } catch (error: unknown) {
    const text = error instanceof Error ? error.message : "Copy failed";
    showToast(text, "error");
  }
});

fixesList?.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const idxText = target.dataset.fixCommandIndex;
  if (!idxText) return;
  const index = Number(idxText);
  const command = Number.isFinite(index) ? lastFixCommands[index] : "";
  if (!command) return;
  try {
    const copied = await copyTextToClipboard(command);
    if (!copied) {
      throw new Error("Unable to copy command");
    }
    showToast("Fix command copied", "ok");
  } catch (error: unknown) {
    const text = error instanceof Error ? error.message : "Copy failed";
    showToast(text, "error");
  }
});

void bootstrap();
