import streamlit as st
import pandas as pd
from datetime import datetime
from streamlit_gsheets import GSheetsConnection
from google.oauth2 import service_account
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
import streamlit.components.v1 as components

st.set_page_config(page_title="Mission Control", layout="wide")

# --- INJECTING PREMIUM AGENTIC CSS LAYOUTS ---
st.markdown("""
    <style>
    .main { background-color: #0F0F12; }
    
    /* Global Card Architecture */
    .card-container {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 16px;
        padding: 10px 0px;
    }
    
    .task-card {
        background: #16161D;
        border-radius: 12px;
        padding: 16px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        border: 1px solid #23232F;
        position: relative;
    }
    
    /* Smooth Hover Transitions */
    .task-card:hover {
        transform: translateY(-4px);
        box-shadow: 0 12px 20px rgba(0, 0, 0, 0.3);
        border-color: #3A3A4A;
    }
    
    /* Custom Border Coding Categories */
    .border-kevin-nguyen { border-left: 5px solid #00CC66; }
    .border-family { border-left: 5px solid #3399FF; }
    .border-school { border-left: 5px solid #9933FF; }
    .border-volunteering { border-left: 5px solid #FF9933; }
    
    /* Typography Style Sheet */
    .card-title {
        color: #FFFFFF;
        font-size: 1.1rem;
        font-weight: 700;
        margin-bottom: 8px;
        line-height: 1.3;
    }
    
    .meta-row {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #A0A0AB;
        font-size: 0.85rem;
        margin-top: 4px;
    }
    
    .badge {
        padding: 2px 8px;
        border-radius: 20px;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        background: #272732;
        color: #E4E4E7;
        width: fit-content;
    }
    </style>
    """, unsafe_allow_html=True)

st.title("🚀 Mission Control")

# --- CALENDAR API SETUP ---
CALENDAR_MAP = {
    "Kevin Nguyen": "24ktkn@gmail.com",
    "Family": "family05668227215423587251@group.calendar.google.com",
    "School": "0dbc1f40c9dc993c6b893fa0e1646b888eb8ed8599668c9697d72689e041e315@group.calendar.google.com",
    "Volunteering": "57bb8a8bf61e233e8bb76ab03f53b03ead35e7ba66e37d2bfd73792e1c1e575e@group.calendar.google.com"
}

TASKLIST_MAP = {
    "Kevin Nguyen": "@default", 
    "Family": "Um85a3gwMVZqTXN4X0M3Wg",        
    "School": "ZGRiT21qM2ZCbVRWOVBlMQ",        
    "Volunteering": "bUtfd3ZxU0Y3RFUyM2x2dQ"   
}

def get_calendar_service():
    creds_info = st.secrets["connections"]["gsheets"]
    creds = service_account.Credentials.from_service_account_info(
        creds_info, scopes=['https://www.googleapis.com/auth/calendar']
    )
    return build('calendar', 'v3', credentials=creds)

cal_service = get_calendar_service()

def get_tasks_service():
    creds_info = st.secrets["tasks_api"]
    creds = Credentials(
        token=None,
        refresh_token=creds_info["refresh_token"],
        token_uri="https://oauth2.googleapis.com/token",
        client_id=creds_info["client_id"],
        client_secret=creds_info["client_secret"]
    )
    return build('tasks', 'v1', credentials=creds)

tasks_service = get_tasks_service()

