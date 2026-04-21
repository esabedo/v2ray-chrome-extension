const AGENT_BASE_URL = "http://127.0.0.1:8777";

export type AgentStatus = {
  connected: boolean;
  httpProxyPort: number;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${AGENT_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) {
    throw new Error(`Agent request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export function healthcheck(): Promise<{ ok: true }> {
  return request<{ ok: true }>("/v1/health");
}

export function importProfile(vlessUrl: string): Promise<{ ok: true }> {
  return request<{ ok: true }>("/v1/profile", {
    method: "POST",
    body: JSON.stringify({ vlessUrl })
  });
}

export function connectAgent(): Promise<{ connected: true; httpProxyPort: number }> {
  return request<{ connected: true; httpProxyPort: number }>("/v1/connect", {
    method: "POST"
  });
}

export function disconnectAgent(): Promise<{ connected: false }> {
  return request<{ connected: false }>("/v1/disconnect", {
    method: "POST"
  });
}

export function getStatus(): Promise<AgentStatus> {
  return request<AgentStatus>("/v1/status");
}
