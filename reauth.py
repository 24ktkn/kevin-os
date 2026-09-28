import os
import toml
from google_auth_oauthlib.flow import InstalledAppFlow

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    secrets_path = os.path.join(base_dir, ".streamlit", "secrets.toml")
    
    if not os.path.exists(secrets_path):
        print("Could not find .streamlit/secrets.toml!")
        return

    # Load secrets
    with open(secrets_path, "r") as f:
        secrets = toml.load(f)

    tasks_api = secrets.get("tasks_api", {})
    client_id = tasks_api.get("client_id")
    client_secret = tasks_api.get("client_secret")

    if not client_id or not client_secret:
        print("Could not find client_id or client_secret in [tasks_api]!")
        return

    # Create the client configuration dictionary that the Google OAuth flow expects
    client_config = {
        "web": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost:8080/"]
        }
    }

    # These are the scopes we need
    SCOPES = [
        "https://www.googleapis.com/auth/tasks",
        "https://www.googleapis.com/auth/photoslibrary.readonly"
    ]

    print("Opening browser for authentication...")
    print("MAKE SURE YOU HAVE ENABLED 'Photos Library API' IN GOOGLE CLOUD CONSOLE FIRST!")
    
    flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
    # We must set prompt='consent' and access_type='offline' to force it to return a new refresh token
    creds = flow.run_local_server(port=8080, prompt='consent', access_type='offline')

    print("\n" + "="*50)
    print("SUCCESS! AUTHENTICATION COMPLETE.")
    print("="*50)
    if creds.refresh_token:
        print("\nHere is your new refresh token:")
        print(f"\n{creds.refresh_token}\n")
        
        # 1. Update secrets.toml
        secrets["tasks_api"]["refresh_token"] = creds.refresh_token
        with open(secrets_path, "w") as f:
            toml.dump(secrets, f)
        print("✓ Automatically updated .streamlit/secrets.toml")

        # 2. Update web/.env.local
        web_env_path = os.path.join(base_dir, "web", ".env.local")
        if os.path.exists(web_env_path):
            with open(web_env_path, "r", encoding="utf-8") as f:
                env_content = f.read()
            import re
            env_content = re.sub(
                r'GOOGLE_TASKS_REFRESH_TOKEN="?[^"\n\r]*"?',
                f'GOOGLE_TASKS_REFRESH_TOKEN="{creds.refresh_token}"',
                env_content
            )
            with open(web_env_path, "w", encoding="utf-8") as f:
                f.write(env_content)
            print("✓ Automatically updated web/.env.local")
            
        print("="*50)
        print("All configurations updated successfully!")
    else:
        print("\nERROR: No refresh token was returned! Please ensure you clicked 'Continue' and 'Allow'.")
    print("="*50)

if __name__ == "__main__":
    main()
