import { connectAgent, disconnectAgent, getStatus, healthcheck, importProfile } from "./agent-client.js";
import { clearProxy, setFixedHttpProxy } from "./proxy.js";
import { parseVlessUrl } from "./vless.js";

type RpcMessage =
  | { type: "profile/save"; vlessUrl: string }
  | { type: "connection/connect" }
  | { type: "connection/disconnect" }
  | { type: "connection/status" };

type RpcResponse = {
  ok: boolean;
  message?: string;
  connected?: boolean;
};

async function saveProfile(vlessUrl: string): Promise<RpcResponse> {
  parseVlessUrl(vlessUrl);
  await chrome.storage.local.set({ vlessUrl });
  await importProfile(vlessUrl);
  return { ok: true, message: "Profile saved in extension and agent" };
}

async function connect(): Promise<RpcResponse> {
  const saved = await chrome.storage.local.get(["vlessUrl"]);
  if (!saved.vlessUrl) {
    throw new Error("No VLESS profile saved");
  }

  parseVlessUrl(saved.vlessUrl);
  await healthcheck();
  await importProfile(saved.vlessUrl);
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

chrome.runtime.onInstalled.addListener(() => {
  console.info("V2Ray extension installed");
});

chrome.runtime.onMessage.addListener((message: RpcMessage, _sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case "profile/save":
        sendResponse(await saveProfile(message.vlessUrl));
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
      default:
        sendResponse({ ok: false, message: "Unsupported message type" } satisfies RpcResponse);
    }
  })().catch((error: unknown) => {
    const text = error instanceof Error ? error.message : String(error);
    sendResponse({ ok: false, message: text } satisfies RpcResponse);
  });

  return true;
});