# --- SYNCHRONIZATION ENGINE ---
def sync_all_to_sheet(df, service_cal, service_tasks, connection):
    st.toast("🔄 Scanning Google Calendars and Tasks for updates...")
    now = pd.Timestamp.utcnow()
    time_min = (now - pd.Timedelta(days=7)).isoformat()
    time_max = (now + pd.Timedelta(days=30)).isoformat()
    sheet_updated = False
    
    text_columns = ["Item Name", "Type", "Calendar", "Date", "Time", "Location", "Notes", "Event ID", "Timeblock ID"]
    for col in text_columns:
        if col not in df.columns: df[col] = ""
        df[col] = df[col].fillna("").astype(str).replace({"nan": "", "None": "", "NaN": ""})

    if "Duration (Mins)" not in df.columns: df["Duration (Mins)"] = 0
    df["Duration (Mins)"] = pd.to_numeric(df["Duration (Mins)"], errors='coerce').fillna(0).astype(int)

    for col in ["Status", "Scheduled?"]:
        if col not in df.columns: df[col] = False
        df[col] = df[col].fillna(False).astype(bool)

    for cal_name, cal_id in CALENDAR_MAP.items():
        try:
            events_result = service_cal.events().list(
                calendarId=cal_id, timeMin=time_min, timeMax=time_max,
                singleEvents=True, showDeleted=True, orderBy='startTime'
            ).execute()
            
            events = events_result.get('items', [])
            for event in events:
                gcal_id = event.get('id')
                status = event.get('status')
                
                if status == 'cancelled':
                    if gcal_id in df["Event ID"].values:
                        df = df[df["Event ID"] != gcal_id].reset_index(drop=True)
                        sheet_updated = True
                    elif gcal_id in df["Timeblock ID"].values:
                        df.loc[df["Timeblock ID"] == gcal_id, "Timeblock ID"] = ""
                        sheet_updated = True
                    continue 
                
                summary = event.get('summary', 'Untitled Event')
                description = event.get('description', '')
                location_str = event.get('location', '')
                start_info, end_info = event.get('start', {}), event.get('end', {})
                
                if 'dateTime' in start_info:
                    start_dt = pd.to_datetime(start_info.get('dateTime'))
                    end_dt = pd.to_datetime(end_info.get('dateTime'))
                    duration_mins = int((end_dt - start_dt).total_seconds() / 60)
                    date_str, time_str = start_dt.strftime('%Y-%m-%d'), start_dt.strftime('%H:%M:%S')
                elif 'date' in start_info:
                    date_str, time_str, duration_mins = start_info.get('date'), "", 0
                else: continue

                matching_rows = df[(df["Event ID"] == gcal_id) | (df["Timeblock ID"] == gcal_id)]
                if not matching_rows.empty:
                    idx = matching_rows.index[0]
                    current_duration = int(df.at[idx, "Duration (Mins)"]) if pd.notna(df.at[idx, "Duration (Mins)"]) else 0
                    if (df.at[idx, "Date"] != date_str or current_duration != duration_mins or df.at[idx, "Location"] != location_str):
                        df.at[idx, "Date"], df.at[idx, "Time"], df.at[idx, "Duration (Mins)"], df.at[idx, "Location"] = date_str, time_str, int(duration_mins), location_str
                        sheet_updated = True
                else:
                    new_row = {"Status": False, "Item Name": summary, "Type": "Event", "Calendar": cal_name, "Date": date_str, "Time": time_str, "Duration (Mins)": int(duration_mins), "Scheduled?": True, "Location": location_str, "Notes": description, "Event ID": gcal_id, "Timeblock ID": ""}
                    df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)
                    sheet_updated = True
        except Exception as e: st.error(f"Error reading calendar '{cal_name}': {e}")

    processed_tasklists = set()
    for tl_name, tl_id in TASKLIST_MAP.items():
        if tl_id in processed_tasklists: continue
        processed_tasklists.add(tl_id)
        try:
            tasks_result = service_tasks.tasks().list(tasklist=tl_id, showCompleted=True, showHidden=True, showDeleted=True).execute()
            for task in tasks_result.get('items', []):
                g_id = task.get('id')
                g_status = task.get('status') 
                if task.get('deleted', False):
                    if g_id in df["Event ID"].values:
                        df = df[df["Event ID"] != g_id].reset_index(drop=True)
                        sheet_updated = True
                    continue
                    
                matching_rows = df[df["Event ID"] == g_id]
                if not matching_rows.empty:
                    idx = matching_rows.index[0]
                    is_completed = (g_status == 'completed')
                    if is_completed != bool(df.at[idx, "Status"]):
                        df.at[idx, "Status"] = is_completed
                        sheet_updated = True
        except Exception: pass
            
    if sheet_updated:
        connection.update(data=df, spreadsheet=st.secrets.connections.gsheets.mission_control_sheet)
        st.toast("✅ Master Sheet synchronized with Calendars and Tasks!")
        return df, True
    st.toast("🌟 Already up to date.")
    return df, False

