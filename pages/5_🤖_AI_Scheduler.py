import streamlit as st
import pandas as pd
from datetime import datetime, timedelta
import json
import google.generativeai as genai
from google.oauth2 import service_account
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

st.set_page_config(page_title="AI Task Scheduler", layout="wide")

# --- CSS STYLING ---
st.markdown("""
    <style>
    .main { background-color: #0F0F12; color: #FFFFFF; }
    h1, h2, h3, p { color: #FFFFFF; }
    .stTextArea textarea { background-color: #16161D !important; color: #FFFFFF !important; border: 1px solid #23232F !important; }
    div.stButton > button { background-color: #2563EB !important; color: #FFFFFF !important; border: none !important; font-weight: bold; }
    div.stButton > button:hover { background-color: #1D4ED8 !important; }
    .undo-btn > button { background-color: #DC2626 !important; }
    .undo-btn > button:hover { background-color: #B91C1C !important; }
    </style>
""", unsafe_allow_html=True)

st.title("🤖 AI Task Auto-Scheduler")
st.markdown("Paste your unstructured tasks below. Gemini will evaluate the time required and safely slot them into today's free blocks between 8:00 AM and 10:00 PM. You can specify a calendar in your task list (e.g. 'Do laundry (Family, 30m)') and Gemini will perfectly label it!")

# --- API SETUP ---
if "GEMINI_API_KEY" in st.secrets:
    genai.configure(api_key=st.secrets["GEMINI_API_KEY"])
else:
    try:
        # Fallback in case they pasted it at the bottom of the TOML file under the gsheets section
        api_key = st.secrets["connections"]["gsheets"]["GEMINI_API_KEY"]
        genai.configure(api_key=api_key)
    except Exception:
        st.error("🔑 **Gemini API Key Not Found!**")
        st.markdown("Please open your app settings in the bottom right corner, click **Secrets**, and ensure you have `GEMINI_API_KEY = \"YOUR_KEY\"` exactly as formatted.")
        st.stop()

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

cal_service = get_calendar_service()
tasks_service = get_tasks_service()

# --- STATE MANAGEMENT ---
if "last_scheduled_ids" not in st.session_state:
    st.session_state["last_scheduled_ids"] = []

# --- FETCH SCHEDULE FOR DATE ---
def get_schedule_for_date(target_date):
    start_of_day = datetime(target_date.year, target_date.month, target_date.day, 8, 0, 0)
    end_of_day = datetime(target_date.year, target_date.month, target_date.day, 22, 0, 0)
    
    time_min = start_of_day.isoformat() + "-04:00" # EST
    time_max = end_of_day.isoformat() + "-04:00"
    
    events_list = []
    
    for cal_name, cal_id in CALENDAR_MAP.items():
        try:
            events_result = cal_service.events().list(
                calendarId=cal_id, timeMin=time_min, timeMax=time_max,
                singleEvents=True, showDeleted=False, orderBy='startTime'
            ).execute()
            
            for event in events_result.get('items', []):
                start_info = event.get('start', {})
                end_info = event.get('end', {})
                
                if 'dateTime' in start_info:
                    try:
                        start_dt = pd.to_datetime(start_info.get('dateTime')).strftime('%I:%M %p')
                        end_dt = pd.to_datetime(end_info.get('dateTime')).strftime('%I:%M %p')
                        events_list.append(f"[{cal_name}] {start_dt} - {end_dt}: {event.get('summary')}")
                    except Exception:
                        pass
        except Exception as e:
            pass
            
    return "\n".join(events_list) if events_list else f"No events scheduled on {target_date.strftime('%Y-%m-%d')} between 8 AM and 10 PM."

# --- UI ---
st.markdown("### 📝 Unstructured Tasks")

st.markdown("#### Current Tasks (@default)")
try:
    results = tasks_service.tasks().list(tasklist="@default", showCompleted=False).execute()
    items = results.get('items', [])
    current_tasks = [item.get('title', 'Untitled') for item in items]
    if current_tasks:
        for t in current_tasks:
            st.markdown(f"- 🔵 {t}")
    else:
        st.markdown("No active tasks found in your default list.")
except Exception as e:
    st.error(f"Failed to fetch current tasks: {e}")
    
st.markdown("---")


col_date, _ = st.columns([1, 2])
with col_date:
    target_date = st.date_input("Select Target Date", value=datetime.now())

tasks_input = st.text_area(
    "Enter your tasks here", 
    height=150,
    placeholder="Do laundry (Family, 30m)\nMath homework (School)\nCall mom"
)

col1, col2 = st.columns([1, 1])

