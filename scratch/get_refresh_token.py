import sys
import toml
from google_auth_oauthlib.flow import InstalledAppFlow

# 1. Load existing client details from secrets.toml
try:
    secrets = toml.load("c:/Users/Kevin/Desktop/kevin-os/.streamlit/secrets.toml")
    creds_info = secrets["tasks_api"]
except Exception as e:
    print(f"Error loading secrets.toml: {e}")
    sys.exit(1)

# 2. Configure flow
client_config = {
    "installed": {
        "client_id": creds_info["client_id"],
        "client_secret": creds_info["client_secret"],
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
    }
}

# We need the tasks scope
scopes = ["https://www.googleapis.com/auth/tasks"]

print("Starting Google Authentication flow...")
print("A browser window should open. If it warns that 'Google hasn't verified this app',")
print("click 'Advanced' -> 'Go to [your app name] (unsafe)' to proceed.")
print("-" * 60)

try:
    flow = InstalledAppFlow.from_client_config(client_config, scopes=scopes)
    # Run local server to catch redirect and code on port 64164 (as configured in GCP)
    credentials = flow.run_local_server(port=64164)
    
    new_refresh_token = credentials.refresh_token
    print("-" * 60)
    print("SUCCESSFULLY AUTHENTICATED!")
    print("Your new refresh token is:\n")
    print(new_refresh_token)
    print("\n" + "-" * 60)
    
    # 3. Update secrets.toml
    secrets["tasks_api"]["refresh_token"] = new_refresh_token
    with open("c:/Users/Kevin/Desktop/kevin-os/.streamlit/secrets.toml", "w") as f:
        toml.dump(secrets, f)
        
    print("Successfully updated .streamlit/secrets.toml with your new refresh token!")
    print("Restart your Streamlit app and refresh the browser to sync your tasks.")
except Exception as e:
    print(f"\nError running OAuth flow: {e}")
    print("Make sure you have installed: pip install google-auth-oauthlib")
