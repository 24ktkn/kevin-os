import streamlit as st
import pandas as pd
import datetime
from streamlit_gsheets import GSheetsConnection
from google.oauth2 import service_account
from googleapiclient.discovery import build
import streamlit.components.v1 as components

st.set_page_config(page_title="Mission Control", layout="wide")
st.title("🚀 Mission Control")

# --- CALENDAR API SETUP ---
# Map your dropdown categories to the actual Google Calendar IDs
CALENDAR_MAP = {
    "Kevin Nguyen": "24ktkn@gmail.com",
    "Family": "family05668227215423587251@group.calendar.google.com",
    "School": "0dbc1f40c9dc993c6b893fa0e1646b888eb8ed8599668c9697d72689e041e315@group.calendar.google.com",
    "Volunteering": "57bb8a8bf61e233e8bb76ab03f53b03ead35e7ba66e37d2bfd73792e1c1e575e@group.calendar.google.com"
}

# Authenticate the Calendar API
def get_calendar_service():
    creds_info = st.secrets["connections"]["gsheets"]
    creds = service_account.Credentials.from_service_account_info(
        creds_info,
        scopes=['https://www.googleapis.com/auth/calendar']
    )
    return build('calendar', 'v3', credentials=creds)

cal_service = get_calendar_service()
def sync_calendars_to_sheet(df, service, connection):
    st.toast("🔄 Scanning Google Calendars for updates...")
    
    # Define a time window to scan (e.g., from 7 days ago to 30 days ahead)
    now = datetime.datetime.utcnow()
    time_min = (now - datetime.timedelta(days=7)).isoformat() + 'Z'
    time_max = (now + datetime.timedelta(days=30)).isoformat() + 'Z'
    
    sheet_updated = False
    
    # --- IRONCLAD TYPE SHIELD ---
    text_columns = ["Item Name", "Type", "Calendar", "Date", "Time", "Notes", "Event ID"]
    for col in text_columns:
        if col not in df.columns:
            df[col] = ""
        df[col] = df[col].fillna("").astype(str)
        df[col] = df[col].replace({"nan": "", "None": "", "NaN": ""})

    if "Duration (Mins)" not in df.columns:
        df["Duration (Mins)"] = 0
    df["Duration (Mins)"] = pd.to_numeric(df["Duration (Mins)"], errors='coerce').fillna(0).astype(int)

    for col in ["Status", "Scheduled?"]:
        if col not in df.columns:
            df[col] = False
        df[col] = df[col].fillna(False).astype(bool)
    # ----------------------------

    for cal_name, cal_id in CALENDAR_MAP.items():
        try:
            # 1. NEW: Added `showDeleted=True` to catch events you wiped from your phone
            events_result = service.events().list(
                calendarId=cal_id, 
                timeMin=time_min, 
                timeMax=time_max,
                singleEvents=True, 
                showDeleted=True, 
                orderBy='startTime'
            ).execute()
            
            events = events_result.get('items', [])
            
            for event in events:
                gcal_id = event.get('id')
                status = event.get('status')
                
                # 2. NEW: DELETION LOGIC
                if status == 'cancelled':
                    # If Google says it's deleted, check if we still have it in our sheet
                    if gcal_id in df["Event ID"].values:
                        # Slice the dataframe to remove this exact row and reset the index
                        df = df[df["Event ID"] != gcal_id].reset_index(drop=True)
                        sheet_updated = True
                    # Skip the rest of the loop for this deleted event
                    continue 
                # ---------------------------
                
                summary = event.get('summary', 'Untitled Event')
                description = event.get('description', '')
                
                start_info = event.get('start', {})
                end_info = event.get('end', {})
                
                if 'dateTime' not in start_info:
                    continue
                    
                start_raw = start_info.get('dateTime')
                end_raw = end_info.get('dateTime')
                
                start_dt = datetime.datetime.fromisoformat(start_raw[:19])
                end_dt = datetime.datetime.fromisoformat(end_raw[:19])
                
                duration_mins = int((end_dt - start_dt).total_seconds() / 60)
                
                date_str = start_dt.strftime('%Y-%m-%d')
                time_str = start_dt.strftime('%H:%M:%S')

                matching_rows = df[df["Event ID"] == gcal_id]
                
                if not matching_rows.empty:
                    idx = matching_rows.index[0]
                    
                    try:
                        current_duration = int(df.at[idx, "Duration (Mins)"])
                    except (ValueError, TypeError):
                        current_duration = 0
                    
                    if (df.at[idx, "Item Name"] != summary or 
                        str(df.at[idx, "Date"]) != date_str or 
                        current_duration != duration_mins):
                        
                        df.at[idx, "Item Name"] = summary
                        df.at[idx, "Date"] = date_str
                        df.at[idx, "Time"] = time_str
                        df.at[idx, "Duration (Mins)"] = int(duration_mins)
                        df.at[idx, "Notes"] = description
                        sheet_updated = True
                else:
                    new_row = {
                        "Status": False,
                        "Item Name": summary,
                        "Type": "Event",
                        "Calendar": cal_name,
                        "Date": date_str,
                        "Time": time_str,
                        "Duration (Mins)": int(duration_mins),
                        "Scheduled?": True,
                        "Notes": description,
                        "Event ID": gcal_id
                    }
                    df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)
                    sheet_updated = True
                    
        except Exception as e:
            st.error(f"Error reading calendar '{cal_name}': {e}")
            
    if sheet_updated:
        connection.update(data=df, spreadsheet=st.secrets.connections.gsheets.mission_control_sheet)
        st.toast("✅ Master Sheet perfectly synchronized with Google Calendars!")
        return df, True
        
    st.toast("🌟 Already up to date.")
    return df, False

