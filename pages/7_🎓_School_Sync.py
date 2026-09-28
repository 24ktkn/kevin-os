import streamlit as st
import pandas as pd
from datetime import datetime, timedelta
import urllib.request
import json
import os
import re
from streamlit_gsheets import GSheetsConnection
from google.oauth2 import service_account
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

st.set_page_config(page_title="School Sync", layout="wide")

bgColor = "#0F0F12"
cardBgColor = "#16161D"
cardBorderColor = "#23232F"
neonGreen = "#00FF66"
cyanColor = "#00F0FF"
yellowColor = "#FFB703"

st.markdown(f'''
<style>
    .stApp {{ background-color: {bgColor}; color: #FFFFFF; font-family: -apple-system, sans-serif; }}
    .metric-card {{ background-color: {cardBgColor}; border: 1px solid {cardBorderColor}; border-radius: 12px; padding: 20px; }}
    .stTextInput > div > div > input {{ background-color: {cardBgColor}; color: white; border: 1px solid {cardBorderColor}; }}
</style>
''', unsafe_allow_html=True)

st.title("?? School Sync & Timeblocker")
st.markdown("Import your public school calendar, identify assignments and modules, and schedule them into your personal Mission Control system.")

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

@st.cache_resource
def get_calendar_service():
    creds_info = st.secrets["connections"]["gsheets"]
    creds = service_account.Credentials.from_service_account_info(
        creds_info, scopes=['https://www.googleapis.com/auth/calendar']
    )
    return build('calendar', 'v3', credentials=creds)

@st.cache_resource
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

try:
    cal_service = get_calendar_service()
    tasks_service = get_tasks_service()
except Exception as e:
    st.error(f"API Error: {e}. If Tasks failed, you may need to re-authenticate.")
    st.stop()

conn = st.connection("gsheets", type=GSheetsConnection)

try:
    df = conn.read(spreadsheet=st.secrets.connections.gsheets.mission_control_sheet, ttl=0)
    if "Status" in df.columns:
        df["Status"] = df["Status"].replace({"TRUE": True, "FALSE": False, "True": True, "False": False}).fillna(False).astype(bool)
except Exception as e:
    st.error("Could not connect to Mission Control sheet.")
    st.stop()


scheduled_titles = set(df["Item Name"].fillna("").astype(str).tolist())


CONFIG_FILE = "data/school_config.json"
OVERRIDES_FILE = "data/school_overrides.json"

def load_config():
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, 'r') as f: return json.load(f)
    return {"ical_url": "https://elentra.schulich.uwo.ca/calendars/private-75254bda7546b960cf7cafa6c97f213b/knguy69.ics"}

def save_config(cfg):
    os.makedirs("data", exist_ok=True)
    with open(CONFIG_FILE, 'w') as f: json.dump(cfg, f)

def load_overrides():
    if os.path.exists(OVERRIDES_FILE):
        with open(OVERRIDES_FILE, 'r') as f: return json.load(f)
    return {}

def save_overrides(ov):
    os.makedirs("data", exist_ok=True)
    with open(OVERRIDES_FILE, 'w') as f: json.dump(ov, f)

config = load_config()
overrides = load_overrides()


@st.cache_data(ttl=600)
def fetch_and_parse_ical(url):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        response = urllib.request.urlopen(req)
        data = response.read().decode('utf-8')
    except Exception as e:
        return None, f"Failed to fetch URL: {e}"
        
    events = []
    current_event = {}
    in_event = False
    
    data = data.replace('\r\n ', '').replace('\n ', '')
    
    for line in data.split('\n'):
        line = line.strip()
        if not line: continue
        if line == 'BEGIN:VEVENT':
            in_event = True
            current_event = {}
        elif line == 'END:VEVENT':
            in_event = False
            if 'date_obj' in current_event:
                events.append(current_event)
        elif in_event:
            if ':' in line:
                key, val = line.split(':', 1)
                key_base = key.split(';')[0]
                current_event[key_base] = val
                if key_base == 'DTSTART':
                    if len(val) == 8:
                        current_event['is_allday'] = True
                        current_event['date_obj'] = datetime.strptime(val, '%Y%m%d')
                    elif len(val) >= 15:
                        current_event['is_allday'] = False
                        try:
                            current_event['date_obj'] = datetime.strptime(val[:15].replace('Z',''), '%Y%m%dT%H%M%S')
                        except:
                            current_event['date_obj'] = datetime.now()
    
    now = datetime.now()
    future_events = [e for e in events if e['date_obj'] >= now - timedelta(days=1)]
    future_events.sort(key=lambda x: x['date_obj'])
    return future_events, None

