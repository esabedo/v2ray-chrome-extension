#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/agent"

python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip >/dev/null
pip install -r requirements.txt >/dev/null

XRAY_BIN="${XRAY_BIN:-$ROOT_DIR/agent/bin/xray}"
SINGBOX_BIN="${SINGBOX_BIN:-$ROOT_DIR/agent/bin/sing-box}"
AGENT_CORE="${AGENT_CORE:-xray}"

if [[ "$AGENT_CORE" == "xray" ]]; then
  if [[ ! -x "$XRAY_BIN" ]]; then
    echo "xray binary not found at $XRAY_BIN"
    echo "Run: ./scripts/install-xray-macos.sh"
    exit 1
  fi
elif [[ "$AGENT_CORE" == "singbox" ]]; then
  if [[ ! -x "$SINGBOX_BIN" ]]; then
    echo "sing-box binary not found at $SINGBOX_BIN"
    echo "Run: ./scripts/install-singbox-macos.sh"
    exit 1
  fi
else
  echo "Unsupported AGENT_CORE=$AGENT_CORE (expected xray or singbox)"
  exit 1
fi

export XRAY_BIN
export SINGBOX_BIN
export AGENT_CORE
export AGENT_MOCK_MODE=0
exec uvicorn main:app --host 127.0.0.1 --port 8777