# --- AUTO-SWEEP ENGINE ---
def sweep_past_events(dataframe, connection):
    df_temp = dataframe.copy()
    try:
        df_temp["Internal_DateTime"] = pd.to_datetime(df_temp["Date"].astype(str) + " " + df_temp["Time"].astype(str), errors='coerce')
    except KeyError:
        df_temp["Internal_DateTime"] = pd.to_datetime(df_temp["Date"], errors='coerce')

    current_time = pd.Timestamp.now()
    past_events_mask = (df_temp["Internal_DateTime"] < current_time) & (dataframe["Status"] == False)

    if past_events_mask.any():
        num_updated = past_events_mask.sum()
        dataframe.loc[past_events_mask, "Status"] = True
        connection.update(data=dataframe, spreadsheet=st.secrets.connections.gsheets.mission_control_sheet)
        st.cache_data.clear()
        st.success(f"🧹 Auto-Sweep Complete: Marked {num_updated} past events as Completed!")
        st.rerun()
    else:
        st.toast("🧹 Schedule is clean! No past pending events found to sweep.")

# --- GOOGLE SHEETS SETUP ---
conn = st.connection("gsheets", type=GSheetsConnection)
df = conn.read(spreadsheet=st.secrets.connections.gsheets.mission_control_sheet, ttl=0)

required_cols = ["Status", "Scheduled?", "Type", "Date", "Location", "Timeblock ID"]
for col in required_cols:
    if col not in df.columns: df[col] = False if col in ["Status", "Scheduled?"] else ""

df["Status"] = df["Status"].replace({"TRUE": True, "FALSE": False, "True": True, "False": False}).fillna(False).astype(bool)
df["Scheduled?"] = df["Scheduled?"].replace({"TRUE": True, "FALSE": False, "True": True, "False": False}).fillna(False).astype(bool)
df["Type"] = df["Type"].fillna("Event").astype(str)
df["Location"] = df["Location"].fillna("").astype(str)

tab1, tab2, tab3 = st.tabs(["➕ Add New Item", "📊 Master Task Tracker", "📅 Calendar View"])

with tab1:
    st.header("Log a Task or Event")
    with st.form("ingestion_form", clear_on_submit=True):
        col1, col2 = st.columns(2)
        with col1:
            item_name = st.text_input("Item Name", placeholder="e.g., Study Pathology")
            item_type = st.selectbox("Type", ["Task", "Event"])
            calendar_cat = st.selectbox("Calendar", list(CALENDAR_MAP.keys()))
            selected_reminders = st.multiselect("Notifications", options=["At time of event", "10 minutes before", "30 minutes before", "1 hour before", "2 hours before", "1 day before"], default=["30 minutes before"])
        with col2:
            target_date = st.date_input("Date", pd.Timestamp.today().date())
            all_day = st.checkbox("All-day / No specific time")
            start_time = st.time_input("Start Time", pd.Timestamp("00:00:00").time(), disabled=all_day)
            duration = st.number_input("Duration (Mins)", min_value=15, max_value=480, value=60, step=15, disabled=all_day)
            repeat_option = st.selectbox("Repeat", ["None", "Daily", "Weekly", "Monthly", "Every Weekday (Mon-Fri)"])
        
        location_input = st.text_input("Location (Optional)")
        notes = st.text_area("Notes")
        
        if st.form_submit_button("Push to Master Tracker") and item_name:
            target_cal_id = CALENDAR_MAP.get(calendar_cat)
            reminder_map = {"At time of event": 0, "10 minutes before": 10, "30 minutes before": 30, "1 hour before": 60, "2 hours before": 120, "1 day before": 1440}
            reminders_payload = {'useDefault': False, 'overrides': [{'method': 'popup', 'minutes': reminder_map[r]} for r in selected_reminders]} if selected_reminders else {'useDefault': True}
            
            if all_day:
                event_body = {'summary': item_name, 'description': notes, 'location': location_input, 'start': {'date': target_date.strftime('%Y-%m-%d')}, 'end': {'date': (target_date + pd.Timedelta(days=1)).strftime('%Y-%m-%d')}, 'reminders': reminders_payload}
                time_str, duration_val = "", 0
            else:
                start_dt = f"{target_date}T{start_time.strftime('%H:%M:%S')}-04:00"
                end_dt_obj = pd.Timestamp.combine(target_date, start_time) + pd.Timedelta(minutes=int(duration))
                event_body = {'summary': item_name, 'description': notes, 'location': location_input, 'start': {'dateTime': start_dt, 'timeZone': 'America/Toronto'}, 'end': {'dateTime': f"{end_dt_obj.strftime('%Y-%m-%dT%H:%M:%S')}-04:00", 'timeZone': 'America/Toronto'}, 'reminders': reminders_payload}
                time_str, duration_val = str(start_time), int(duration)

            if repeat_option != "None":
                rrule_map = {"Daily": "RRULE:FREQ=DAILY", "Weekly": "RRULE:FREQ=WEEKLY", "Monthly": "RRULE:FREQ=MONTHLY", "Every Weekday (Mon-Fri)": "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"}
                event_body['recurrence'] = [rrule_map[repeat_option]]

            try:
                timeblock_id = ""
                if item_type == "Event":
                    created_item = cal_service.events().insert(calendarId=target_cal_id, body=event_body).execute()
                    new_item_id = created_item.get('id')
                else:
                    target_tasklist_id = TASKLIST_MAP.get(calendar_cat, "@default")
                    if not all_day:
                        timeblock_body = event_body.copy()
                        timeblock_body['summary'] = f"☑️ [Task] {item_name}"
                        try: timeblock_id = cal_service.events().insert(calendarId=target_cal_id, body=timeblock_body).execute().get('id')
                        except Exception: pass
                    task_body = {'title': item_name, 'notes': f"⏰ Scheduled: {start_time.strftime('%I:%M %p')}\n\n{notes}" if not all_day else notes, 'due': f"{target_date}T00:00:00.000Z"}
                    new_item_id = tasks_service.tasks().insert(tasklist=target_tasklist_id, body=task_body).execute().get('id')
                
                new_row = {"Status": False, "Item Name": item_name, "Type": item_type, "Calendar": calendar_cat, "Date": str(target_date), "Time": time_str, "Duration (Mins)": duration_val, "Scheduled?": not all_day, "Location": location_input, "Notes": notes, "Event ID": new_item_id, "Timeblock ID": timeblock_id}
                df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)
                conn.update(data=df, spreadsheet=st.secrets.connections.gsheets.mission_control_sheet)
                st.success(f"✅ Saved to Google Cloud!")
                st.rerun()
            except Exception as e: st.error(f"Failed to sync with Google: {e}")

