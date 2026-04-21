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

type ConnectPolicy = {
  autoRetry: boolean;
  attempts: number;
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
const exportProfilesButton = document.querySelector<HTMLButtonElement>("#exportProfilesButton");
const importProfilesButton = document.querySelector<HTMLButtonElement>("#importProfilesButton");
const importProfilesInput = document.querySelector<HTMLInputElement>("#importProfilesInput");
const statusNode = document.querySelector<HTMLElement>("#status");
const statusPill = document.querySelector<HTMLElement>("#statusPill");
const setupProgressText = document.querySelector<HTMLElement>("#setupProgressText");
const stepAgent = document.querySelector<HTMLElement>("#stepAgent");
const stepProfile = document.querySelector<HTMLElement>("#stepProfile");
const stepConnected = document.querySelector<HTMLElement>("#stepConnected");
const quickPrimaryButton = document.querySelector<HTMLButtonElement>("#quickPrimaryButton");
const quickSecondaryButton = document.querySelector<HTMLButtonElement>("#quickSecondaryButton");
const runFullCheckButton = document.querySelector<HTMLButtonElement>("#runFullCheckButton");
const assistantNextStep = document.querySelector<HTMLElement>("#assistantNextStep");
const assistantAgent = document.querySelector<HTMLElement>("#assistantAgent");
const assistantProfile = document.querySelector<HTMLElement>("#assistantProfile");
const assistantConnection = document.querySelector<HTMLElement>("#assistantConnection");
const autoRetryToggle = document.querySelector<HTMLInputElement>("#autoRetryToggle");
const retryAttemptsInput = document.querySelector<HTMLInputElement>("#retryAttemptsInput");
const errorHint = document.querySelector<HTMLElement>("#errorHint");

type StatusKind = "idle" | "connected" | "disconnected" | "error" | "working";
let profilesCache: StoredProfile[] = [];
let diagnosticsCache = "Diagnostics are not loaded yet.";
let lastFixCommands: string[] = [];
let assistantLastError: string | null = null;
let quickPrimaryAction: "start-agent" | "save-profile" | "connect" | "connected" = "start-agent";
let quickSecondaryAction: "check-agent" | "copy-setup" | "open-diagnostics" = "check-agent";
const flowState = {
  agentReady: false,
  profileReady: false,
  connected: false
};
const DEFAULT_CONNECT_POLICY: ConnectPolicy = { autoRetry: true, attempts: 3 };
let connectPolicy: ConnectPolicy = { ...DEFAULT_CONNECT_POLICY };

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

function paintAssistantChip(node: HTMLElement | null, state: "pending" | "active" | "done", text: string): void {
  if (!node) return;
  node.classList.remove("pending", "active", "done");
  node.classList.add(state);
  node.textContent = text;
}

function refreshAssistantCard(): void {
  if (!flowState.agentReady) {
    paintAssistantChip(assistantAgent, "active", "Agent: not reachable");
    paintAssistantChip(assistantProfile, "pending", "Profile: waiting for agent");
    paintAssistantChip(assistantConnection, "pending", "Connection: blocked");
    if (assistantNextStep) assistantNextStep.textContent = "Start local agent service, then click Check Agent.";
    return;
  }
  paintAssistantChip(assistantAgent, "done", "Agent: reachable");

  if (!flowState.profileReady) {
    paintAssistantChip(assistantProfile, "active", "Profile: not saved");
    paintAssistantChip(assistantConnection, "pending", "Connection: waiting for profile");
    if (assistantNextStep) assistantNextStep.textContent = "Paste VLESS URL and click Save Profile.";
    return;
  }
  paintAssistantChip(assistantProfile, "done", "Profile: ready");

  if (!flowState.connected) {
    paintAssistantChip(assistantConnection, "active", "Connection: disconnected");
    const suffix = assistantLastError ? ` Last error: ${assistantLastError}.` : "";
    if (assistantNextStep) assistantNextStep.textContent = `Everything is ready. Click Connect.${suffix}`;
    return;
  }
  paintAssistantChip(assistantConnection, "done", "Connection: active");
  if (assistantNextStep) assistantNextStep.textContent = "Setup complete. You can switch profiles or run diagnostics anytime.";
}

function refreshErrorHint(text?: string): void {
  if (!errorHint) return;
  errorHint.textContent = text ?? "Connection errors will be classified automatically.";
}

function refreshSetupFlow(): void {
  const doneCount = [flowState.agentReady, flowState.profileReady, flowState.connected].filter(Boolean).length;
  if (setupProgressText) setupProgressText.textContent = `${doneCount}/3 Ready`;

  paintStep(stepAgent, flowState.agentReady ? "done" : "active");
  if (!flowState.agentReady) {
    paintStep(stepProfile, "pending");
    paintStep(stepConnected, "pending");
  } else {
    paintStep(stepProfile, flowState.profileReady ? "done" : "active");
    if (!flowState.profileReady) {
      paintStep(stepConnected, "pending");
    } else {
      paintStep(stepConnected, flowState.connected ? "done" : "active");
    }
  }
  refreshQuickActions();
  refreshAssistantCard();
}

function refreshQuickActions(): void {
  if (flowState.connected) {
    quickPrimaryAction = "connected";
    quickSecondaryAction = "open-diagnostics";
    if (quickPrimaryButton) {
      quickPrimaryButton.textContent = "Connected";
      quickPrimaryButton.disabled = true;
    }
    if (quickSecondaryButton) quickSecondaryButton.textContent = "Diagnostics";
    return;
  }
  if (!flowState.agentReady) {
    quickPrimaryAction = "start-agent";
    quickSecondaryAction = "check-agent";
    if (quickPrimaryButton) {
      quickPrimaryButton.textContent = "Start Agent";
      quickPrimaryButton.disabled = false;
    }
    if (quickSecondaryButton) quickSecondaryButton.textContent = "Check";
    return;
  }
  if (!flowState.profileReady) {
    quickPrimaryAction = "save-profile";
    quickSecondaryAction = "open-diagnostics";
    if (quickPrimaryButton) {
      quickPrimaryButton.textContent = "Save Profile";
      quickPrimaryButton.disabled = false;
    }
    if (quickSecondaryButton) quickSecondaryButton.textContent = "Diagnostics";
    return;
  }
  quickPrimaryAction = "connect";
  quickSecondaryAction = "open-diagnostics";
  if (quickPrimaryButton) {
    quickPrimaryButton.textContent = "Connect";
    quickPrimaryButton.disabled = false;
  }
  if (quickSecondaryButton) quickSecondaryButton.textContent = "Diagnostics";
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
  if (exportProfilesButton) exportProfilesButton.disabled = busy;
  if (importProfilesButton) importProfilesButton.disabled = busy;
  if (checkAgentButton) checkAgentButton.disabled = busy;
  if (copyAgentCommandButton) copyAgentCommandButton.disabled = busy;
  if (toggleDiagnosticsButton) toggleDiagnosticsButton.disabled = busy;
  if (copyDiagnosticsButton) copyDiagnosticsButton.disabled = busy;
  if (quickPrimaryButton) quickPrimaryButton.disabled = busy || quickPrimaryAction === "connected";
  if (quickSecondaryButton) quickSecondaryButton.disabled = busy;
  if (runFullCheckButton) runFullCheckButton.disabled = busy;
  if (autoRetryToggle) autoRetryToggle.disabled = busy;
  if (retryAttemptsInput) retryAttemptsInput.disabled = busy || !connectPolicy.autoRetry;
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function clampAttempts(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CONNECT_POLICY.attempts;
  return Math.min(5, Math.max(1, Math.round(value)));
}

function renderConnectPolicy(): void {
  if (autoRetryToggle) autoRetryToggle.checked = connectPolicy.autoRetry;
  if (retryAttemptsInput) retryAttemptsInput.value = String(connectPolicy.attempts);
}

async function loadConnectPolicy(): Promise<void> {
  const raw = await chrome.storage.local.get(["connectPolicy"]);
  const value = raw.connectPolicy as Partial<ConnectPolicy> | undefined;
  if (value && typeof value === "object") {
    connectPolicy = {
      autoRetry: typeof value.autoRetry === "boolean" ? value.autoRetry : DEFAULT_CONNECT_POLICY.autoRetry,
      attempts: clampAttempts(Number(value.attempts))
    };
  }
  renderConnectPolicy();
}

async function persistConnectPolicy(): Promise<void> {
  await chrome.storage.local.set({ connectPolicy });
}

function classifyConnectError(message: string): { summary: string; detail: string } {
  const text = message.toLowerCase();
  if (text.includes("request failed: 404") || text.includes("request failed: 500") || text.includes("request failed: 0")) {
    return {
      summary: "Agent API is unreachable",
      detail: "Start or restart local agent service and run Check Agent."
    };
  }
  if (text.includes("binary not found") || text.includes("no such file")) {
    return {
      summary: "Core binary is missing",
      detail: "Install sing-box and start local agent."
    };
  }
  if (text.includes("port 127.0.0.1") || text.includes("address already in use")) {
    return {
      summary: "Local proxy port is busy",
      detail: "Stop conflicting process or change proxy port."
    };
  }
  if (text.includes("no active profile") || text.includes("active profile not found") || text.includes("no profile")) {
    return {
      summary: "Profile is not ready",
      detail: "Save/select a profile before connecting."
    };
  }
  return {
    summary: "Connection attempt failed",
    detail: "Open Diagnostics for details and suggested fixes."
  };
}

function renderDiagnostics(text: string): void {
  diagnosticsCache = text;
  if (diagnosticsText) diagnosticsText.textContent = text;
}

function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

function parseImportPayload(raw: string): Array<{ name?: string; vlessUrl: string }> {
  const parsed = JSON.parse(raw) as unknown;
  const items = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { profiles?: unknown }).profiles)
      ? (parsed as { profiles: unknown[] }).profiles
      : [];
  const normalized: Array<{ name?: string; vlessUrl: string }> = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.vlessUrl !== "string") continue;
    parseVlessUrl(record.vlessUrl);
    normalized.push({
      vlessUrl: record.vlessUrl,
      name: typeof record.name === "string" ? record.name : undefined
    });
  }
  if (normalized.length === 0) {
    throw new Error("No valid profiles found in JSON");
  }
  return normalized;
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
    assistantLastError = result.message ?? "Diagnostics unavailable";
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
  assistantLastError = result.diagnostics.lastError ?? null;
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
    assistantLastError = state.message ?? "Agent is unreachable";
    refreshSetupFlow();
    await loadDiagnostics(true).catch(() => undefined);
    return false;
  }
  flowState.agentReady = true;
  flowState.connected = Boolean(state.connected);
  assistantLastError = state.message ?? null;
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

