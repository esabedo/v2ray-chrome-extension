#!/usr/bin/env bash
set -euo pipefail

PLIST_PATH="/Library/LaunchDaemons/com.v2rayextension.agent.plist"

usage() {
  echo "Usage: v2ray-agentctl <start|stop|restart|status>"
}

if [[ $# -ne 1 ]]; then
  usage
  exit 1
fi

case "$1" in
  start)
    sudo launchctl bootstrap system "$PLIST_PATH" || sudo launchctl enable system/com.v2rayextension.agent
    ;;
  stop)
    sudo launchctl bootout system "$PLIST_PATH" || true
    ;;
  restart)
    sudo launchctl bootout system "$PLIST_PATH" || true
    sudo launchctl bootstrap system "$PLIST_PATH"
    ;;
  status)
    sudo launchctl print system/com.v2rayextension.agent
    ;;
  *)
    usage
    exit 1
    ;;
esac
