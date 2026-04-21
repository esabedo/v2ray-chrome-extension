export type VlessProfile = {
  id: string;
  host: string;
  port: number;
  encryption: string;
  security: string;
  type: string;
  sni?: string;
  fp?: string;
  pbk?: string;
  sid?: string;
  flow?: string;
  remark?: string;
  raw: string;
};

function required(value: string | null, field: string): string {
  if (!value) throw new Error(`Missing required field: ${field}`);
  return value;
}

export function parseVlessUrl(input: string): VlessProfile {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new Error("Invalid URL");
  }

  if (parsed.protocol !== "vless:") {
    throw new Error("Unsupported scheme");
  }

  const host = required(parsed.hostname, "host");
  const port = Number(required(parsed.port, "port"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid port");
  }

  const encryption = parsed.searchParams.get("encryption") ?? "none";
  const security = parsed.searchParams.get("security") ?? "none";
  const type = parsed.searchParams.get("type") ?? "tcp";
  const id = required(parsed.username, "id");

  return {
    id,
    host,
    port,
    encryption,
    security,
    type,
    sni: parsed.searchParams.get("sni") ?? undefined,
    fp: parsed.searchParams.get("fp") ?? undefined,
    pbk: parsed.searchParams.get("pbk") ?? undefined,
    sid: parsed.searchParams.get("sid") ?? undefined,
    flow: parsed.searchParams.get("flow") ?? undefined,
    remark: parsed.hash ? decodeURIComponent(parsed.hash.replace(/^#/, "")) : undefined,
    raw: input.trim()
  };
}
