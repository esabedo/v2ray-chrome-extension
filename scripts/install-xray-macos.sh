#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="$ROOT_DIR/agent/bin"
TARGET_BIN="$TARGET_DIR/xray"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

ARCH="$(uname -m)"
case "$ARCH" in
  arm64|aarch64) XRAY_ARCH="arm64-v8a" ;;
  x86_64) XRAY_ARCH="64" ;;
  *)
    echo "Unsupported macOS arch: $ARCH"
    exit 1
    ;;
esac

VERSION="${1:-latest}"
if [[ "$VERSION" == "latest" ]]; then
  RELEASE_URL="https://github.com/XTLS/Xray-core/releases/latest/download/Xray-macos-${XRAY_ARCH}.zip"
else
  RELEASE_URL="https://github.com/XTLS/Xray-core/releases/download/${VERSION}/Xray-macos-${XRAY_ARCH}.zip"
fi

mkdir -p "$TARGET_DIR"

echo "Downloading $RELEASE_URL"
curl -fL "$RELEASE_URL" -o "$TMP_DIR/xray.zip"
unzip -q "$TMP_DIR/xray.zip" -d "$TMP_DIR/extract"

if [[ ! -f "$TMP_DIR/extract/xray" ]]; then
  echo "xray binary not found inside archive"
  exit 1
fi

install -m 0755 "$TMP_DIR/extract/xray" "$TARGET_BIN"
"$TARGET_BIN" version | head -n 1
echo "Installed: $TARGET_BIN"