async function openDiagnosticsPanel(): Promise<void> {
  diagnosticsPanel?.classList.remove("hidden");
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
}

async function doSaveProfile(): Promise<void> {
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
}

async function doConnect(): Promise<void> {
  const maxAttempts = connectPolicy.autoRetry ? connectPolicy.attempts : 1;
  let lastFailure: { summary: string; detail: string; raw: string } | null = null;

  setBusy(true);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    setStatus(`Connecting (${attempt}/${maxAttempts})...`, "working");
    const result = await sendMessage({ type: "connection/connect" });
    if (result.ok) {
      flowState.agentReady = true;
      flowState.connected = true;
      assistantLastError = null;
      refreshSetupFlow();
      hideOnboarding();
      setBusy(false);
      setStatus("Connected via local agent", "connected");
      refreshErrorHint();
      showToast("Connected", "ok");
      return;
    }

    const rawMessage = result.message ?? "Connect failed";
    const classified = classifyConnectError(rawMessage);
    lastFailure = { ...classified, raw: rawMessage };
    assistantLastError = classified.summary;
    refreshSetupFlow();
    refreshErrorHint(`${classified.summary}. ${classified.detail}`);

    if (attempt < maxAttempts) {
      await delay(600 * attempt);
    }
  }

  setBusy(false);
  setStatus(`Error: ${lastFailure?.summary ?? "Connect failed"}`, "error");
  showToast(lastFailure?.summary ?? "Connect failed", "error");
  showOnboarding("Agent service seems unavailable. Check installer/service status.");
  await loadDiagnostics(true).catch(() => undefined);
}