with st.expander("?? Configuration", expanded=(not config['ical_url'])):
    st.markdown("Enter the **Public Address in iCal format** for your school calendar.")
    ical_input = st.text_input("iCal URL (.ics)", value=config['ical_url'])
    if st.button("Save URL"):
        config['ical_url'] = ical_input
        save_config(config)
        st.success("Saved!")
        st.rerun()

if not config['ical_url']:
    st.info("Please configure your iCal URL above to see your school events.")
    st.stop()

with st.spinner("Fetching calendar..."):
    events, error = fetch_and_parse_ical(config['ical_url'])

if error:
    st.error(error)
    st.stop()


modules = []
assignments = []
classes = []

for e in events:
    uid = e.get('UID', e.get('SUMMARY', ''))
    title = e.get('SUMMARY', '')
    title_lower = title.lower()
    
    module_match = re.search(r'\((\d+)\s*mins?\)', title_lower)
    
    cat_override = overrides.get(uid)
    
    if cat_override == 'module' or (not cat_override and module_match):
        if module_match: e['duration'] = int(module_match.group(1))
        else: e['duration'] = 60
        modules.append(e)
    elif cat_override == 'assignment' or (not cat_override and ('assignment' in title_lower or 'due' in title_lower)):
        e['duration'] = 60
        assignments.append(e)
    else:
        e['duration'] = 60
        classes.append(e)


tab1, tab2, tab3 = st.tabs([f"?? Online Modules ({len(modules)})", f"?? Assignments ({len(assignments)})", f"?? Classes ({len(classes)})"])


