import { connectAgent, disconnectAgent, getDiagnostics, getStatus, healthcheck, importProfile } from "./agent-client.js";
import { clearProxy, setFixedHttpProxy } from "./proxy.js";
import { parseVlessUrl } from "./vless.js";

type StoredProfile = {
  id: string;
  name: string;
  vlessUrl: string;
  createdAt: number;
};

type StorageShape = {
  profiles: StoredProfile[];
  activeProfileId: string | null;
};

type RpcMessage =
  | { type: "profile/save"; vlessUrl: string; name?: string }
  | { type: "profile/list" }
  | { type: "profile/select"; profileId: string }
  | { type: "profile/delete"; profileId: string }
  | { type: "connection/connect" }
  | { type: "connection/disconnect" }
  | { type: "connection/status" }
  | { type: "connection/diagnostics" };

type RpcResponse = {
  ok: boolean;
  message?: string;
  connected?: boolean;
  profiles?: StoredProfile[];
  activeProfileId?: string | null;
  diagnostics?: unknown;
};

function makeProfileName(vlessUrl: string): string {
  const parsed = parseVlessUrl(vlessUrl);
  if (parsed.remark) return parsed.remark;
  return `${parsed.host}:${parsed.port}`;
}

function makeProfileId(): string {
  if ("randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function readStorage(): Promise<StorageShape> {
  const raw = await chrome.storage.local.get(["profiles", "activeProfileId", "vlessUrl"]);
  const profiles = Array.isArray(raw.profiles) ? (raw.profiles as StoredProfile[]) : [];
  let activeProfileId = typeof raw.activeProfileId === "string" ? raw.activeProfileId : null;

  // One-time migration from old single-profile key.
  if (profiles.length === 0 && typeof raw.vlessUrl === "string" && raw.vlessUrl.trim()) {
    parseVlessUrl(raw.vlessUrl);
    const migrated: StoredProfile = {
      id: makeProfileId(),
      name: makeProfileName(raw.vlessUrl),
      vlessUrl: raw.vlessUrl,
      createdAt: Date.now()
    };
    await chrome.storage.local.set({
      profiles: [migrated],
      activeProfileId: migrated.id
    });
    await chrome.storage.local.remove(["vlessUrl"]);
    return { profiles: [migrated], activeProfileId: migrated.id };
  }

  if (profiles.length > 0 && (!activeProfileId || !profiles.some((p) => p.id === activeProfileId))) {
    activeProfileId = profiles[0].id;
    await chrome.storage.local.set({ activeProfileId });
  }

  return { profiles, activeProfileId };
}

async function writeStorage(next: StorageShape): Promise<void> {
  await chrome.storage.local.set(next);
}

async function saveProfile(vlessUrl: string, customName?: string): Promise<RpcResponse> {
  parseVlessUrl(vlessUrl);
  const preferredName = customName?.trim();

  const state = await readStorage();
  const existing = state.profiles.find((p) => p.vlessUrl === vlessUrl);
  if (existing) {
    const updatedProfiles = preferredName
      ? state.profiles.map((p) => (p.id === existing.id ? { ...p, name: preferredName } : p))
      : state.profiles;
    await writeStorage({ profiles: updatedProfiles, activeProfileId: existing.id });
    await importProfile(vlessUrl);
    return {
      ok: true,
      message: "Profile already exists and selected",
      profiles: updatedProfiles,
      activeProfileId: existing.id
    };
  }

  const created: StoredProfile = {
    id: makeProfileId(),
    name: preferredName || makeProfileName(vlessUrl),
    vlessUrl,
    createdAt: Date.now()
  };
  const profiles = [created, ...state.profiles];
  await writeStorage({ profiles, activeProfileId: created.id });
  await importProfile(vlessUrl);
  return {
    ok: true,
    message: "Profile saved",
    profiles,
    activeProfileId: created.id
  };
}

async function listProfiles(): Promise<RpcResponse> {
  const state = await readStorage();
  return {
    ok: true,
    profiles: state.profiles,
    activeProfileId: state.activeProfileId
  };
}

async function selectProfile(profileId: string): Promise<RpcResponse> {
  const state = await readStorage();
  const profile = state.profiles.find((p) => p.id === profileId);
  if (!profile) throw new Error("Profile not found");
  await writeStorage({ profiles: state.profiles, activeProfileId: profile.id });
  await importProfile(profile.vlessUrl);
  return {
    ok: true,
    message: "Active profile updated",
    profiles: state.profiles,
    activeProfileId: profile.id
  };
}

async function deleteProfile(profileId: string): Promise<RpcResponse> {
  const state = await readStorage();
  const profiles = state.profiles.filter((p) => p.id !== profileId);
  const activeProfileId =
    state.activeProfileId === profileId ? (profiles.length > 0 ? profiles[0].id : null) : state.activeProfileId;
  await writeStorage({ profiles, activeProfileId });
  if (activeProfileId) {
    const next = profiles.find((p) => p.id === activeProfileId);
    if (next) await importProfile(next.vlessUrl);
  } else {
    await disconnectAgent().catch(() => undefined);
    await clearProxy().catch(() => undefined);
  }
  return {
    ok: true,
    message: "Profile removed",
    profiles,
    activeProfileId
  };
}

async function connect(): Promise<RpcResponse> {
  const state = await readStorage();
  if (!state.activeProfileId) {
    throw new Error("No active profile");
  }
  const active = state.profiles.find((p) => p.id === state.activeProfileId);
  if (!active) {
    throw new Error("Active profile not found");
  }
  parseVlessUrl(active.vlessUrl);
  await healthcheck();
  await importProfile(active.vlessUrl);
  const result = await connectAgent();
  await setFixedHttpProxy(result.httpProxyPort);
  return { ok: true, connected: true, message: "Connected via local agent" };
}

async function disconnect(): Promise<RpcResponse> {
  await disconnectAgent();
  await clearProxy();
  return { ok: true, connected: false, message: "Disconnected and proxy reset" };
}

async function status(): Promise<RpcResponse> {
  const s = await getStatus();
  return {
    ok: true,
    connected: s.connected,
    message: s.lastError ?? (s.connected ? "Connected" : "Disconnected")
  };
}

async function diagnostics(): Promise<RpcResponse> {
  return {
    ok: true,
    diagnostics: await getDiagnostics()
  };
}

chrome.runtime.onInstalled.addListener(() => {
  console.info("V2Ray extension installed");
});

chrome.runtime.onMessage.addListener((message: RpcMessage, _sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case "profile/save":
        sendResponse(await saveProfile(message.vlessUrl, message.name));
        return;
      case "profile/list":
        sendResponse(await listProfiles());
        return;
      case "profile/select":
        sendResponse(await selectProfile(message.profileId));
        return;
      case "profile/delete":
        sendResponse(await deleteProfile(message.profileId));
        return;
      case "connection/connect":
        sendResponse(await connect());
        return;
      case "connection/disconnect":
        sendResponse(await disconnect());
        return;
      case "connection/status":
        sendResponse(await status());
        return;
      case "connection/diagnostics":
        sendResponse(await diagnostics());
        return;
      default:
        sendResponse({ ok: false, message: "Unsupported message type" } satisfies RpcResponse);
    }
  })().catch((error: unknown) => {
    const text = error instanceof Error ? error.message : String(error);
    sendResponse({ ok: false, message: text } satisfies RpcResponse);
  });

  return true;
});