async function doCheckAgent(showSuccessToast = true): Promise<boolean> {
  setBusy(true);
  setStatus("Checking agent...", "working");
  const ok = await refreshConnectionStatus(showSuccessToast).catch(() => false);
  if (!ok) {
    showToast("Agent is still unavailable", "error");
  }
  setBusy(false);
  return ok;
}

async function copySetupCommandWithToast(): Promise<void> {
  try {
    const copied = await copyTextToClipboard(getAgentSetupCommand());
    if (!copied) {
      throw new Error("Unable to access clipboard");
    }
    showToast("Setup command copied", "ok");
  } catch (error: unknown) {
    const text = error instanceof Error ? error.message : "Copy failed";
    showToast(text, "error");
  }
}

async function runFullCheck(): Promise<void> {
  setBusy(true);
  setStatus("Running full check...", "working");

  const [profilesResult, statusResult, diagnosticsResult] = await Promise.all([
    sendMessage({ type: "profile/list" }).catch(() => ({ ok: false, message: "Profile check failed" } as ResponsePayload)),
    sendMessage({ type: "connection/status" }).catch(() => ({ ok: false, message: "Agent status check failed" } as ResponsePayload)),
    sendMessage({ type: "connection/diagnostics" }).catch(
      () => ({ ok: false, message: "Diagnostics check failed" } as ResponsePayload)
    )
  ]);

  if (profilesResult.ok) {
    renderProfiles(profilesResult.profiles ?? [], profilesResult.activeProfileId ?? null);
    flowState.profileReady = (profilesResult.profiles?.length ?? 0) > 0;
  } else {
    flowState.profileReady = false;
  }

  if (statusResult.ok) {
    flowState.agentReady = true;
    flowState.connected = Boolean(statusResult.connected);
    hideOnboarding();
  } else {
    flowState.agentReady = false;
    flowState.connected = false;
    showOnboarding("Agent service seems unavailable. Check installer/service status.");
  }

  if (diagnosticsResult.ok && diagnosticsResult.diagnostics) {
    renderDiagnostics(formatDiagnostics(diagnosticsResult.diagnostics));
    renderFixes(inferFixes(diagnosticsResult.diagnostics));
    assistantLastError = diagnosticsResult.diagnostics.lastError ?? null;
  } else {
    assistantLastError = diagnosticsResult.message ?? statusResult.message ?? null;
  }

  refreshSetupFlow();
  refreshErrorHint(assistantLastError ? `Last issue: ${assistantLastError}` : undefined);
  setBusy(false);

  if (!flowState.agentReady) {
    setStatus("Full check: agent unavailable", "error");
    showToast("Full check finished: agent unavailable", "error");
    return;
  }
  if (!flowState.profileReady) {
    setStatus("Full check: save a profile to continue", "disconnected");
    showToast("Full check finished: profile required", "error");
    return;
  }
  if (!flowState.connected) {
    setStatus("Full check: ready to connect", "disconnected");
    showToast("Full check finished", "ok");
    return;
  }
  setStatus("Full check: all systems ready", "connected");
  showToast("Full check finished", "ok");
}

