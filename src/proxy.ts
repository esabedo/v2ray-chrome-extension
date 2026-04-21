const DEFAULT_BYPASS = ["localhost", "127.0.0.1"];

export async function setFixedHttpProxy(port: number, bypassList: string[] = []): Promise<void> {
  const normalized = Array.from(
    new Set(
      [...DEFAULT_BYPASS, ...bypassList.map((item) => item.trim()).filter(Boolean)].map((item) => item.toLowerCase())
    )
  );
  await chrome.proxy.settings.set({
    value: {
      mode: "fixed_servers",
      rules: {
        singleProxy: {
          scheme: "http",
          host: "127.0.0.1",
          port
        },
        bypassList: normalized
      }
    },
    scope: "regular"
  });
}

export async function clearProxy(): Promise<void> {
  await chrome.proxy.settings.set({
    value: { mode: "direct" },
    scope: "regular"
  });
}