with col1:
    if st.button("✨ Auto-Schedule with Gemini", use_container_width=True):
        if not tasks_input.strip():
            st.warning("Please enter some tasks.")
        else:
            with st.spinner("Gemini is analyzing your schedule..."):
                try:
                    target_date_str = target_date.strftime("%Y-%m-%d")
                    current_schedule = get_schedule_for_date(target_date)
                    
                    prompt = f"""
                    You are an expert AI assistant that optimally schedules tasks for a user's day.
                    The target date for scheduling is {target_date_str}. The user's day runs from 8:00 AM to 10:00 PM.
                    
                    Here is their current schedule for {target_date_str}:
                    {current_schedule}
                    
                    Here are the unstructured tasks they want to accomplish on this date:
                    {tasks_input}
                    
                    Your job:
                    1. Identify each distinct task.
                    2. Estimate a reasonable duration in minutes (if the user provided a recommended duration, prioritize it!).
                    3. Determine the best calendar category for the task from: ["Kevin Nguyen", "Family", "School", "Volunteering"]. If unspecified, use "Kevin Nguyen". If the user provided a label, respect it.
                    4. Find an empty time block in their current schedule between 8:00 AM and 10:00 PM that can fit the task. 
                    5. Output a JSON array containing the scheduled tasks.
                    
                    IMPORTANT: DO NOT overlap with existing events.
                    
                    Respond ONLY with a valid JSON array, no markdown blocks, no other text.
                    Format:
                    [
                      {{
                        "itemName": "Task name",
                        "calendar": "Kevin Nguyen",
                        "startTime24h": "14:30", 
                        "durationMins": 30
                      }}
                    ]
                    """
                    
                    model = genai.GenerativeModel('gemini-1.5-flash')
                    response = model.generate_content(prompt)
                    
                    # Clean markdown if present
                    json_str = response.text.replace('```json', '').replace('```', '').strip()
                    scheduled_tasks = json.loads(json_str)
                    
                    if not scheduled_tasks:
                        st.info("No tasks were scheduled.")
                    else:
                        st.session_state["last_scheduled_ids"] = []
                        
                        for task in scheduled_tasks:
                            item_name = task.get("itemName", "Untitled")
                            cal_cat = task.get("calendar", "Kevin Nguyen")
                            if cal_cat not in CALENDAR_MAP: cal_cat = "Kevin Nguyen"
                            
                            start_time_str = task.get("startTime24h", "08:00")
                            duration = int(task.get("durationMins", 30))
                            
                            target_cal_id = CALENDAR_MAP[cal_cat]
                            target_tasklist_id = TASKLIST_MAP.get(cal_cat, "@default")
                            
                            # Parse datetime
                            hour, minute = map(int, start_time_str.split(":"))
                            start_dt = datetime(target_date.year, target_date.month, target_date.day, hour, minute)
                            end_dt = start_dt + timedelta(minutes=duration)
                            
                            start_iso = start_dt.isoformat() + "-04:00"
                            end_iso = end_dt.isoformat() + "-04:00"
                            
                            # 1. Create Calendar Timeblock
                            timeblock_body = {
                                'summary': f"☑️ [Task] {item_name}",
                                'start': {'dateTime': start_iso, 'timeZone': 'America/Toronto'},
                                'end': {'dateTime': end_iso, 'timeZone': 'America/Toronto'},
                                'reminders': {'useDefault': True}
                            }
                            
                            tb_result = cal_service.events().insert(calendarId=target_cal_id, body=timeblock_body).execute()
                            tb_id = tb_result.get('id')
                            
                            # 2. Create Google Task
                            task_body = {
                                'title': item_name, 
                                'notes': f"⏰ Scheduled: {start_dt.strftime('%I:%M %p')}", 
                                'due': f"{target_date_str}T00:00:00.000Z"
                            }
                            
                            tsk_result = tasks_service.tasks().insert(tasklist=target_tasklist_id, body=task_body).execute()
                            tsk_id = tsk_result.get('id')
                            
                            st.session_state["last_scheduled_ids"].append({
                                "type": "event", "id": tb_id, "calendarId": target_cal_id
                            })
                            st.session_state["last_scheduled_ids"].append({
                                "type": "task", "id": tsk_id, "tasklistId": target_tasklist_id
                            })
                            
                            st.success(f"📅 Scheduled: **{item_name}** ({duration}m) at {start_dt.strftime('%I:%M %p')} on [{cal_cat}]")
                            
                        st.balloons()
                        st.info("Head over to the Mission Control tab to sync your new tasks into the Master Sheet!")
                        
                except Exception as e:
                    st.error(f"Failed to schedule: {str(e)}")

with col2:
    if len(st.session_state["last_scheduled_ids"]) > 0:
        st.markdown('<div class="undo-btn">', unsafe_allow_html=True)
        if st.button("↩️ Undo Last Schedule (Delete from Cloud)", use_container_width=True):
            with st.spinner("Deleting items from Google Cloud..."):
                try:
                    for item in st.session_state["last_scheduled_ids"]:
                        if item["type"] == "event":
                            cal_service.events().delete(calendarId=item["calendarId"], eventId=item["id"]).execute()
                        elif item["type"] == "task":
                            tasks_service.tasks().delete(tasklist=item["tasklistId"], task=item["id"]).execute()
                    
                    st.session_state["last_scheduled_ids"] = []
                    st.success("Successfully reverted the last schedule! All created cloud items have been deleted.")
                    st.rerun()
                except Exception as e:
                    st.error(f"Failed to undo: {str(e)}")
        st.markdown('</div>', unsafe_allow_html=True)
