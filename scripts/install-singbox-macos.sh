#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="$ROOT_DIR/agent/bin"
TARGET_BIN="$TARGET_DIR/sing-box"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

ARCH="$(uname -m)"
case "$ARCH" in
  arm64|aarch64) PKG_ARCH="arm64" ;;
  x86_64) PKG_ARCH="amd64" ;;
  *)
    echo "Unsupported macOS arch: $ARCH"
    exit 1
    ;;
esac

VERSION="${1:-latest}"
if [[ "$VERSION" == "latest" ]]; then
  VERSION="$(curl -fsSL https://api.github.com/repos/SagerNet/sing-box/releases/latest | rg -o '"tag_name":\s*"[^"]+"' | head -n1 | sed -E 's/.*"([^"]+)"/\1/')"
fi

if [[ -z "$VERSION" ]]; then
  echo "Failed to resolve sing-box version"
  exit 1
fi

FILE_NAME="sing-box-${VERSION#v}-darwin-${PKG_ARCH}.tar.gz"
RELEASE_URL="https://github.com/SagerNet/sing-box/releases/download/${VERSION}/${FILE_NAME}"

mkdir -p "$TARGET_DIR"
echo "Downloading $RELEASE_URL"
curl -fL "$RELEASE_URL" -o "$TMP_DIR/singbox.tar.gz"
tar -xzf "$TMP_DIR/singbox.tar.gz" -C "$TMP_DIR"

FOUND_BIN="$(find "$TMP_DIR" -type f -name sing-box | head -n1)"
if [[ -z "$FOUND_BIN" ]]; then
  echo "sing-box binary not found in archive"
  exit 1
fi

install -m 0755 "$FOUND_BIN" "$TARGET_BIN"
"$TARGET_BIN" version | head -n 1
echo "Installed: $TARGET_BIN"
