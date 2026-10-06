import sys
import os
import re
import subprocess
import toml
from google_auth_oauthlib.flow import InstalledAppFlow

# 1. Load existing client details from secrets.toml
try:
    secrets = toml.load("c:/Users/Kevin/Desktop/kevin-os/.streamlit/secrets.toml")
    creds_info = secrets["tasks_api"]
except Exception as e:
    print(f"Error loading secrets.toml: {e}", flush=True)
    sys.exit(1)

client_id = creds_info["client_id"].strip('"\' ')
client_secret = creds_info["client_secret"].strip('"\' ')

# 2. Configure flow
client_config = {
    "installed": {
        "client_id": client_id,
        "client_secret": client_secret,
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
    }
}

scopes = ["https://www.googleapis.com/auth/tasks"]

print("Starting Google Authentication flow...", flush=True)
print("A browser window will open automatically. If not, copy and paste the authorization URL.", flush=True)
print("1. Sign in with your Google account (24ktkn@gmail.com)", flush=True)
print("2. Click 'Advanced' -> 'Go to Kevin OS (unsafe)'", flush=True)
print("3. Click 'Continue' / 'Allow' to grant Tasks access.", flush=True)
print("-" * 60, flush=True)

try:
    flow = InstalledAppFlow.from_client_config(client_config, scopes=scopes)
    credentials = flow.run_local_server(port=64164, prompt='consent')
    
    new_refresh_token = credentials.refresh_token
    print("-" * 60, flush=True)
    print("SUCCESSFULLY AUTHENTICATED!", flush=True)
    print(f"New refresh token acquired: {new_refresh_token[:15]}...{new_refresh_token[-10:]}", flush=True)
    print("-" * 60, flush=True)
    
    # 3. Update .streamlit/secrets.toml
    secrets["tasks_api"]["client_id"] = client_id
    secrets["tasks_api"]["client_secret"] = client_secret
    secrets["tasks_api"]["refresh_token"] = new_refresh_token
    with open("c:/Users/Kevin/Desktop/kevin-os/.streamlit/secrets.toml", "w") as f:
        toml.dump(secrets, f)
    print("✓ Updated .streamlit/secrets.toml", flush=True)

    # 4. Update web/.env.local
    env_path = "c:/Users/Kevin/Desktop/kevin-os/web/.env.local"
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            env_content = f.read()

        env_content = re.sub(r'GOOGLE_TASKS_CLIENT_ID=.*', f'GOOGLE_TASKS_CLIENT_ID={client_id}', env_content)
        env_content = re.sub(r'GOOGLE_TASKS_CLIENT_SECRET=.*', f'GOOGLE_TASKS_CLIENT_SECRET={client_secret}', env_content)
        env_content = re.sub(r'GOOGLE_TASKS_REFRESH_TOKEN=.*', f'GOOGLE_TASKS_REFRESH_TOKEN={new_refresh_token}', env_content)

        with open(env_path, "w", encoding="utf-8") as f:
            f.write(env_content)
        print("✓ Updated web/.env.local with fresh credentials!", flush=True)

    # 5. Run backfill script to immediately create Google Tasks for the 5 scheduled modules
    print("\nRunning backfill to create Google Tasks for the 5 scheduled modules...", flush=True)
    subprocess.run(["node", "web/scripts/backfill_scheduled_tasks.js"], check=False)
    print("✓ Backfill finished!", flush=True)

except Exception as e:
    print(f"\nError running OAuth flow: {e}", flush=True)
    sys.exit(1)
