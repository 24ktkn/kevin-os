import streamlit as st
import pandas as pd
import datetime
from streamlit_gsheets import GSheetsConnection
from google.oauth2 import service_account
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
import streamlit.components.v1 as components

st.set_page_config(page_title="Mission Control", layout="wide")
st.title("🚀 Mission Control")

# --- CALENDAR API SETUP ---
CALENDAR_MAP = {
    "Kevin Nguyen": "24ktkn@gmail.com",
    "Family": "family05668227215423587251@group.calendar.google.com",
    "School": "0dbc1f40c9dc993c6b893fa0e1646b888eb8ed8599668c9697d72689e041e315@group.calendar.google.com",
    "Volunteering": "57bb8a8bf61e233e8bb76ab03f53b03ead35e7ba66e37d2bfd73792e1c1e575e@group.calendar.google.com"
}

# --- TASK LISTS MAP ---
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
    now = datetime.datetime.utcnow()
    time_min = (now - datetime.timedelta(days=7)).isoformat() + 'Z'
    time_max = (now + datetime.timedelta(days=30)).isoformat() + 'Z'
    sheet_updated = False
    
    text_columns = ["Item Name", "Type", "Calendar", "Date", "Time", "Location", "Notes", "Event ID", "Timeblock ID"]
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
                        idx_to_clear = df[df["Timeblock ID"] == gcal_id].index
                        df.loc[idx_to_clear, "Timeblock ID"] = ""
                        sheet_updated = True
                    continue 
                
                summary = event.get('summary', 'Untitled Event')
                description = event.get('description', '')
                location_str = event.get('location', '')
                
                start_info = event.get('start', {})
                end_info = event.get('end', {})
                
                if 'dateTime' in start_info:
                    start_raw = start_info.get('dateTime')
                    end_raw = end_info.get('dateTime')
                    start_dt = datetime.datetime.fromisoformat(start_raw[:19])
                    end_dt = datetime.datetime.fromisoformat(end_raw[:19])
                    duration_mins = int((end_dt - start_dt).total_seconds() / 60)
                    date_str = start_dt.strftime('%Y-%m-%d')
                    time_str = start_dt.strftime('%H:%M:%S')
                elif 'date' in start_info:
                    date_str = start_info.get('date')
                    time_str = ""
                    duration_mins = 0
                else:
                    continue

                matching_rows = df[(df["Event ID"] == gcal_id) | (df["Timeblock ID"] == gcal_id)]
                
                if not matching_rows.empty:
                    idx = matching_rows.index[0]
                    try:
                        current_duration = int(df.at[idx, "Duration (Mins)"])
                    except (ValueError, TypeError):
                        current_duration = 0
                    
                    if (df.at[idx, "Date"] != date_str or 
                        current_duration != duration_mins or
                        df.at[idx, "Location"] != location_str):
                        
                        df.at[idx, "Date"] = date_str
                        df.at[idx, "Time"] = time_str
                        df.at[idx, "Duration (Mins)"] = int(duration_mins)
                        df.at[idx, "Location"] = location_str
                        sheet_updated = True
                else:
                    new_row = {
                        "Status": False, "Item Name": summary, "Type": "Event",
                        "Calendar": cal_name, "Date": date_str, "Time": time_str,
                        "Duration (Mins)": int(duration_mins), "Scheduled?": True,
                        "Location": location_str, "Notes": description, "Event ID": gcal_id,
                        "Timeblock ID": ""
                    }
                    df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)
                    sheet_updated = True
        except Exception as e:
            st.error(f"Error reading calendar '{cal_name}': {e}")

    processed_tasklists = set()
    for tl_name, tl_id in TASKLIST_MAP.items():
        if tl_id in processed_tasklists: continue
        processed_tasklists.add(tl_id)
        try:
            tasks_result = service_tasks.tasks().list(
                tasklist=tl_id, showCompleted=True, showHidden=True, showDeleted=True
            ).execute()
            
            for task in tasks_result.get('items', []):
                g_id = task.get('id')
                g_status = task.get('status') 
                g_deleted = task.get('deleted', False)
                
                if g_deleted:
                    if g_id in df["Event ID"].values:
                        df = df[df["Event ID"] != g_id].reset_index(drop=True)
                        sheet_updated = True
                    continue
                    
                matching_rows = df[df["Event ID"] == g_id]
                if not matching_rows.empty:
                    idx = matching_rows.index[0]
                    is_completed = (g_status == 'completed')
                    current_status = bool(df.at[idx, "Status"])
                    
                    if is_completed != current_status:
                        df.at[idx, "Status"] = is_completed
                        sheet_updated = True
        except Exception: pass
            
    if sheet_updated:
        connection.update(data=df, spreadsheet=st.secrets.connections.gsheets.mission_control_sheet)
        st.toast("✅ Master Sheet synchronized with Calendars and Tasks!")
        return df, True
        
    st.toast("🌟 Already up to date.")
    return df, False

