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

## Local run

```bash
npm install
npm run build
```

Load unpacked extension from `dist/` in Chromium.

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