async function bootstrap(): Promise<void> {
  await loadConnectPolicy();
  refreshSetupFlow();
  await refreshProfiles();
  await refreshConnectionStatus();
  refreshErrorHint();
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
  await doSaveProfile();
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
  await doConnect();
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
  assistantLastError = null;
  refreshSetupFlow();
  setStatus("Disconnected and proxy reset", "disconnected");
  showToast("Disconnected", "ok");
});

checkAgentButton?.addEventListener("click", async () => {
  await doCheckAgent(true);
});

copyAgentCommandButton?.addEventListener("click", async () => {
  await copySetupCommandWithToast();
});

toggleDiagnosticsButton?.addEventListener("click", async () => {
  const isHidden = diagnosticsPanel?.classList.contains("hidden") ?? true;
  if (!isHidden) {
    diagnosticsPanel?.classList.add("hidden");
    return;
  }
  await openDiagnosticsPanel();
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

quickPrimaryButton?.addEventListener("click", async () => {
  switch (quickPrimaryAction) {
    case "start-agent":
      await copySetupCommandWithToast();
      break;
    case "save-profile":
      await doSaveProfile();
      break;
    case "connect":
      await doConnect();
      break;
    case "connected":
      break;
    default:
      break;
  }
});

quickSecondaryButton?.addEventListener("click", async () => {
  switch (quickSecondaryAction) {
    case "check-agent":
      await doCheckAgent(true);
      break;
    case "copy-setup":
      await copySetupCommandWithToast();
      break;
    case "open-diagnostics":
      await openDiagnosticsPanel();
      break;
    default:
      break;
  }
});

runFullCheckButton?.addEventListener("click", async () => {
  await runFullCheck();
});

exportProfilesButton?.addEventListener("click", async () => {
  setBusy(true);
  const result = await sendMessage({ type: "profile/list" }).catch(
    () => ({ ok: false, message: "Unable to export profiles" } as ResponsePayload)
  );
  setBusy(false);
  if (!result.ok) {
    setStatus(result.message ?? "Unable to export profiles", "error");
    showToast("Export failed", "error");
    return;
  }
  const profiles = result.profiles ?? [];
  if (profiles.length === 0) {
    showToast("No profiles to export", "error");
    return;
  }
  const payload = {
    exportedAt: new Date().toISOString(),
    schema: "v2ray-extension/profiles-v1",
    profiles: profiles.map((profile) => ({ name: profile.name, vlessUrl: profile.vlessUrl }))
  };
  const stamp = new Date().toISOString().slice(0, 10);
  downloadTextFile(`v2ray-profiles-${stamp}.json`, JSON.stringify(payload, null, 2));
  showToast(`Exported ${profiles.length} profiles`, "ok");
});

importProfilesButton?.addEventListener("click", () => {
  importProfilesInput?.click();
});

importProfilesInput?.addEventListener("change", async () => {
  const file = importProfilesInput.files?.[0];
  importProfilesInput.value = "";
  if (!file) return;

  setBusy(true);
  try {
    const raw = await file.text();
    const items = parseImportPayload(raw);
    let imported = 0;
    for (const item of items) {
      const response = await sendMessage({
        type: "profile/save",
        vlessUrl: item.vlessUrl,
        name: item.name
      });
      if (response.ok) {
        imported += 1;
      }
    }
    await refreshProfiles();
    setStatus(`Imported ${imported}/${items.length} profiles`, imported > 0 ? "idle" : "error");
    showToast(imported > 0 ? `Imported ${imported} profiles` : "Import failed", imported > 0 ? "ok" : "error");
  } catch (error: unknown) {
    const text = error instanceof Error ? error.message : "Import failed";
    setStatus(text, "error");
    showToast(text, "error");
  } finally {
    setBusy(false);
  }
});

autoRetryToggle?.addEventListener("change", async () => {
  connectPolicy.autoRetry = Boolean(autoRetryToggle.checked);
  renderConnectPolicy();
  await persistConnectPolicy();
});

retryAttemptsInput?.addEventListener("change", async () => {
  connectPolicy.attempts = clampAttempts(Number(retryAttemptsInput.value));
  renderConnectPolicy();
  await persistConnectPolicy();
});

void bootstrap();
