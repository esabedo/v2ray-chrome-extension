# v2ray-extension

Chrome-compatible extension that accepts `vless://...` URL, sends it to local agent, and switches browser proxy.

## Architecture

- `src/*`: MV3 extension on TypeScript.
- `agent/*`: local localhost API agent on Python/FastAPI.
- `docker-compose.yml`: local agent runtime in mock mode for API checks.

Flow:

1. User pastes `vless://...` in popup.
2. Extension validates it and sends to `http://127.0.0.1:8777/v1/profile`.
3. On connect, agent starts selected core (`xray` or `sing-box`, or mock mode) and returns `httpProxyPort`.
4. Extension enables `chrome.proxy` fixed server to `127.0.0.1:<port>`.

## Local run

```bash
npm install
npm run build
```

Load unpacked extension from `dist/` in Chromium.

Run local agent in Docker:

```bash
docker compose up --build -d
```

Check agent quickly:

```bash
npm run smoke:agent
```

Stop agent:

```bash
docker compose down
```

## Real xray mode (macOS)

Install xray binary to repo-local path:

```bash
npm run xray:install:macos
```

Run local agent (mock disabled):

```bash
npm run agent:run
```

If another VPN is active, try forcing outbound via physical interface:

```bash
XRAY_OUTBOUND_INTERFACE=en0 npm run agent:run
```

Or force source address (if you know your local LAN IP):

```bash
XRAY_SEND_THROUGH=192.168.1.10 npm run agent:run
```

In a second terminal, check diagnostics:

```bash
curl http://127.0.0.1:8777/v1/diagnostics
```

Expected response should contain:

- `"mockMode": false`
- `"xrayVersion": "Xray ..."`
- `"connected": false` (before connect)

## Real sing-box mode (macOS)

Install sing-box binary to repo-local path:

```bash
npm run singbox:install:macos
```

Run agent with sing-box core:

```bash
npm run agent:run:singbox
```

You can combine with route overrides:

```bash
AGENT_CORE=singbox XRAY_OUTBOUND_INTERFACE=en0 XRAY_SEND_THROUGH=192.168.1.10 npm run agent:run
```