# --- GOOGLE SHEETS SETUP ---
conn = st.connection("gsheets", type=GSheetsConnection)
df = conn.read(spreadsheet=st.secrets.connections.gsheets.mission_control_sheet, ttl=0)

# Ensure checkboxes are boolean
if "Status" in df.columns: df["Status"] = df["Status"].astype(bool)
if "Scheduled?" in df.columns: df["Scheduled?"] = df["Scheduled?"].astype(bool)

tab1, tab2, tab3 = st.tabs(["➕ Add New Item", "📊 Master Sheet View", "📅 Calendar View"])

with tab1:
    st.header("Log a Task or Event")
    with st.form("ingestion_form", clear_on_submit=True):
        col1, col2 = st.columns(2)
        with col1:
            item_name = st.text_input("Item Name", placeholder="e.g., Study Pathology")
            item_type = st.selectbox("Type", ["Task", "Event"])
            calendar_cat = st.selectbox("Calendar", ["Kevin Nguyen", "Family", "School", "Volunteering"])
        with col2:
            target_date = st.date_input("Date", datetime.date.today())
            start_time = st.time_input("Start Time", datetime.time(0, 0))
            duration = st.number_input("Duration (Mins)", min_value=15, max_value=480, value=60, step=15)
        
        notes = st.text_area("Notes", placeholder="Add links or modules here...")
        
        if st.form_submit_button("Push to Master Tracker") and item_name:
            target_cal_id = CALENDAR_MAP.get(calendar_cat)
            
            # Combine Date and Time for the API
            start_dt = f"{target_date}T{start_time.strftime('%H:%M:%S')}-04:00"
            end_dt_obj = datetime.datetime.combine(target_date, start_time) + datetime.timedelta(minutes=int(duration))
            end_dt = f"{end_dt_obj.strftime('%Y-%m-%dT%H:%M:%S')}-04:00"

            event_body = {
                'summary': item_name,
                'description': notes,
                'start': {'dateTime': start_dt, 'timeZone': 'America/Toronto'},
                'end': {'dateTime': end_dt, 'timeZone': 'America/Toronto'},
            }

            try:
                # Push to Google Calendar
                created_event = cal_service.events().insert(calendarId=target_cal_id, body=event_body).execute()
                new_event_id = created_event.get('id')
                
                # Push to Google Sheet
                new_row = {
                    "Status": False, "Item Name": item_name, "Type": item_type, 
                    "Calendar": calendar_cat, "Date": str(target_date), 
                    "Time": str(start_time), "Duration (Mins)": int(duration), 
                    "Scheduled?": True, "Notes": notes, "Event ID": new_event_id
                }
                
                updated_df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)
                conn.update(data=updated_df, spreadsheet=st.secrets.connections.gsheets.mission_control_sheet)
                
                st.success(f"✅ '{item_name}' added to Sheet AND Calendar!")
                st.rerun()

            except Exception as e:
                st.error(f"Failed to sync with Calendar: {e}")

