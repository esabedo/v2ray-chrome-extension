chrome.runtime.onInstalled.addListener(() => {
  console.info("V2Ray extension installed");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ping") {
    sendResponse({ ok: true, source: "background" });
  }
  return false;
});
