import sys
import toml
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

sys.stdout.reconfigure(encoding='utf-8')

# Load secrets
secrets = toml.load("c:/Users/Kevin/Desktop/kevin-os/.streamlit/secrets.toml")
creds_info = secrets["tasks_api"]

# Build credentials
creds = Credentials(
    token=None,
    refresh_token=creds_info["refresh_token"],
    token_uri="https://oauth2.googleapis.com/token",
    client_id=creds_info["client_id"],
    client_secret=creds_info["client_secret"]
)

service = build('tasks', 'v1', credentials=creds)

TASKLIST_MAP = {
    "Kevin Nguyen": "@default", 
    "Family": "Um85a3gwMVZqTXN4X0M3Wg",        
    "School": "ZGRiT21qM2ZCbVRWOVBlMQ",        
    "Volunteering": "bUtfd3ZxU0Y3RFUyM2x2dQ"   
}

for name, tl_id in TASKLIST_MAP.items():
    print(f"\n================ Tasklist: {name} ({tl_id}) ================")
    try:
        results = service.tasks().list(tasklist=tl_id, showCompleted=True, showHidden=True).execute()
        items = results.get('items', [])
        if not items:
            print("No tasks found.")
            continue
        for item in items:
            print(f"ID: {item.get('id')}")
            print(f"Title: {item.get('title')}")
            print(f"Status: {item.get('status')}")
            print(f"Due: {item.get('due')}")
            print(f"Completed: {item.get('completed')}")
            print(f"Deleted: {item.get('deleted')}")
            print("-" * 30)
    except Exception as e:
        print(f"Error listing tasks for {name}: {e}")
