#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist/install/macos"
STAGE_ROOT="$DIST_DIR/stage/root"
SCRIPTS_DIR="$DIST_DIR/stage/scripts"
PKG_ID="com.v2rayextension.agent"
VERSION="${1:-}"

if [[ -z "$VERSION" ]]; then
  VERSION="$(node -e 'const fs=require("fs"); const p=JSON.parse(fs.readFileSync("package.json","utf8")); console.log(p.version);')"
fi

if ! command -v pkgbuild >/dev/null 2>&1; then
  echo "pkgbuild is required (Xcode Command Line Tools)."
  exit 1
fi

if [[ ! -x "$ROOT_DIR/agent/bin/sing-box" ]]; then
  echo "sing-box binary not found at $ROOT_DIR/agent/bin/sing-box"
  echo "Run: npm run singbox:install:macos"
  exit 1
fi

if [[ ! -x "$ROOT_DIR/go-agent/bin/v2ray-agent" ]]; then
  echo "Go agent binary not found at $ROOT_DIR/go-agent/bin/v2ray-agent"
  echo "Run: npm run agent:build:go"
  exit 1
fi

rm -rf "$DIST_DIR/stage"
mkdir -p "$STAGE_ROOT/usr/local/lib/v2ray-extension"
mkdir -p "$STAGE_ROOT/usr/local/bin"
mkdir -p "$STAGE_ROOT/Library/LaunchDaemons"
mkdir -p "$SCRIPTS_DIR"

install -m 0755 "$ROOT_DIR/go-agent/bin/v2ray-agent" "$STAGE_ROOT/usr/local/lib/v2ray-extension/v2ray-agent"
install -m 0755 "$ROOT_DIR/agent/bin/sing-box" "$STAGE_ROOT/usr/local/lib/v2ray-extension/sing-box"
install -m 0755 "$ROOT_DIR/installer/macos/v2ray-agentctl.sh" "$STAGE_ROOT/usr/local/bin/v2ray-agentctl"
install -m 0644 "$ROOT_DIR/installer/macos/com.v2rayextension.agent.plist" "$STAGE_ROOT/Library/LaunchDaemons/com.v2rayextension.agent.plist"
install -m 0755 "$ROOT_DIR/installer/macos/scripts/postinstall" "$SCRIPTS_DIR/postinstall"

OUT_PKG="$DIST_DIR/v2ray-extension-agent-${VERSION}.pkg"
mkdir -p "$DIST_DIR"

pkgbuild \
  --root "$STAGE_ROOT" \
  --scripts "$SCRIPTS_DIR" \
  --identifier "$PKG_ID" \
  --version "$VERSION" \
  --install-location "/" \
  "$OUT_PKG"

echo "Built package: $OUT_PKG"
