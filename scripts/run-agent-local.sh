#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/agent"

python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip >/dev/null
pip install -r requirements.txt >/dev/null

XRAY_BIN="${XRAY_BIN:-$ROOT_DIR/agent/bin/xray}"
if [[ ! -x "$XRAY_BIN" ]]; then
  echo "xray binary not found at $XRAY_BIN"
  echo "Run: ./scripts/install-xray-macos.sh"
  exit 1
fi

export XRAY_BIN
export AGENT_MOCK_MODE=0
exec uvicorn main:app --host 127.0.0.1 --port 8777
