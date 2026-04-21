#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SINGBOX_BIN="${SINGBOX_BIN:-$ROOT_DIR/agent/bin/sing-box}"
GO_AGENT_BIN="${GO_AGENT_BIN:-$ROOT_DIR/go-agent/bin/v2ray-agent}"

if [[ ! -x "$SINGBOX_BIN" ]]; then
  echo "sing-box binary not found at $SINGBOX_BIN"
  echo "Run: ./scripts/install-singbox-macos.sh"
  exit 1
fi

export SINGBOX_BIN
if [[ -x "$GO_AGENT_BIN" ]]; then
  exec "$GO_AGENT_BIN"
fi

if command -v go >/dev/null 2>&1; then
  exec go run ./go-agent/cmd/agent
fi

echo "Go runtime not found and prebuilt agent binary is missing."
echo "Install Go or build binary:"
echo "  npm run agent:build:go"
exit 1
