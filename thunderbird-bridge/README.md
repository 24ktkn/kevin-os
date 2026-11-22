# Kevin-OS Thunderbird Email Bridge (`@uwo.ca` + Any Account)

Silent Thunderbird MailExtension that mirrors your Thunderbird accounts (such as Western/Schulich `@uwo.ca` via Microsoft OAuth2 + MFA) into **Kevin-OS Email Hub** and **Gemini MCP** — letting Gemini read, search, draft, sort/archive/move, move to Trash, and send while you keep using **Spark Free** on iPhone & Windows.

## One-Time Install (Windows or macOS)

1. Install free [Mozilla Thunderbird](https://www.thunderbird.net/) and sign in to your `@uwo.ca` account (uses Microsoft OAuth2 + MFA automatically).
2. In Thunderbird: **Settings → General → Config Editor…** → search `xpinstall.signatures.required` → toggle to **`false`**.
3. Open **Add-ons and Themes** (`Ctrl+Shift+A` on Windows, `Cmd+Shift+A` on Mac) → click the Gear icon → **Install Add-on From File…** → select `kevin-os-thunderbird-bridge.xpi` (also downloadable from `https://kevin-os-xr4m.vercel.app/email`).
4. Click the **Kevin-OS Email Bridge** button in Thunderbird's toolbar:
   - Paste your **Kevin-OS Bridge Token** (from `/email` → Accounts & Setup; same token as your Anki Bridge).
   - Set **Account Filter** to `uwo.ca` (recommended so Gmail & Hotmail stay 24/7 cloud-only while `@uwo.ca` syncs through Thunderbird).
   - Click **Save & Sync Now**.

## Rebuilding the `.xpi` After Edits

```bash
node thunderbird-bridge/build-xpi.mjs
```

This rebuilds both `thunderbird-bridge/kevin-os-thunderbird-bridge.xpi` and `web/public/downloads/kevin-os-thunderbird-bridge.xpi`.