# --- GOOGLE SHEETS SETUP ---
conn = st.connection("gsheets", type=GSheetsConnection)
df = conn.read(spreadsheet=st.secrets.connections.gsheets.mission_control_sheet, ttl=0)

required_cols = ["Status", "Scheduled?", "Type", "Date", "Location", "Timeblock ID"]
for col in required_cols:
    if col not in df.columns:
        df[col] = False if col in ["Status", "Scheduled?"] else ""

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
            selected_reminders = st.multiselect(
                "Notifications (Pop-up)", 
                options=["At time of event", "10 minutes before", "30 minutes before", "1 hour before", "2 hours before", "1 day before"], 
                default=["30 minutes before"]
            )

        with col2:
            target_date = st.date_input("Date", datetime.date.today())
            all_day = st.checkbox("All-day / No specific time")
            start_time = st.time_input("Start Time", datetime.time(0, 0), disabled=all_day)
            duration = st.number_input("Duration (Mins)", min_value=15, max_value=480, value=60, step=15, disabled=all_day)
            repeat_option = st.selectbox("Repeat", ["None", "Daily", "Weekly", "Monthly", "Every Weekday (Mon-Fri)"])
        
        location_input = st.text_input("Location (Optional)", placeholder="e.g., Schulich Med building")
        notes = st.text_area("Notes", placeholder="Add links or modules here...")
        
        if st.form_submit_button("Push to Master Tracker") and item_name:
            target_cal_id = CALENDAR_MAP.get(calendar_cat)
            reminder_map = {"At time of event": 0, "10 minutes before": 10, "30 minutes before": 30, "1 hour before": 60, "2 hours before": 120, "1 day before": 1440}

            if selected_reminders:
                overrides = [{'method': 'popup', 'minutes': reminder_map[r]} for r in selected_reminders]
                reminders_payload = {'useDefault': False, 'overrides': overrides}
            else:
                reminders_payload = {'useDefault': True}
            
            if all_day:
                event_body = {
                    'summary': item_name, 'description': notes, 'location': location_input,
                    'start': {'date': target_date.strftime('%Y-%m-%d')},
                    'end': {'date': (target_date + datetime.timedelta(days=1)).strftime('%Y-%m-%d')},
                    'reminders': reminders_payload
                }
                time_str = ""
                duration_val = 0
            else:
                start_dt = f"{target_date}T{start_time.strftime('%H:%M:%S')}-04:00"
                end_dt_obj = datetime.datetime.combine(target_date, start_time) + datetime.timedelta(minutes=int(duration))
                end_dt = f"{end_dt_obj.strftime('%Y-%m-%dT%H:%M:%S')}-04:00"

                event_body = {
                    'summary': item_name, 'description': notes, 'location': location_input,
                    'start': {'dateTime': start_dt, 'timeZone': 'America/Toronto'},
                    'end': {'dateTime': end_dt, 'timeZone': 'America/Toronto'},
                    'reminders': reminders_payload
                }
                time_str = str(start_time)
                duration_val = int(duration)

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
                    due_date = f"{target_date}T00:00:00.000Z"
                    task_notes = notes
                    
                    if not all_day:
                        time_display = start_time.strftime('%I:%M %p')
                        task_notes = f"⏰ Scheduled: {time_display}\n\n{notes}" if notes else f"⏰ Scheduled: {time_display}"
                        
                        timeblock_body = event_body.copy()
                        timeblock_body['summary'] = f"☑️ [Task] {item_name}"
                        try:
                            created_tb = cal_service.events().insert(calendarId=target_cal_id, body=timeblock_body).execute()
                            timeblock_id = created_tb.get('id')
                        except Exception: pass

                    task_body = {'title': item_name, 'notes': task_notes, 'due': due_date}
                    created_item = tasks_service.tasks().insert(tasklist=target_tasklist_id, body=task_body).execute()
                    new_item_id = created_item.get('id')
                
                new_row = {
                    "Status": False, "Item Name": item_name, "Type": item_type, 
                    "Calendar": calendar_cat, "Date": str(target_date), 
                    "Time": time_str, "Duration (Mins)": duration_val, 
                    "Scheduled?": not all_day, "Location": location_input, 
                    "Notes": notes, "Event ID": new_item_id, "Timeblock ID": timeblock_id
                }
                
                updated_df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)
                conn.update(data=updated_df, spreadsheet=st.secrets.connections.gsheets.mission_control_sheet)
                st.success(f"✅ Saved to Google Cloud!")
                st.rerun()

            except Exception as e:
                st.error(f"Failed to sync with Google: {e}")

