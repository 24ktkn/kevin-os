# Kevin-OS Cross-Platform Anki Sync Bridge (Windows + macOS)

Zero-dependency background daemon that connects **Anki Desktop + AnkiConnect** on your Windows PC and/or MacBook to **Kevin-OS** (`https://kevin-os-xr4m.vercel.app`) and **Gemini MCP**.

Safe to run on **both Windows and MacBook** simultaneously — Kevin-OS uses an atomic cloud claim lock (`pending -> processing`) so whichever computer is awake cleanly executes each queued action once without duplicates.

## Windows Setup
1. Open Anki Desktop → **Tools → Add-ons → Get Add-ons…** → enter **`2055492159`** (AnkiConnect) → restart Anki.
2. Run `powershell -ExecutionPolicy Bypass -File .\anki-bridge\install-startup-task.ps1` (runs invisibly on every Windows login via `run-silent.vbs`).

## MacBook Setup (macOS LaunchAgent — 2 Minutes)
1. Install **Anki Desktop** + **AnkiConnect (`2055492159`)** on your MacBook (signed into the same AnkiWeb account) and ensure Node.js is installed (`node -v`).
2. Clone `kevin-os` on your MacBook (or copy the `anki-bridge` folder):
   ```bash
   git clone https://github.com/24ktkn/kevin-os.git ~/kevin-os
   cd ~/kevin-os/anki-bridge
   bash install-mac-bridge.sh
   ```
3. When prompted, paste your **Bridge Token** (you can grab it anytime from your Windows PC by running `node -e "import('./anki-bridge/sync.mjs')"` or copying `SUPABASE_SERVICE_ROLE_KEY` into `anki-bridge/.env`).
4. The script creates `~/Library/LaunchAgents/com.kevinos.ankibridge.plist` and starts it immediately — running invisibly every time you log into your MacBook!
   - View live logs: `tail -f ~/kevin-os/anki-bridge/bridge.log`
   - Uninstall anytime: `bash ~/kevin-os/anki-bridge/uninstall-mac-bridge.sh`
