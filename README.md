# v2ray-extension

Prototype Chrome-compatible extension that controls a local agent over localhost API.

## Stack

- Extension: TypeScript (MV3)
- Local agent: Python HTTP API (planned)

## Run

```bash
npm install
npm run build
```

Then load `dist/` as an unpacked extension in Chromium.