with tab2:
    st.header("Master Task Tracker")
    st.info("Double-click any cell (Name, Date, Location, Notes) to edit. Check the box to delete. Click Save to push to Google Cloud.")
    
    if st.button("🔄 Sync Everything to Sheet"):
        df, was_updated = sync_all_to_sheet(df, cal_service, tasks_service, conn)
        if was_updated: st.rerun()
            
    categories = ["Upcoming", "Upcoming Tasks", "All History", "All Events", "All Tasks"] + list(CALENDAR_MAP.keys())
    task_tabs = st.tabs(categories)
    
    today = pd.to_datetime(datetime.date.today())
    four_weeks_out = today + pd.Timedelta(weeks=4)
    safe_dates = pd.to_datetime(df["Date"], errors='coerce')
    
    for i, category in enumerate(categories):
        with task_tabs[i]:
            if category == "Upcoming":
                mask = (~df["Status"]) & (safe_dates >= today) & (safe_dates <= four_weeks_out)
                display_df = df[mask].copy()
            elif category == "Upcoming Tasks":
                mask = (df["Type"] == "Task") & (~df["Status"]) & ((~df["Scheduled?"]) | ((safe_dates >= today) & (safe_dates <= four_weeks_out)))
                display_df = df[mask].copy()
            elif category == "All History": display_df = df.copy()
            elif category == "All Events": display_df = df[df["Type"] == "Event"].copy()
            elif category == "All Tasks": display_df = df[df["Type"] == "Task"].copy()
            else: display_df = df[df["Calendar"] == category].copy()
            
            # --- NEW: SORT ALL TABS BY DATE DESCENDING ---
            # This cleanly sorts the data frame before it gets rendered by the editor.
            display_df = display_df.sort_values(by=["Date", "Time"], ascending=[False, False])
            # ---------------------------------------------
            
            # 1. Safely generate the column first so Pandas doesn't throw a KeyError
            display_df = display_df.assign(**{"🗑️ Delete?": False})
            
            # 2. Force native Python types
            display_df = display_df.astype({
                "🗑️ Delete?": bool,
                "Status": bool,
                "Item Name": str,
                "Date": str,
                "Time": str,
                "Location": str,
                "Notes": str
            })
            
            edited_df = st.data_editor(
                display_df, 
                use_container_width=True, hide_index=True,
                key=f"editor_{category.lower().replace(' ', '_')}", 
                column_config={
                    "🗑️ Delete?": st.column_config.CheckboxColumn("Delete", default=False),
                    "Status": st.column_config.CheckboxColumn("Done", default=False),
                    "Item Name": st.column_config.TextColumn("Title"),
                    "Date": st.column_config.TextColumn("Date (YYYY-MM-DD)"),
                    "Time": st.column_config.TextColumn("Time (HH:MM:SS)"),
                    "Location": st.column_config.TextColumn("Location"),
                    "Notes": st.column_config.TextColumn("Notes"),
                }
            )
            
            if st.button(f"💾 Save {category} Changes", key=f"btn_{category.lower().replace(' ', '_')}"):
                
                rows_to_delete = edited_df[edited_df["🗑️ Delete?"] == True]
                for idx, row in rows_to_delete.iterrows():
                    gcal_id = str(row.get("Event ID", ""))
                    cal_name = row.get("Calendar")
                    item_type = row.get("Type")
                    
                    if gcal_id and gcal_id not in ["None", "", "nan"]:
                        if item_type == "Event":
                            try: cal_service.events().delete(calendarId=CALENDAR_MAP.get(cal_name), eventId=gcal_id).execute()
                            except Exception: pass
                        elif item_type == "Task":
                            try: tasks_service.tasks().delete(tasklist=TASKLIST_MAP.get(cal_name, "@default"), task=gcal_id).execute()
                            except Exception: pass
                            tb_id = str(row.get("Timeblock ID", ""))
                            if tb_id and tb_id not in ["None", "", "nan"]:
                                try: cal_service.events().delete(calendarId=CALENDAR_MAP.get(cal_name), eventId=tb_id).execute()
                                except Exception: pass
                    if idx in df.index: df = df.drop(index=idx)
                        
                for idx, row in edited_df.iterrows():
                    if row["🗑️ Delete?"]: continue
                        
                    original_row = display_df.loc[idx]
                    g_id = str(row.get("Event ID", ""))
                    item_type = row.get("Type")
                    cal_name = row.get("Calendar")
                    
                    if g_id and g_id not in ["None", "", "nan"]:
                        # Track all possible variable changes
                        s_changed = bool(original_row["Status"]) != bool(row["Status"])
                        name_changed = str(original_row["Item Name"]) != str(row["Item Name"])
                        notes_changed = str(original_row["Notes"]) != str(row["Notes"])
                        date_changed = str(original_row["Date"]) != str(row["Date"])
                        time_changed = str(original_row["Time"]) != str(row["Time"])
                        location_changed = str(original_row.get("Location", "")) != str(row.get("Location", ""))

                        if time_changed and item_type == "Task":
                            try:
                                t_str = str(row["Time"]) if str(row["Time"]) and str(row["Time"]).lower() not in ["nan", "none", ""] else "00:00:00"
                                new_time_display = pd.to_datetime(t_str).strftime('%I:%M %p')
                                current_notes = str(row["Notes"]) if str(row["Notes"]) not in ["None", "nan", ""] else ""
                                lines = current_notes.split('\n')
                                found = False
                                for j, line in enumerate(lines):
                                    if "⏰ Scheduled:" in line:
                                        lines[j] = f"⏰ Scheduled: {new_time_display}"
                                        found = True
                                        break
                                if not found:
                                    updated_notes = f"⏰ Scheduled: {new_time_display}\n\n{current_notes}" if current_notes else f"⏰ Scheduled: {new_time_display}"
                                else:
                                    updated_notes = "\n".join(lines).strip()
                                row["Notes"] = updated_notes
                                edited_df.at[idx, "Notes"] = updated_notes
                                notes_changed = True
                            except Exception: pass

                        if any([s_changed, name_changed, notes_changed, date_changed, time_changed, location_changed]):
                            if item_type == "Task":
                                t_id = TASKLIST_MAP.get(cal_name, "@default")
                                body = {}
                                if s_changed: body['status'] = 'completed' if row["Status"] else 'needsAction'
                                if name_changed: body['title'] = row["Item Name"]
                                if notes_changed: body['notes'] = row["Notes"]
                                if date_changed: 
                                    try:
                                        body['due'] = pd.to_datetime(row['Date']).strftime('%Y-%m-%dT00:00:00.000Z')
                                    except Exception: pass
                                
                                try: tasks_service.tasks().patch(tasklist=t_id, task=g_id, body=body).execute()
                                except Exception as e: st.error(f"Task Sync Error: {e}")

                                tb_id = str(row.get("Timeblock ID", ""))
                                if tb_id and str(tb_id).lower() not in ["none", "", "nan"]:
                                    if any([name_changed, notes_changed, date_changed, time_changed, location_changed]):
                                        c_id = CALENDAR_MAP.get(cal_name)
                                        tb_body = {}
                                        if name_changed: tb_body['summary'] = f"☑️ [Task] {row['Item Name']}"
                                        if notes_changed: tb_body['description'] = row["Notes"]
                                        if location_changed: tb_body['location'] = row["Location"]
                                        if date_changed or time_changed:
                                            try:
                                                d_str = str(row["Date"])
                                                t_str = str(row["Time"]) if str(row["Time"]) and str(row["Time"]).lower() not in ["nan", "none", ""] else "00:00:00"
                                                start_dt = pd.to_datetime(f"{d_str} {t_str}")
                                                dur = int(row["Duration (Mins)"]) if pd.notna(row["Duration (Mins)"]) else 60
                                                end_dt = start_dt + pd.Timedelta(minutes=dur)
                                                tb_body['start'] = {'dateTime': start_dt.strftime('%Y-%m-%dT%H:%M:%S'), 'timeZone': 'America/Toronto'}
                                                tb_body['end'] = {'dateTime': end_dt.strftime('%Y-%m-%dT%H:%M:%S'), 'timeZone': 'America/Toronto'}
                                                edited_df.at[idx, "Time"] = start_dt.strftime('%H:%M:%S')
                                                edited_df.at[idx, "Date"] = start_dt.strftime('%Y-%m-%d')
                                            except Exception as e: st.warning(f"Format issue for '{row['Item Name']}': {e}")
                                        
                                        try: cal_service.events().patch(calendarId=c_id, eventId=tb_id, body=tb_body).execute()
                                        except Exception as e: st.error(f"Timeblock Sync Error: {e}")

                            elif item_type == "Event":
                                c_id = CALENDAR_MAP.get(cal_name)
                                body = {}
                                if name_changed: body['summary'] = row["Item Name"]
                                if notes_changed: body['description'] = row["Notes"]
                                if location_changed: body['location'] = row["Location"]
                                if date_changed or time_changed:
                                    try:
                                        d_str = str(row["Date"])
                                        t_str = str(row["Time"]) if str(row["Time"]) and str(row["Time"]).lower() not in ["nan", "none", ""] else "00:00:00"
                                        start_dt = pd.to_datetime(f"{d_str} {t_str}")
                                        dur = int(row["Duration (Mins)"]) if pd.notna(row["Duration (Mins)"]) else 60
                                        end_dt = start_dt + pd.Timedelta(minutes=dur)
                                        body['start'] = {'dateTime': start_dt.strftime('%Y-%m-%dT%H:%M:%S'), 'timeZone': 'America/Toronto'}
                                        body['end'] = {'dateTime': end_dt.strftime('%Y-%m-%dT%H:%M:%S'), 'timeZone': 'America/Toronto'}
                                        edited_df.at[idx, "Time"] = start_dt.strftime('%H:%M:%S')
                                        edited_df.at[idx, "Date"] = start_dt.strftime('%Y-%m-%d')
                                    except Exception as e: st.warning(f"Format issue for '{row['Item Name']}': {e}")
                                
                                try: cal_service.events().patch(calendarId=c_id, eventId=g_id, body=body).execute()
                                except Exception as e: st.error(f"Event Sync Error: {e}")

                rows_to_keep = edited_df[edited_df["🗑️ Delete?"] == False].drop(columns=["🗑️ Delete?"])
                df.update(rows_to_keep)
                conn.update(data=df, spreadsheet=st.secrets.connections.gsheets.mission_control_sheet)
                
                st.success(f"✅ Edits, Reschedules, and Deletions saved to Google Cloud!")
                st.rerun()