def render_event_card(e, idx, category):
    title = e.get('SUMMARY', 'Untitled')
    desc = e.get('DESCRIPTION', '').replace('\\n', ' ')
    dt = e['date_obj']
    is_allday = e.get('is_allday', False)
    default_dur = e.get('duration', 60)
    
    global df
    matching_rows = df[df["Item Name"] == title]
    is_scheduled = not matching_rows.empty
    is_completed = False
    g_id = ""
    cal_name = "School"
    if is_scheduled:
        is_completed = matching_rows.iloc[0]["Status"]
        g_id = str(matching_rows.iloc[0].get("Event ID", ""))
        cal_name = str(matching_rows.iloc[0].get("Calendar", "School"))
        
    card_border = neonGreen if is_scheduled else cardBorderColor
    if is_completed:
        status_badge = f'<span style="background-color: #555; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7em; margin-left: 10px;">? Completed</span>'
        card_border = "#555"
    else:
        status_badge = f'<span style="background-color: {neonGreen}; color: black; padding: 2px 6px; border-radius: 4px; font-size: 0.7em; margin-left: 10px;">Already Scheduled</span>' if is_scheduled else ''
    
    with st.container():
        st.markdown(f'''
        <div class="metric-card" style="margin-bottom: 15px; border-color: {card_border};">
            <h4 style="margin: 0; color: {cyanColor};">{title} {status_badge}</h4>
            <p style="margin: 5px 0; font-size: 0.9em; color: #aaa;">{'All Day' if is_allday else dt.strftime('%I:%M %p')} | {dt.strftime('%b %d, %Y')}</p>
            <p style="margin: 0; font-size: 0.85em;">{desc[:150] + '...' if len(desc) > 150 else desc}</p>
        </div>
        ''', unsafe_allow_html=True)
        
        if is_scheduled and not is_completed:
            if st.button("? Mark as Complete", key=f"done_{category}_{idx}", use_container_width=True):
                with st.spinner("Completing..."):
                    try:
                        # 1. Update Sheet
                        row_idx = matching_rows.index[0]
                        df.at[row_idx, "Status"] = True
                        conn.update(data=df, spreadsheet=st.secrets.connections.gsheets.mission_control_sheet)
                        
                        # 2. Update Google Task
                        if g_id and g_id not in ["None", "", "nan"]:
                            try:
                                t_id = TASKLIST_MAP.get(cal_name, "@default")
                                tasks_service.tasks().patch(tasklist=t_id, task=g_id, body={'status': 'completed'}).execute()
                            except Exception: pass
                        
                        st.cache_data.clear()
                        st.success("Completed!")
                        st.rerun()
                    except Exception as ex:
                        st.error(f"Failed: {ex}")
        elif not is_scheduled:
            with st.expander("Schedule & Add to Tasks"):

                col1, col2 = st.columns(2)
                with col1:
                    sched_date = st.date_input("Date to complete", value=dt.date(), key=f"d_{category}_{idx}")
                    sched_time = st.time_input("Start Time", value=datetime.strptime('10:00', '%H:%M').time(), key=f"t_{category}_{idx}")
                with col2:
                    duration = st.number_input("Duration (Mins)", min_value=1, max_value=600, value=max(1, default_dur), step=5, key=f"dur_{category}_{idx}")
                    cal_cat = st.selectbox("Assign to Calendar", list(CALENDAR_MAP.keys()), index=2, key=f"cal_{category}_{idx}")
                
                # --- Category Override UI ---
                uid = e.get('UID', title)
                current_cat_val = 'module' if category == 'mod' else 'assignment' if category == 'ass' else 'class'
                st.markdown("<p style='font-size:0.8em; color:#aaa; margin-bottom:2px;'>Manually override category:</p>", unsafe_allow_html=True)
                new_cat = st.selectbox("Category Override", ["module", "assignment", "class"], 
                                       index=["module", "assignment", "class"].index(current_cat_val), 
                                       key=f"ov_{uid}", label_visibility="collapsed")
                if new_cat != current_cat_val:
                    overrides[uid] = new_cat
                    save_overrides(overrides)
                    st.rerun()
                
                st.markdown("<br>", unsafe_allow_html=True)
                
                if st.button("Add to Mission Control & Calendar", key=f"add_{category}_{idx}"):

                    with st.spinner("Syncing..."):
                        try:
                            start_dt = datetime.combine(sched_date, sched_time)
                            end_dt = start_dt + timedelta(minutes=duration)
                            
                            target_cal_id = CALENDAR_MAP[cal_cat]
                            tb_body = {
                                'summary': f"?? [Task] {title}",
                                'description': desc,
                                'start': {'dateTime': start_dt.strftime('%Y-%m-%dT%H:%M:%S'), 'timeZone': 'America/New_York'},
                                'end': {'dateTime': end_dt.strftime('%Y-%m-%dT%H:%M:%S'), 'timeZone': 'America/New_York'},
                                'reminders': {'useDefault': True}
                            }
                            timeblock_id = cal_service.events().insert(calendarId=target_cal_id, body=tb_body).execute().get('id')
                            
                            target_tasklist_id = TASKLIST_MAP.get(cal_cat, "@default")
                            task_body = {
                                'title': title,
                                'notes': f"Scheduled: {start_dt.strftime('%I:%M %p')}\\n\\n{desc}",
                                'due': f"{sched_date}T00:00:00.000Z"
                            }
                            new_item_id = tasks_service.tasks().insert(tasklist=target_tasklist_id, body=task_body).execute().get('id')
                            
                            new_row = {
                                "Status": False, 
                                "Item Name": title, 
                                "Type": "Task", 
                                "Calendar": cal_cat, 
                                "Date": str(sched_date), 
                                "Time": sched_time.strftime('%H:%M'), 
                                "Duration (Mins)": duration, 
                                "Scheduled?": True, 
                                "Location": "", 
                                "Notes": desc, 
                                "Event ID": new_item_id, 
                                "Timeblock ID": timeblock_id
                            }
                            df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)
                            conn.update(data=df, spreadsheet=st.secrets.connections.gsheets.mission_control_sheet)
                            
                            st.success("Successfully scheduled!")
                            st.rerun()
                        except Exception as ex:
                            st.error(f"Failed: {ex}")

with tab1:
    for i, e in enumerate(modules): render_event_card(e, i, 'mod')
        
with tab2:
    for i, e in enumerate(assignments): render_event_card(e, i, 'ass')

with tab3:
    for i, e in enumerate(classes): render_event_card(e, i, 'cls')
