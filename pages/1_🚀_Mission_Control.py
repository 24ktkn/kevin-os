import streamlit as st
import pandas as pd
from datetime import datetime
from streamlit_gsheets import GSheetsConnection
from google.oauth2 import service_account
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
import streamlit.components.v1 as components

st.set_page_config(page_title="Mission Control", layout="wide")

# --- INJECTING COMPRESSED DATA-DENSE CSS ---
st.markdown("""
    <style>
    .main { background-color: #0F0F12; }
    
    /* Ultra-Dense Fluid Grid System */
    .card-container {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 8px;
        padding: 2px 0px;
    }
    
    .task-card {
        background: #16161D;
        border-radius: 6px;
        padding: 8px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        border: 1px solid #23232F;
        margin-bottom: 0px !important;
    }
    
    .task-card:hover {
        border-color: #3A3A4A;
    }
    
    /* Low-Profile Category Side Borders */
    .border-kevin-nguyen { border-left: 3.5px solid #00CC66; }
    .border-family { border-left: 3.5px solid #3399FF; }
    .border-school { border-left: 4px solid #9933FF; }
    .border-volunteering { border-left: 3.5px solid #FF9933; }
    
    .card-title {
        color: #FFFFFF;
        font-size: 0.88rem;
        font-weight: 700;
        margin-top: 2px;
        margin-bottom: 2px;
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    
    .meta-row {
        display: flex;
        align-items: center;
        gap: 4px;
        color: #A0A0AB;
        font-size: 0.72rem;
        margin-top: 1px;
        line-height: 1.1;
    }
    
    .badge {
        padding: 1px 4px;
        border-radius: 3px;
        font-size: 0.62rem;
        font-weight: 700;
        text-transform: uppercase;
        background: #272732;
        color: #E4E4E7;
        width: fit-content;
    }
    
    /* Hard-Compacting Streamlit Native Form Elements & Buttons */
    div.stButton > button, div.stPopover > button, div.stPopover [data-testid="stPopoverTarget"] > button {
        padding: 2px 6px !important;
        font-size: 0.72rem !important;
        min-height: 24px !important;
        height: 24px !important;
        background-color: #1E1E24 !important;
        border: 1px solid #2D2D3D !important;
        border-radius: 4px !important;
        margin-top: -6px !important;
    }
    
    [data-testid="element-container"] {
        margin-bottom: 0px !important;
        padding-bottom: 0px !important;
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
                else:
                    is_completed = (g_status == 'completed')
                    task_title = task.get('title', 'Untitled Task')
                    due_raw = task.get('due', '')
                    task_date_str = due_raw.split('T')[0] if due_raw else pd.Timestamp.today().strftime('%Y-%m-%d')
                    
                    new_task_row = {
                        "Status": is_completed, "Item Name": task_title, "Type": "Task", "Calendar": tl_name,
                        "Date": task_date_str, "Time": "", "Duration (Mins)": 0, "Scheduled?": False,
                        "Location": "", "Notes": task.get('notes', ''), "Event ID": g_id, "Timeblock ID": ""
                    }
                    df = pd.concat([df, pd.DataFrame([new_task_row])], ignore_index=True)
                    sheet_updated = True
        except Exception: pass
            
    if sheet_updated:
        connection.update(data=df, spreadsheet=st.secrets.connections.gsheets.mission_control_sheet)
        st.toast("✅ Master Sheet synchronized with Calendars and Tasks!")
        return df, True
    st.toast("🌟 Already up to date.")
    return df, False

# --- CONFIGURATION AUTO-SWEEP & SELECTIVE ROLLOVER ENGINE ---
def sweep_past_events(dataframe, connection, service_tasks):
    df_temp = dataframe.copy()
    try:
        df_temp["Internal_DateTime"] = pd.to_datetime(df_temp["Date"].astype(str) + " " + df_temp["Time"].astype(str), errors='coerce')
    except KeyError:
        df_temp["Internal_DateTime"] = pd.to_datetime(df_temp["Date"], errors='coerce')

    current_time = pd.Timestamp.now()
    today_str = current_time.strftime('%Y-%m-%d')
    sheet_updated = False
    completed_count = 0
    rolled_count = 0

    for idx, row in dataframe.iterrows():
        if row["Status"] == True:
            continue
            
        # Only pure timed EVENTS automark as complete. Timed tasks are safely bypassed.
        if row["Scheduled?"] == True and row["Type"] == "Event" and pd.notna(df_temp.at[idx, "Internal_DateTime"]) and df_temp.at[idx, "Internal_DateTime"] < current_time:
            dataframe.at[idx, "Status"] = True
            completed_count += 1
            sheet_updated = True
            
        # All-day tasks that belong to a historical calendar date roll forward
        elif row["Scheduled?"] == False and row["Type"] == "Task" and pd.to_datetime(row["Date"]).date() < current_time.date():
            dataframe.at[idx, "Date"] = today_str
            rolled_count += 1
            sheet_updated = True
            
            g_id = str(row.get("Event ID", ""))
            cal_name = row.get("Calendar")
            if g_id and g_id not in ["None", "", "nan"]:
                try:
                    t_id = TASKLIST_MAP.get(cal_name, "@default")
                    service_tasks.tasks().patch(tasklist=t_id, task=g_id, body={"due": f"{today_str}T00:00:00.000Z"}).execute()
                except Exception: pass

    if sheet_updated:
        connection.update(data=dataframe, spreadsheet=st.secrets.connections.gsheets.mission_control_sheet)
        st.cache_data.clear()
        
        toast_msg = "🧹 Sweeper run complete! "
        if completed_count > 0: toast_msg += f"Marked {completed_count} timed events Done. "
        if rolled_count > 0: toast_msg += f"Rolled {rolled_count} all-day tasks to today."
        st.success(toast_msg)
        st.rerun()
    else:
        st.toast("🧹 Schedule is optimized. No items required sweep updates.")

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

# --- NAVIGATION HUB LAYOUT ---
categories = ["Upcoming", "Upcoming Tasks", "All Completed", "All History", "All Events", "All Tasks"] + list(CALENDAR_MAP.keys())
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
            sweep_past_events(df, conn, tasks_service)
            
    task_tabs = st.tabs(categories)
    
    today = pd.to_datetime(pd.Timestamp.today().date())
    four_weeks_out = today + pd.Timedelta(weeks=4)
    safe_dates = pd.to_datetime(df["Date"], errors='coerce')
    
    for i, category in enumerate(categories):
        with task_tabs[i]:
            if category == "Upcoming":
                mask = (~df["Status"]) & (safe_dates >= today) & (safe_dates <= four_weeks_out)
            elif category == "Upcoming Tasks":
                mask = (df["Type"] == "Task") & (~df["Status"]) & (safe_dates <= four_weeks_out)
            elif category == "All Completed":
                mask = (df["Status"] == True)
            elif category == "All History": mask = pd.Series(True, index=df.index)
            elif category == "All Events": mask = (df["Type"] == "Event")
            elif category == "All Tasks": mask = (df["Type"] == "Task")
            else: mask = (df["Calendar"] == category)
            
            # Sort management hub mapping layers
            if category == "All Completed":
                display_df = df[mask].copy().sort_values(by=["Date", "Time"], ascending=[False, False])
            else:
                display_df = df[mask].copy().sort_values(by=["Date", "Time"], ascending=[True, True])
            
            if display_df.empty:
                st.info("No items found in this section.")
                continue

            # --- DENSE CARD MATRIX ENGINE ---
            st.markdown('<div class="card-container">', unsafe_allow_html=True)
            for idx, row in display_df.iterrows():
                cat_class = f"border-{row['Calendar'].lower().replace(' ', '-')}"
                status_emoji = "✅" if row["Status"] else "⏳"
                type_emoji = "📅" if row["Type"] == "Event" else "☑️"
                
                cleaned_loc = str(row["Location"]).strip() if str(row["Location"]).strip().lower() not in ["nan", "none", ""] else ""
                cleaned_notes = str(row["Notes"]).strip() if str(row["Notes"]).strip().lower() not in ["nan", "none", ""] else ""
                
                is_row_all_day = str(row['Time']).strip() in ["", "None", "nan", "00:00:00"] and int(row.get('Duration (Mins)', 0)) == 0
                if not is_row_all_day and str(row['Time']).strip() not in ["", "None", "nan"]:
                    try: time_display = pd.to_datetime(row['Time']).strftime("%I:%M %p")
                    except Exception: time_display = str(row['Time'])
                    dur_suffix = f" ({row['Duration (Mins)']}m)"
                else: 
                    time_display = "All Day"
                    dur_suffix = ""
                
                date_display = pd.to_datetime(row['Date']).strftime('%a, %b %d')
                
                card_html = f"""
                <div class="task-card {cat_class}">
                    <div>
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2px;">
                            <span class="badge">{row['Calendar']}</span>
                            <span style="font-size: 0.75rem;">{type_emoji}</span>
                        </div>
                        <div class="card-title">{row['Item Name']}</div>
                        <div class="meta-row">🕒 <b>{date_display}</b> @ {time_display}{dur_suffix}</div>
                        {f'<div class="meta-row">📍 {cleaned_loc}</div>' if cleaned_loc else ''}
                        {f'<div class="meta-row" style="font-style: italic; color:#71717A; margin-top:2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{cleaned_notes}</div>' if cleaned_notes else ''}
                    </div>
                </div>
                """
                st.markdown(card_html, unsafe_allow_html=True)
                
                # --- TWO-BUTTON WORKSPACE ROW ---
                with st.container():
                    col_done, col_options = st.columns([1, 1])
                    
                    with col_done:
                        if not row["Status"]:
                            if st.button("Complete", key=f"done_{idx}_{category.lower()}", use_container_width=True):
                                df.at[idx, "Status"] = True
                                g_id, item_type, cal_name = str(row.get("Event ID", "")), row.get("Type"), row.get("Calendar")
                                if g_id and g_id not in ["", "None", "nan"] and item_type == "Task":
                                    try: tasks_service.tasks().patch(tasklist=TASKLIST_MAP.get(cal_name, "@default"), task=g_id, body={'status': 'completed'}).execute()
                                    except Exception: pass
                                conn.update(data=df, spreadsheet=st.secrets.connections.gsheets.mission_control_sheet)
                                st.cache_data.clear()
                                st.rerun()
                        else:
                            # RESTORED UNDO COMPILING PATHWAY: Toggles completed tasks back into active queues
                            if st.button("↩️ Undo", key=f"undo_{idx}_{category.lower()}", use_container_width=True):
                                df.at[idx, "Status"] = False
                                g_id, item_type, cal_name = str(row.get("Event ID", "")), row.get("Type"), row.get("Calendar")
                                if g_id and g_id not in ["", "None", "nan"] and item_type == "Task":
                                    try: tasks_service.tasks().patch(tasklist=TASKLIST_MAP.get(cal_name, "@default"), task=g_id, body={'status': 'needsAction'}).execute()
                                    except Exception: pass
                                conn.update(data=df, spreadsheet=st.secrets.connections.gsheets.mission_control_sheet)
                                st.cache_data.clear()
                                st.rerun()
                                
                    with col_options:
                        with st.popover("⚙️ Options", use_container_width=True):
                            st.write("### Manage Entry")
                            edit_name = st.text_input("Item Title", value=row["Item Name"], key=f"ed_name_{idx}_{category.lower()}")
                            edit_date = st.text_input("Date (YYYY-MM-DD)", value=str(row["Date"]), key=f"ed_date_{idx}_{category.lower()}")
                            
                            edit_all_day = st.checkbox("All-day / No specific time", value=is_row_all_day, key=f"ed_allday_{idx}_{category.lower()}")
                            edit_time = st.text_input("Time (HH:MM:SS)", value=str(row["Time"]) if str(row["Time"]).strip() not in ["", "None", "nan"] else "00:00:00", disabled=edit_all_day, key=f"ed_time_{idx}_{category.lower()}")
                            edit_dur = st.number_input("Duration (Mins)", min_value=0, max_value=480, value=int(row["Duration (Mins)"]) if pd.notna(row["Duration (Mins)"]) else 60, step=15, disabled=edit_all_day, key=f"ed_dur_{idx}_{category.lower()}")
                            
                            edit_loc = st.text_input("Location", value=str(row["Location"]), key=f"ed_loc_{idx}_{category.lower()}")
                            edit_notes = st.text_area("Notes", value=str(row["Notes"]), key=f"ed_notes_{idx}_{category.lower()}")
                            
                            if st.button("💾 Save Changes", key=f"save_inline_{idx}_{category.lower()}", use_container_width=True):
                                try:
                                    if edit_all_day:
                                        parsed_date = pd.to_datetime(edit_date)
                                        final_date_str = parsed_date.strftime('%Y-%m-%d')
                                        final_time_str, final_dur = "", 0
                                    else:
                                        parsed_dt = pd.to_datetime(f"{edit_date} {edit_time if edit_time.strip() else '00:00:00'}")
                                        final_date_str, final_time_str, final_dur = parsed_dt.strftime('%Y-%m-%d'), parsed_dt.strftime('%H:%M:%S'), int(edit_dur)
                                except Exception:
                                    st.error("⚠️ Formatting Error: Check input rules.")
                                    st.stop()

                                processed_notes = edit_notes
                                if row["Type"] == "Task" and not edit_all_day and final_time_str != str(row["Time"]):
                                    try:
                                        new_time_display = parsed_dt.strftime('%I:%M %p')
                                        current_notes_str = edit_notes if edit_notes.strip() not in ["None", "nan", ""] else ""
                                        lines = current_notes_str.split('\n')
                                        line_found = False
                                        for j, line in enumerate(lines):
                                            if "⏰ Scheduled:" in line:
                                                lines[j] = f"⏰ Scheduled: {new_time_display}"
                                                line_found = True
                                                break
                                        if not line_found: processed_notes = f"⏰ Scheduled: {new_time_display}\n\n{current_notes_str}" if current_notes_str else f"⏰ Scheduled: {new_time_display}"
                                        else: processed_notes = "\n".join(lines).strip()
                                    except Exception: pass
                                
                                df.at[idx, "Item Name"], df.at[idx, "Date"], df.at[idx, "Time"], df.at[idx, "Duration (Mins)"], df.at[idx, "Location"], df.at[idx, "Notes"], df.at[idx, "Scheduled?"] = edit_name, final_date_str, final_time_str, final_dur, edit_loc, processed_notes, not edit_all_day
                                
                                g_id, item_type, cal_name = str(row.get("Event ID", "")), row.get("Type"), row.get("Calendar")
                                if g_id and g_id not in ["None", "", "nan"]:
                                    if item_type == "Task":
                                        t_id = TASKLIST_MAP.get(cal_name, "@default")
                                        task_body = {'title': edit_name, 'notes': processed_notes}
                                        try: task_body['due'] = pd.to_datetime(final_date_str).strftime('%Y-%m-%dT00:00:00.000Z')
                                        except Exception: pass
                                        try: tasks_service.tasks().patch(tasklist=t_id, task=g_id, body=task_body).execute()
                                        except Exception: pass
                                        
                                        tb_id = str(row.get("Timeblock ID", ""))
                                        if tb_id and tb_id.lower() not in ["none", "", "nan"]:
                                            c_id = CALENDAR_MAP.get(cal_name)
                                            tb_body = {'summary': f"☑️ [Task] {edit_name}", 'description': processed_notes, 'location': edit_loc}
                                            if edit_all_day:
                                                tb_body['start'], tb_body['end'] = {'date': final_date_str}, {'date': (pd.to_datetime(final_date_str) + pd.Timedelta(days=1)).strftime('%Y-%m-%d')}
                                            else:
                                                tb_body['start'], tb_body['end'] = {'dateTime': parsed_dt.strftime('%Y-%m-%dT%H:%M:%S'), 'timeZone': 'America/Toronto'}, {'dateTime': (parsed_dt + pd.Timedelta(minutes=final_dur)).strftime('%Y-%m-%dT%H:%M:%S'), 'timeZone': 'America/Toronto'}
                                            try: cal_service.events().patch(calendarId=c_id, eventId=tb_id, body=tb_body).execute()
                                            except Exception: pass
                                            
                                    elif item_type == "Event":
                                        c_id = CALENDAR_MAP.get(cal_name)
                                        event_patch_body = {'summary': edit_name, 'description': processed_notes, 'location': edit_loc}
                                        if edit_all_day:
                                            event_patch_body['start'], event_patch_body['end'] = {'date': final_date_str}, {'date': (pd.to_datetime(final_date_str) + pd.Timedelta(days=1)).strftime('%Y-%m-%d')}
                                        else:
                                            event_patch_body['start'], event_patch_body['end'] = {'dateTime': parsed_dt.strftime('%Y-%m-%dT%H:%M:%S'), 'timeZone': 'America/Toronto'}, {'dateTime': (parsed_dt + pd.Timedelta(minutes=final_dur)).strftime('%Y-%m-%dT%H:%M:%S'), 'timeZone': 'America/Toronto'}
                                        try: cal_service.events().patch(calendarId=c_id, eventId=g_id, body=event_patch_body).execute()
                                        except Exception: pass
                                
                                conn.update(data=df, spreadsheet=st.secrets.connections.gsheets.mission_control_sheet)
                                st.cache_data.clear()
                                st.rerun()
                            
                            st.write("---")
                            if st.button("🗑️ Delete Item permanently", key=f"del_{idx}_{category.lower()}", use_container_width=True):
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