with tab3:
    st.header("Consolidated Calendar View")
    calendar_iframe = """
    <iframe src="https://calendar.google.com/calendar/embed?height=600&wkst=1&ctz=America%2FToronto&showPrint=0&src=MjRrdGtuQGdtYWlsLmNvbQ&src=MGRiYzFmNDBjOWRjOTkzYzZiODkzZmEwZTE2NDZiODg4ZWI4ZWQ4NTk5NjY4Yzk2OTdkNzI2ODllMDQxZTMxNUBncm91cC5jYWxlbmRhci5nb29nbGUuY29t&src=NTdiYjhhOGJmNjFlMjMzZThiYjc2YWIwM2Y1M2IwM2VhZDM1ZTdiYTY2ZTM3ZDJiZmQ3Mzc5MmUxYzFlNTc1ZUBncm91cC5jYWxlbmRhci5nb29nbGUuY29t&src=ZmFtaWx5MDU2NjgyMjcyMTU0MjM1ODcyNTFAZ3JvdXAuY2FsZW5kYXIuZ29vZ2xlLmNvbQ&src=ZW4uY2FuYWRpYW4jaG9saWRheUBncm91cC52LmNhbGVuZGFyLmdvb2dsZS5jb20&src=YjN0ZXZkdWlvaHN1ZDVxNHJwaGlycDVpNmR1dWh1aTdAaW1wb3J0LmNhbGVuZGFyLmdvb2dsZS5jb20&color=%23039be5&color=%238e24aa&color=%23f6bf26&color=%23d50000&color=%230b8043&color=%233f51b5" style="border:solid 1px #777" width="100%" height="600" frameborder="0" scrolling="no"></iframe>
    """
    components.html(calendar_iframe, height=600)