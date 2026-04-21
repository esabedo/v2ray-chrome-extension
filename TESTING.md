# Testing Strategy

## 1) Unit tests (fast)

- Run `npm run test`.
- Covered now: `vless://` parser validation.
- Covered now: storage schema migration and legacy profile normalization.

## 2) Full local smoke stack (recommended)

Single command that starts local agent, waits for health, runs API checks, then stops agent:

```bash
npm run smoke:stack
```

This command requires:

- built Go agent binary (`npm run agent:build:go`),
- installed `sing-box` binary in `agent/bin`.

## 3) Go Agent API smoke test (agent already running)

1. Start agent:

```bash
npm run singbox:install:macos
npm run agent:run
```

2. Run smoke scenario in separate terminal:

```bash
npm run smoke:agent
```

It verifies:

- `GET /v1/health`
- `POST /v1/profile`
- `POST /v1/connect`
- `GET /v1/status`
- `POST /v1/disconnect`

## 4) Diagnostics check (macOS)

1. Run agent locally:

```bash
npm run agent:run
```

2. Verify diagnostics:

```bash
curl http://127.0.0.1:8777/v1/diagnostics
```

3. Import real profile and connect via extension popup.

4. Confirm:

- `/v1/status` has `"connected": true`
- Browser traffic uses `127.0.0.1:10809` proxy.

## 5) Manual extension test (browser)

1. Build extension: `npm run build`.
2. Open Chromium `chrome://extensions`.
3. Enable Developer Mode.
4. Load unpacked: `dist/`.
5. Start local Go agent (`npm run agent:run`).
6. Paste a sample `vless://...` in popup.
7. Click `Save`, then `Connect`, then `Disconnect`.
8. Verify state text and no extension errors in service worker console.
9. Validate `Run Full Check` produces actionable next step in Setup Assistant.
10. Toggle `Auto-retry connect` and verify connect retries up to selected attempts.
11. Export profiles to JSON, re-import, and verify no invalid profile is accepted.
12. Open Diagnostics and verify `Copy Bundle` includes sanitized diagnostics + recent events.
13. Add multiple domains to bypass list (one per line), save, connect, and verify these domains are routed direct.

## 6) Installer checks

macOS:

```bash
npm run package:macos
```

Verify generated file exists in `dist/install/macos/*.pkg`.

Windows (on Windows host):

```powershell
npm run singbox:install:windows
npm run package:windows
```

Verify generated file exists in `dist\install\windows\*.msi`.

## 7) CI and release gates

- CI (`.github/workflows/ci.yml`) runs:
  - build + unit tests,
  - Go agent build,
  - `smoke:stack`,
  - platform packaging (`.pkg` / `.msi`).
- Release workflow (`.github/workflows/release.yml`) additionally verifies release asset layout and checksum entries before publishing.
