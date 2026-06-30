import sys
import toml
import pandas as pd
from google.oauth2.service_account import Credentials
import gspread

sys.stdout.reconfigure(encoding='utf-8')

# Load credentials
secrets = toml.load("c:/Users/Kevin/Desktop/kevin-os/.streamlit/secrets.toml")
creds_info = secrets["connections"]["gsheets"]

scope = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
]

creds = Credentials.from_service_account_info(creds_info, scopes=scope)
client = gspread.authorize(creds)

sheet_url = secrets["connections"]["gsheets"]["workout_tracker_sheet"]
doc = client.open_by_url(sheet_url)
worksheet = doc.worksheet("workout_logs")

data = worksheet.get_all_values()
df = pd.DataFrame(data[1:], columns=data[0])

non_empty_dur = df[df["Duration (Mins)"].str.strip() != ""]
print("Non-empty duration rows count:", len(non_empty_dur))
if len(non_empty_dur) > 0:
    print(non_empty_dur[["Date", "Split Day", "Exercise", "Duration (Mins)"]].head(10).to_string())

# Check for treadmill or cardio
cardio_rows = df[df["Exercise"].str.contains("Treadmill|Cardio|Run|Walk", case=False, na=False)]
print("\nCardio rows count:", len(cardio_rows))
if len(cardio_rows) > 0:
    print(cardio_rows[["Date", "Split Day", "Exercise", "Duration (Mins)"]].head(10).to_string())
