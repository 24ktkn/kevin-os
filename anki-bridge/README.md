# Kevin-OS Windows Anki Sync Bridge

Zero-dependency background daemon that connects **Anki Desktop + AnkiConnect** on your Windows PC to **Kevin-OS** (`https://kevin-os-xr4m.vercel.app`) and **Gemini MCP**.

## One-Time Setup (2 minutes)

1. **Install AnkiConnect in Anki Desktop**:
   - Open Anki Desktop → **Tools → Add-ons → Get Add-ons…**
   - Enter code: **`2055492159`** → OK → restart Anki Desktop.
2. **Run the Supabase SQL migration** (once):
   - Open Supabase SQL Editor and run [`web/supabase_migrations/add_anki_tables.sql`](../web/supabase_migrations/add_anki_tables.sql).
3. **Start the Bridge**:
   - Quick test (single sync): `node sync.mjs --once`
   - Run now in terminal: double-click `start-bridge.bat`
   - Auto-start silently on Windows login: right-click `install-startup-task.ps1` → **Run with PowerShell** (or run `powershell -ExecutionPolicy Bypass -File .\install-startup-task.ps1`).

## How It Works
- Automatically reads auth from `../web/.env.local` (no extra tokens to paste).
- Polls Kevin-OS every **20 seconds** for queued cloud actions (new cards, unsuspends, suspends, reviews) and executes them via official AnkiConnect + triggers official **AnkiWeb Sync** so iPhone AnkiMobile stays in sync.
- Pushes live stats + full 3,000–5,000 card search index every **3 minutes** and automatically checks off your daily **Anki** habit when today's Review + Learning due count reaches `0`.
