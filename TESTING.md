# Testing Strategy

## 1) Unit tests (fast)

- Run `npm run test`.
- Covered now: `vless://` parser validation.
- Extend next: message routing in background and UI state helpers.

## 2) Agent API smoke test

1. Start agent:

```bash
docker compose up --build -d
```

2. Run smoke scenario:

```bash
npm run smoke:agent
```

It verifies:

- `GET /v1/health`
- `POST /v1/profile`
- `POST /v1/connect`
- `GET /v1/status`
- `POST /v1/disconnect`

## 3) Real xray diagnostics test (macOS)

1. Install xray:

```bash
npm run xray:install:macos
```

2. Run agent locally:

```bash
npm run agent:run
```

3. Verify diagnostics:

```bash
curl http://127.0.0.1:8777/v1/diagnostics
```

4. Import real profile and connect via extension popup.

5. Confirm:

- `/v1/status` has `"connected": true`
- Browser traffic uses `127.0.0.1:10809` proxy.

If you cannot disable another VPN:

- rerun agent with `XRAY_OUTBOUND_INTERFACE=en0 npm run agent:run`,
- then retest connect and traffic,
- inspect `GET /v1/xray/logs` for Reality handshake errors.

## 4) Real sing-box diagnostics test (macOS)

1. Install sing-box:

```bash
npm run singbox:install:macos
```

2. Run agent locally with sing-box:

```bash
npm run agent:run:singbox
```

3. Verify diagnostics:

```bash
curl http://127.0.0.1:8777/v1/diagnostics
```

Expected: `"agentCore": "singbox"`.

## 5) Manual extension test (browser)

1. Build extension: `npm run build`.
2. Open Chromium `chrome://extensions`.
3. Enable Developer Mode.
4. Load unpacked: `dist/`.
5. Start agent in Docker mock mode.
6. Paste a sample `vless://...` in popup.
7. Click `Save`, then `Connect`, then `Disconnect`.
8. Verify state text and no extension errors in service worker console.

## 6) Planned E2E

- Use Playwright with persistent context and loaded unpacked extension.
- Scenarios:
  - save profile success/fail,
  - connect toggles proxy,
  - disconnect resets to direct.
- For network verification, add a test endpoint and compare observed external IP before/after connect.
