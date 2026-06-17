import os
import sys
import logging
from datetime import datetime, timedelta, timezone
from google.oauth2 import service_account
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

# Use built-in tomllib (Python 3.11+) to read Streamlit secrets natively
try:
    import tomllib
except ImportError:
    import toml as tomllib

# --- CONFIGURATION & SAFETY RAILS ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')
LOOKAHEAD_DAYS = 7
MAX_TASKS_PER_RUN = 7  # Hard-cap to prevent infinite loop spam
CALENDAR_ID = "24ktkn@gmail.com" # Your Kevin Nguyen default calendar
TASKLIST_ID = "@default"

def load_secrets():
    secrets_path = os.path.join(os.path.dirname(__file__), '.streamlit', 'secrets.toml')
    if not os.path.exists(secrets_path):
        logging.error(f"Secrets file not found at {secrets_path}")
        sys.exit(1)
    with open(secrets_path, "rb") as f:
        return tomllib.load(f)

def get_services(secrets):
    # Authenticate Calendar
    cal_creds_info = secrets["connections"]["gsheets"]
    cal_creds = service_account.Credentials.from_service_account_info(
        cal_creds_info, scopes=['https://www.googleapis.com/auth/calendar']
    )
    calendar_service = build('calendar', 'v3', credentials=cal_creds)

    # Authenticate Tasks
    tasks_creds_info = secrets["tasks_api"]
    tasks_creds = Credentials(
        token=None,
        refresh_token=tasks_creds_info["refresh_token"],
        token_uri="https://oauth2.googleapis.com/token",
        client_id=tasks_creds_info["client_id"],
        client_secret=tasks_creds_info["client_secret"]
    )
    tasks_service = build('tasks', 'v1', credentials=tasks_creds)
    
    return calendar_service, tasks_service

def run_bot():
    logging.info("🤖 Booting Master Repeater Bot...")
    secrets = load_secrets()
    cal_service, tasks_service = get_services(secrets)

    now = datetime.now(timezone.utc)
    time_min = now.isoformat()
    time_max = (now + timedelta(days=LOOKAHEAD_DAYS)).isoformat()

    # 1. EXPAND CALENDAR EVENTS
    logging.info(f"Scanning calendar for repeating events between {now.date()} and {(now + timedelta(days=LOOKAHEAD_DAYS)).date()}...")
    events_result = cal_service.events().list(
        calendarId=CALENDAR_ID, timeMin=time_min, timeMax=time_max,
        singleEvents=True, orderBy='startTime'
    ).execute()
    
    # Target our repeating Gym blocks
    gym_events = [e for e in events_result.get('items', []) if "gym" in e.get('summary', '').lower() or "workout" in e.get('summary', '').lower()]
    
    if not gym_events:
        logging.info("No upcoming gym blocks detected. Shutting down.")
        return

    # 2. AUDIT EXISTING TASKS (To prevent duplication)
    tasks_result = tasks_service.tasks().list(tasklist=TASKLIST_ID, showCompleted=False).execute()
    existing_task_dates = set()
    
    for task in tasks_result.get('items', []):
        if "gym" in task.get('title', '').lower() or "workout" in task.get('title', '').lower():
            if task.get('due'):
                existing_task_dates.add(task['due'].split('T')[0])

    # 3. SPAWN MISSING TASKS
    tasks_created = 0
    for event in gym_events:
        if tasks_created >= MAX_TASKS_PER_RUN:
            logging.warning("Hit safety cap of 7 tasks. Halting to prevent over-generation.")
            break
            
        start_time_raw = event['start'].get('dateTime') or event['start'].get('date')
        event_date = start_time_raw.split('T')[0]
        
        if event_date not in existing_task_dates:
            logging.info(f"Missing task detected for {event_date}. Generating...")
            task_payload = {
                "title": f"☑️ {event.get('summary', 'Gym Session')}",
                "notes": "Automated synchronization via Repeater Bot.",
                "due": f"{event_date}T00:00:00.000Z"
            }
            tasks_service.tasks().insert(tasklist=TASKLIST_ID, body=task_payload).execute()
            tasks_created += 1
            existing_task_dates.add(event_date) # Add to set to prevent double-firing in loop

    logging.info(f"✅ Sync complete. Successfully spawned {tasks_created} new tasks.")

if __name__ == "__main__":
    run_bot()