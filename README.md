# v2ray-extension

Chrome-compatible extension that accepts `vless://...` URL, sends it to local agent, and switches browser proxy.

## Architecture

- `src/*`: MV3 extension on TypeScript.
- `go-agent/*`: local localhost API agent on Go.
- `agent/bin/sing-box`: transport core binary controlled by Go agent.

Flow:

1. User pastes `vless://...` in popup.
2. Extension validates it and sends to `http://127.0.0.1:8777/v1/profile`.
3. On connect, Go agent starts `sing-box` and returns `httpProxyPort`.
4. Extension enables `chrome.proxy` fixed server to `127.0.0.1:<port>`.

## What is new in 0.3.0

- First-run Setup Assistant with one-click full health check.
- Connection reliability policy: auto-retry with configurable attempts and classified errors.
- Profile portability: import/export profile JSON directly from popup.
- Configurable proxy bypass list (sites that should go direct, without VPN/proxy).
- Support workflow: copyable diagnostics bundle + in-popup recent event timeline.
- Existing 0.2.0 improvements retained: multi-profile UX, CI smoke stack, schema migration, release hardening.

## Local run

```bash
npm install
npm run build
```

Load unpacked extension from `dist/` in Chromium.

## Quick start (developer)

```bash
npm install
npm run build
npm run agent:build:go
npm run singbox:install:macos
npm run smoke:stack
```

Then load `dist/` in Chromium via `chrome://extensions` (Developer Mode).

## Real mode (macOS)

Install sing-box binary to repo-local path:

```bash
npm run singbox:install:macos
```

Run local agent (Go):

```bash
npm run agent:run
```

If Go is installed, you can build native local agent binary:

```bash
npm run agent:build:go
```

Build macOS installer package:

```bash
npm run package:macos
```

The macOS installer registers and starts `com.v2rayextension.agent` via `launchd`.

## Windows packaging

On Windows host:

1. Install Go, WiX v4 (CLI `wix` in PATH).
2. Install sing-box binary:

```powershell
npm run singbox:install:windows
```

3. Build MSI:

```powershell
npm run package:windows
```

The MSI installs and auto-starts `V2RayExtensionAgent` Windows service.

## Upgrade notes (0.2.x -> 0.3.0)

- UI data model now stores local connection policy (`connectPolicy`) in extension storage.
- Existing profile schema migration behavior from 0.2.x remains unchanged and backward compatible.

## GitHub releases

- CI workflow (`.github/workflows/ci.yml`) validates build/test and packaging on macOS and Windows.
- Release workflow (`.github/workflows/release.yml`) builds `.pkg` and `.msi`, validates artifacts/checksums, and publishes GitHub Release assets with `SHA256SUMS.txt`.
- Trigger release by pushing a tag like `v1.0.0`, or run workflow manually with `version` input.

## Known limitations

- This is not a "pure extension VPN": VLESS/Reality requires a local core (`sing-box`) managed by local agent.
- Browser extension controls proxy only for browser traffic, not full-system routing.
- Signed/notarized installers are not yet included in this repository workflow.