with tab2:
    st.header("Master Task Tracker")
    
    btn_col1, btn_col2 = st.columns([1, 4])
    with btn_col1:
        if st.button("🔄 Sync Everything to Sheet"):
            df, was_updated = sync_all_to_sheet(df, cal_service, tasks_service, conn)
            if was_updated: st.rerun()
    with btn_col2:
        if st.button("🧹 Auto-Sweep Past Events"):
            sweep_past_events(df, conn)
            
    categories = ["Upcoming", "Upcoming Tasks", "All History", "All Events", "All Tasks"] + list(CALENDAR_MAP.keys())
    task_tabs = st.tabs(categories)
    
    today = pd.to_datetime(pd.Timestamp.today().date())
    four_weeks_out = today + pd.Timedelta(weeks=4)
    safe_dates = pd.to_datetime(df["Date"], errors='coerce')
    
    for i, category in enumerate(categories):
        with task_tabs[i]:
            if category == "Upcoming":
                mask = (~df["Status"]) & (safe_dates >= today) & (safe_dates <= four_weeks_out)
            elif category == "Upcoming Tasks":
                mask = (df["Type"] == "Task") & (~df["Status"]) & ((~df["Scheduled?"]) | ((safe_dates >= today) & (safe_dates <= four_weeks_out)))
            elif category == "All History": mask = pd.Series(True, index=df.index)
            elif category == "All Events": mask = (df["Type"] == "Event")
            elif category == "All Tasks": mask = (df["Type"] == "Task")
            else: mask = (df["Calendar"] == category)
            
            display_df = df[mask].copy().sort_values(by=["Date", "Time"], ascending=[True, True])
            
            if display_df.empty:
                st.info("No items found in this section.")
                continue

            # --- RENDER THE RICH AGENT LAYOUT CARD MATRIX ---
            st.markdown('<div class="card-container">', unsafe_allow_html=True)
            for idx, row in display_df.iterrows():
                # Map classes dynamically based on category
                cat_class = f"border-{row['Calendar'].lower().replace(' ', '-')}"
                status_emoji = "✅" if row["Status"] else "⏳"
                type_emoji = "📅" if row["Type"] == "Event" else "☑️"
                
                # Format visual times beautifully
                # Check if the time cell actually contains a valid string
                if str(row['Time']).strip() not in ["", "None", "nan"]:
                    try:
                        # Let Pandas handle the flexible format parsing automatically
                        time_display = pd.to_datetime(row['Time']).strftime("%I:%M %p")
                    except Exception:
                        # Safe fallback if the data in the sheet is completely corrupted
                        time_display = str(row['Time'])
                else:
                    time_display = "All Day"
                date_display = pd.to_datetime(row['Date']).strftime('%a, %b %d')
                
                card_html = f"""
                <div class="task-card {cat_class}">
                    <div>
                        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                            <span class="badge">{row['Calendar']}</span>
                            <span style="font-size: 0.9rem;">{type_emoji}</span>
                        </div>
                        <div class="card-title" style="margin-top: 8px;">{row['Item Name']}</div>
                        <div class="meta-row">🕒 <b>{date_display}</b> @ {time_display}</div>
                        {f'<div class="meta-row">📍 {row["Location"]}</div>' if row["Location"] else ''}
                        {f'<div class="meta-row" style="font-style: italic; margin-top:8px; border-top: 1px solid #23232F; padding-top:4px;">{row["Notes"]}</div>' if row["Notes"] else ''}
                    </div>
                    <div style="margin-top: 12px; display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-size:0.8rem; color:#A0A0AB;">Status: {status_emoji}</span>
                    </div>
                </div>
                """
                st.markdown(card_html, unsafe_allow_html=True)
                
                # Render interactive structural elements directly underneath the cards natively
                with st.container():
                    col_done, col_del, col_pad = st.columns([1, 1, 4])
                    with col_done:
                        if not row["Status"]:
                            if st.button("Complete", key=f"done_{idx}_{category.lower()}"):
                                df.at[idx, "Status"] = True
                                g_id, item_type, cal_name = str(row.get("Event ID", "")), row.get("Type"), row.get("Calendar")
                                if g_id and g_id not in ["", "None", "nan"] and item_type == "Task":
                                    try: tasks_service.tasks().patch(tasklist=TASKLIST_MAP.get(cal_name, "@default"), task=g_id, body={'status': 'completed'}).execute()
                                    except Exception: pass
                                conn.update(data=df, spreadsheet=st.secrets.connections.gsheets.mission_control_sheet)
                                st.cache_data.clear()
                                st.rerun()
                    with col_del:
                        if st.button("Delete", key=f"del_{idx}_{category.lower()}"):
                            g_id, item_type, cal_name = str(row.get("Event ID", "")), row.get("Type"), row.get("Calendar")
                            if g_id and g_id not in ["", "None", "nan"]:
                                try:
                                    if item_type == "Event": cal_service.events().delete(calendarId=CALENDAR_MAP.get(cal_name), eventId=g_id).execute()
                                    else: tasks_service.tasks().delete(tasklist=TASKLIST_MAP.get(cal_name, "@default"), task=g_id).execute()
                                except Exception: pass
                            df = df.drop(index=idx)
                            conn.update(data=df, spreadsheet=st.secrets.connections.gsheets.mission_control_sheet)
                            st.cache_data.clear()
                            st.rerun()
            st.markdown('</div>', unsafe_allow_html=True)