with tab2:
    st.header("Master Task Tracker")
    
    # Add a manual trigger button at the top of the ledger view
    if st.button("🔄 Sync Calendar Changes to Sheet"):
        df, was_updated = sync_calendars_to_sheet(df, cal_service, conn)
        if was_updated:
            st.rerun()
            
    # 1. Added "Upcoming Focus" as the primary tab, shifted "All" to the second slot
    categories = ["Upcoming Focus", "All History", "All Events", "All Tasks", "Kevin Nguyen", "Family", "School", "Volunteering"]
    task_tabs = st.tabs(categories)
    
    # 2. Calculate the exact time windows for your 4-week filter
    today = pd.to_datetime(datetime.date.today())
    four_weeks_out = today + pd.Timedelta(weeks=4)
    
    # Safely parse the Date column into a format Pandas can do math on
    safe_dates = pd.to_datetime(df["Date"], errors='coerce')
    
    for i, category in enumerate(categories):
        with task_tabs[i]:
            # 3. Advanced filtering logic based on selection
            if category == "Upcoming Focus":
                # Filter: Status is False AND Date is between today and 4 weeks from now
                upcoming_mask = (~df["Status"]) & (safe_dates >= today) & (safe_dates <= four_weeks_out)
                display_df = df[upcoming_mask].copy()
            elif category == "All History":
                display_df = df.copy()
            elif category == "All Events":
                display_df = df[df["Type"] == "Event"].copy()
            elif category == "All Tasks":
                display_df = df[df["Type"] == "Task"].copy()
            else:
                display_df = df[df["Calendar"] == category].copy()
            
            st.write(f"### {category}")
            
            edited_df = st.data_editor(
                display_df, 
                use_container_width=True, 
                hide_index=True,
                key=f"editor_{category.lower().replace(' ', '_')}", 
                column_config={
                    "Calendar": st.column_config.SelectboxColumn(
                        "Calendar",
                        options=["Kevin Nguyen", "Family", "School", "Volunteering"],
                        required=True,
                    ),
                    "Status": st.column_config.CheckboxColumn(
                        "Status",
                        help="Check to mark as complete",
                        default=False,
                    )
                }
            )
            
            if st.button(f"💾 Save {category} Changes", key=f"btn_{category.lower().replace(' ', '_')}"):
                df.update(edited_df)
                conn.update(
                    data=df, 
                    spreadsheet=st.secrets.connections.gsheets.mission_control_sheet
                )
                st.success(f"Updated {category} list!")
                st.rerun()

with tab3:
    st.header("Consolidated Calendar View")
    # Paste your combined embed code here
    calendar_iframe = """
    <iframe src="https://calendar.google.com/calendar/embed?height=600&wkst=1&ctz=America%2FToronto&showPrint=0&src=MjRrdGtuQGdtYWlsLmNvbQ&src=MGRiYzFmNDBjOWRjOTkzYzZiODkzZmEwZTE2NDZiODg4ZWI4ZWQ4NTk5NjY4Yzk2OTdkNzI2ODllMDQxZTMxNUBncm91cC5jYWxlbmRhci5nb29nbGUuY29t&src=NTdiYjhhOGJmNjFlMjMzZThiYjc2YWIwM2Y1M2IwM2VhZDM1ZTdiYTY2ZTM3ZDJiZmQ3Mzc5MmUxYzFlNTc1ZUBncm91cC5jYWxlbmRhci5nb29nbGUuY29t&src=ZmFtaWx5MDU2NjgyMjcyMTU0MjM1ODcyNTFAZ3JvdXAuY2FsZW5kYXIuZ29vZ2xlLmNvbQ&src=ZW4uY2FuYWRpYW4jaG9saWRheUBncm91cC52LmNhbGVuZGFyLmdvb2dsZS5jb20&src=YjN0ZXZkdWlvaHN1ZDVxNHJwaGlycDVpNmR1dWh1aTdAaW1wb3J0LmNhbGVuZGFyLmdvb2dsZS5jb20&color=%23039be5&color=%237986cb&color=%23a79b8e&color=%23d50000&color=%230b8043&color=%233f51b5" style="border:solid 1px #777" width="800" height="600" frameborder="0" scrolling="no"></iframe>" 
    style="border: 0" width="100%" height="600" frameborder="0" scrolling="no"></iframe>
    """
    components.html(calendar_iframe, height=600)