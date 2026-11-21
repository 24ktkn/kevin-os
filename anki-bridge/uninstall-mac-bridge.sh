#!/usr/bin/env bash
# Cleanly stops and removes the Kevin-OS MacBook Anki Bridge LaunchAgent
set -euo pipefail

LABEL="com.kevinos.ankibridge"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL}.plist"
USER_UID="$(id -u)"

launchctl bootout "gui/${USER_UID}/${LABEL}" 2>/dev/null || launchctl unload "$PLIST_PATH" 2>/dev/null || true
rm -f "$PLIST_PATH"

echo "✅ Stopped and removed $LABEL LaunchAgent."
