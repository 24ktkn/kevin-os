import os
import json
import gspread
from google.oauth2.service_account import Credentials

def main():
    # Load secrets
    secrets_path = ".streamlit/secrets.toml"
    if not os.path.exists(secrets_path):
        print("secrets.toml not found")
        return
        
    import toml
    secrets = toml.load(secrets_path)
    
    gsheets_secrets = secrets["connections"]["gsheets"]
    
    # Structure service account credentials
    info = {
        "type": gsheets_secrets["type"],
        "project_id": gsheets_secrets["project_id"],
        "private_key_id": gsheets_secrets["private_key_id"],
        "private_key": gsheets_secrets["private_key"].replace("\\n", "\n"),
        "client_email": gsheets_secrets["client_email"],
        "client_id": gsheets_secrets["client_id"],
        "auth_uri": gsheets_secrets["auth_uri"],
        "token_uri": gsheets_secrets["token_uri"],
        "auth_provider_x509_cert_url": gsheets_secrets["auth_provider_x509_cert_url"],
        "client_x509_cert_url": gsheets_secrets["client_x509_cert_url"]
    }
    
    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive"
    ]
    
    try:
        credentials = Credentials.from_service_account_info(info, scopes=scopes)
        client = gspread.authorize(credentials)
        print("Gspread authorized successfully.")
        
        sheet_url = secrets["connections"]["gsheets"]["mission_control_sheet"]
        print(f"Attempting to open sheet by URL: {sheet_url}")
        
        # We can extract the key
        sheet_key = "1qk4gIOjv6iIvAJH_VCQWa2npgME9-saesUNVyPbuPmA"
        spreadsheet = client.open_by_key(sheet_key)
        print(f"Spreadsheet opened successfully: {spreadsheet.title}")
        
        # List worksheets
        worksheets = spreadsheet.worksheets()
        print("Worksheets:")
        for w in worksheets:
            print(f"- {w.title}")
            
    except gspread.exceptions.APIError as e:
        print("\n--- Gspread API Error ---")
        print(f"Status code: {e.response.status_code}")
        print(f"Response text: {e.response.text}")
    except Exception as e:
        print(f"\nOther error: {type(e).__name__}: {e}")

if __name__ == "__main__":
    main()
