from google.oauth2 import service_account
from googleapiclient.discovery import buildimport streamlit as st
import pandas as pd
from streamlit_gsheets import GSheetsConnection
import datetime

st.set_page_config(page_title="Mission Control", layout="wide")
# --- CALENDAR API SETUP ---
# Map your dropdown categories to the actual Google Calendar IDs
CALENDAR_MAP = {
    "Kevin Nguyen": "24ktkn@gmail.com",
    "Family": "family05668227215423587251@group.calendar.google.com",
    "School": "0dbc1f40c9dc993c6b893fa0e1646b888eb8ed8599668c9697d72689e041e315@group.calendar.google.com",
    "Volunteering": "57bb8a8bf61e233e8bb76ab03f53b03ead35e7ba66e37d2bfd73792e1c1e575e@group.calendar.google.com"
}

# Use the exact same secrets from the Google Sheets connection to authenticate the Calendar
def get_calendar_service():
    creds_info = st.secrets["connections"]["gsheets"]
    creds = service_account.Credentials.from_service_account_info(
        creds_info,
        scopes=['https://www.googleapis.com/auth/calendar']
    )
    return build('calendar', 'v3', credentials=creds)

cal_service = get_calendar_service()
st.title("🚀 Mission Control")

# Connect to Google Sheets
conn = st.connection("gsheets", type=GSheetsConnection)

# Pull data from your Mission Control sheet defined in secrets
df = conn.read(spreadsheet=st.secrets.connections.gsheets.mission_control_sheet, ttl=0)

# Ensure checkbox columns are treated as booleans
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
            start_time = st.time_input("Start Time (Leave 00:00 for flexible tasks)", datetime.time(0, 0))
            duration = st.number_input("Duration (Mins)", min_value=15, max_value=480, value=60, step=15)
        
        notes = st.text_area("Notes", placeholder="Add links or modules here...")
        if st.form_submit_button("Push to Master Tracker") and item_name:
            # 1. Prepare the Google Calendar Event Payload
            target_cal_id = CALENDAR_MAP.get(calendar_cat)
            
            # Combine Date and Time for the API
            start_dt = f"{target_date}T{start_time.strftime('%H:%M:%S')}-04:00" # Assuming EST timezone
            end_dt_obj = datetime.datetime.combine(target_date, start_time) + datetime.timedelta(minutes=int(duration))
            end_dt = f"{end_dt_obj.strftime('%Y-%m-%dT%H:%M:%S')}-04:00"

            event_body = {
                'summary': item_name,
                'description': notes,
                'start': {'dateTime': start_dt, 'timeZone': 'America/Toronto'},
                'end': {'dateTime': end_dt, 'timeZone': 'America/Toronto'},
            }

            try:
                # 2. Push to Google Calendar
                created_event = cal_service.events().insert(calendarId=target_cal_id, body=event_body).execute()
                new_event_id = created_event.get('id')
                
                # 3. Create the row for the Google Sheet (Including the new Event ID)
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
    
    # 1. Define your categories
    categories = ["All", "Kevin Nguyen", "Family", "School", "Volunteering"]
    
    # 2. Create sub-tabs for each category
    task_tabs = st.tabs(categories)
    
    # 3. Loop through categories to create a filtered view for each
    for i, category in enumerate(categories):
        with task_tabs[i]:
            # Filter the dataframe based on the category
            if category == "All":
                display_df = df.copy()
            else:
                display_df = df[df["Calendar"] == category].copy()
            
            st.write(f"### {category} Tasks")
            
            # ADD THE KEY PARAMETER HERE
            edited_df = st.data_editor(
                display_df, 
                use_container_width=True, 
                hide_index=True,
                key=f"editor_{category}", # <--- THIS IS THE FIX
                column_config={
                    "Calendar": st.column_config.SelectboxColumn(
                        "Calendar Category",
                        help="The task list this belongs to",
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
            
            # Save button for this category (also give it a unique key)
            if st.button(f"💾 Save {category} Changes", key=f"btn_{category}"):
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
    <iframe src="<iframe src="https://calendar.google.com/calendar/embed?height=600&wkst=1&ctz=America%2FToronto&showPrint=0&src=MjRrdGtuQGdtYWlsLmNvbQ&src=MGRiYzFmNDBjOWRjOTkzYzZiODkzZmEwZTE2NDZiODg4ZWI4ZWQ4NTk5NjY4Yzk2OTdkNzI2ODllMDQxZTMxNUBncm91cC5jYWxlbmRhci5nb29nbGUuY29t&src=NTdiYjhhOGJmNjFlMjMzZThiYjc2YWIwM2Y1M2IwM2VhZDM1ZTdiYTY2ZTM3ZDJiZmQ3Mzc5MmUxYzFlNTc1ZUBncm91cC5jYWxlbmRhci5nb29nbGUuY29t&src=ZmFtaWx5MDU2NjgyMjcyMTU0MjM1ODcyNTFAZ3JvdXAuY2FsZW5kYXIuZ29vZ2xlLmNvbQ&src=ZW4uY2FuYWRpYW4jaG9saWRheUBncm91cC52LmNhbGVuZGFyLmdvb2dsZS5jb20&src=YjN0ZXZkdWlvaHN1ZDVxNHJwaGlycDVpNmR1dWh1aTdAaW1wb3J0LmNhbGVuZGFyLmdvb2dsZS5jb20&color=%23039be5&color=%237986cb&color=%23a79b8e&color=%23d50000&color=%230b8043&color=%233f51b5" style="border:solid 1px #777" width="800" height="600" frameborder="0" scrolling="no"></iframe>" 
    style="border: 0" width="100%" height="600" frameborder="0" scrolling="no"></iframe>
    """
    import streamlit.components.v1 as components
    components.html(calendar_iframe, height=600)