with tab3:
    st.header("Consolidated Calendar View")
    calendar_iframe = """
    <iframe src="https://calendar.google.com/calendar/embed?height=600&wkst=1&ctz=America%2FToronto&showPrint=0&src=MjRrdGtuQGdtYWlsLmNvbQ&src=MGRiYzFmNDBjOWRjOTkzYzZiODkzZmEwZTE2NDZiODg4ZWI4ZWQ4NTk5NjY4Yzk2OTdkNzI2ODllMDQxZTMxNUBncm91cC5jYWxlbmRhci5nb29nbGUuY29t&src=NTdiYjhhOGJmNjFlMjMzZThiYjc2YWIwM2Y1M2IwM2VhZDM1ZTdiYTY2ZTM3ZDJiZmQ3Mzc5MmUxYzFlNTc1ZUBncm91cC5jYWxlbmRhci5nb29nbGUuY29t&src=ZmFtaWx5MDU2NjgyMjcyMTU0MjM1ODcyNTFAZ3JvdXAuY2FsZW5kYXIuZ29vZ2xlLmNvbQ&src=ZW4uY2FuYWRpYW4jaG9saWRheUBncm91cC52LmNhbGVuZGFyLmdvb2dsZS5jb20&src=YjN0ZXZkdWlvaHN1ZDVxNHJwaGlycDVpNmR1dWh1aTdAaW1wb3J0LmNhbGVuZGFyLmdvb2dsZS5jb20&color=%23039be5&color=%238e24aa&color=%23f6bf26&color=%23d50000&color=%230b8043&color=%233f51b5" style="border:solid 1px #777" width="100%" height="600" frameborder="0" scrolling="no"></iframe>
    """
    components.html(calendar_iframe, height=600)