# v2ray-extension

Chrome-compatible extension that accepts `vless://...` URL, sends it to local agent, and switches browser proxy.

## Architecture

- `src/*`: MV3 extension on TypeScript.
- `agent/*`: local localhost API agent on Python/FastAPI.
- `docker-compose.yml`: local agent runtime in mock mode.

Flow:

1. User pastes `vless://...` in popup.
2. Extension validates it and sends to `http://127.0.0.1:8777/v1/profile`.
3. On connect, agent starts transport process (or mock) and returns `httpProxyPort`.
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
