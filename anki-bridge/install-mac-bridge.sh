#!/usr/bin/env bash
# Kevin-OS MacBook Silent Background Anki Bridge Installer (macOS LaunchAgent)
# Safe to run alongside your Windows Desktop bridge (atomic multi-device queue lock prevents duplicates).
#
# Usage:
#   bash install-mac-bridge.sh
#   bash install-mac-bridge.sh --token "YOUR_BRIDGE_TOKEN"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYNC_SCRIPT="$SCRIPT_DIR/sync.mjs"
ENV_FILE="$SCRIPT_DIR/.env"
LOG_FILE="$SCRIPT_DIR/bridge.log"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$PLIST_DIR/com.kevinos.ankibridge.plist"
LABEL="com.kevinos.ankibridge"

TOKEN_ARG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --token)
      TOKEN_ARG="${2:-}"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

# 1. Locate Node.js (supports Homebrew Apple Silicon, Homebrew Intel, nvm, system)
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.nvm/versions/node"/*/bin/node; do
    if [[ -x "$candidate" ]]; then
      NODE_BIN="$candidate"
      break
    fi
  done
fi

if [[ -z "$NODE_BIN" ]]; then
  echo "❌ Node.js was not found on your Mac."
  echo "   Install Node.js first via https://nodejs.org (or: brew install node), then re-run this script."
  exit 1
fi
echo "✓ Found Node.js: $NODE_BIN ($("$NODE_BIN" -v))"

# 2. Ensure bridge token is configured in anki-bridge/.env (or ../web/.env.local)
WEB_ENV="$SCRIPT_DIR/../web/.env.local"
write_env_token() {
  local raw="$1"
  if [[ "$raw" == eyJ* || "$raw" == sb_secret_* ]]; then
    cat > "$ENV_FILE" <<EOF
KEVIN_OS_URL=https://kevin-os-xr4m.vercel.app
SUPABASE_SERVICE_ROLE_KEY=$raw
EOF
  else
    cat > "$ENV_FILE" <<EOF
KEVIN_OS_URL=https://kevin-os-xr4m.vercel.app
ANKI_BRIDGE_SECRET=$raw
EOF
  fi
  chmod 600 "$ENV_FILE"
}

if [[ -n "$TOKEN_ARG" ]]; then
  write_env_token "$TOKEN_ARG"
  echo "✓ Saved bridge token to $ENV_FILE (chmod 600)"
elif [[ ! -f "$ENV_FILE" && ! -f "$WEB_ENV" ]]; then
  echo ""
  echo "Paste your Kevin-OS Bridge Token (or Supabase service key):"
  read -r -s -p "Token: " INPUT_TOKEN
  echo ""
  if [[ -z "$INPUT_TOKEN" ]]; then
    echo "❌ Token cannot be empty. Re-run with --token \"YOUR_TOKEN\"."
    exit 1
  fi
  write_env_token "$INPUT_TOKEN"
  echo "✓ Saved bridge token securely to $ENV_FILE (chmod 600)"
else
  echo "✓ Using existing credentials file"
fi

# 3. Write macOS LaunchAgent plist
mkdir -p "$PLIST_DIR"
cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${SYNC_SCRIPT}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${SCRIPT_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string>${LOG_FILE}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_FILE}</string>
</dict>
</plist>
EOF

# 4. Reload & start LaunchAgent immediately
USER_UID="$(id -u)"
launchctl bootout "gui/${USER_UID}/${LABEL}" 2>/dev/null || launchctl unload "$PLIST_PATH" 2>/dev/null || true
if ! launchctl bootstrap "gui/${USER_UID}" "$PLIST_PATH" 2>/dev/null; then
  launchctl load -w "$PLIST_PATH"
fi

echo ""
echo "✅ Kevin-OS Anki Bridge LaunchAgent installed & running silently on your MacBook!"
echo "   Plist: $PLIST_PATH"
echo "   Logs:  tail -f \"$LOG_FILE\""
echo "   Make sure Anki Desktop + AnkiConnect (code 2055492159) is installed on this Mac."
