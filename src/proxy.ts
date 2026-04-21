export async function setFixedHttpProxy(port: number): Promise<void> {
  await chrome.proxy.settings.set({
    value: {
      mode: "fixed_servers",
      rules: {
        singleProxy: {
          scheme: "http",
          host: "127.0.0.1",
          port
        },
        bypassList: ["localhost", "127.0.0.1"]
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
