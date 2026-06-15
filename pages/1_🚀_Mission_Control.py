import streamlit as st
import pandas as pd
from streamlit_gsheets import GSheetsConnection
import datetime

st.set_page_config(page_title="Mission Control", layout="wide")
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
            new_row = {"Status": False, "Item Name": item_name, "Type": item_type, "Calendar": calendar_cat, "Date": str(target_date), "Time": str(start_time), "Duration (Mins)": int(duration), "Scheduled?": False, "Notes": notes}
            updated_df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)
            conn.update(data=updated_df)
            st.success(f"✅ '{item_name}' added to {calendar_cat} backlog!")

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

            # Show the editor for this specific category
            st.write(f"### {category} Tasks")
            
            # The data_editor with visual organization
            edited_df = st.data_editor(
                display_df, 
                use_container_width=True, 
                hide_index=True,
                column_config={
                    "Calendar": st.column_config.SelectboxColumn(
                        "Calendar Category",
                        help="The task list this belongs to",
                        options=["Kevin Nguyen", "Family", "School", "Volunteering"],
                        required=True,
                    ),
                    "Status": st.column_config.CheckboxColumn(
                        "Done?",
                        help="Check to mark as complete",
                        default=False,
                    )
                }
            )
            
            # ... (the rest of your save button logic)

with tab3:
    st.header("Consolidated Calendar View")
    # Paste your combined embed code here
    calendar_iframe = """
    <iframe src="<iframe src="https://calendar.google.com/calendar/embed?height=600&wkst=1&ctz=America%2FToronto&showPrint=0&src=MjRrdGtuQGdtYWlsLmNvbQ&src=MGRiYzFmNDBjOWRjOTkzYzZiODkzZmEwZTE2NDZiODg4ZWI4ZWQ4NTk5NjY4Yzk2OTdkNzI2ODllMDQxZTMxNUBncm91cC5jYWxlbmRhci5nb29nbGUuY29t&src=NTdiYjhhOGJmNjFlMjMzZThiYjc2YWIwM2Y1M2IwM2VhZDM1ZTdiYTY2ZTM3ZDJiZmQ3Mzc5MmUxYzFlNTc1ZUBncm91cC5jYWxlbmRhci5nb29nbGUuY29t&src=ZmFtaWx5MDU2NjgyMjcyMTU0MjM1ODcyNTFAZ3JvdXAuY2FsZW5kYXIuZ29vZ2xlLmNvbQ&src=ZW4uY2FuYWRpYW4jaG9saWRheUBncm91cC52LmNhbGVuZGFyLmdvb2dsZS5jb20&src=YjN0ZXZkdWlvaHN1ZDVxNHJwaGlycDVpNmR1dWh1aTdAaW1wb3J0LmNhbGVuZGFyLmdvb2dsZS5jb20&color=%23039be5&color=%237986cb&color=%23a79b8e&color=%23d50000&color=%230b8043&color=%233f51b5" style="border:solid 1px #777" width="800" height="600" frameborder="0" scrolling="no"></iframe>" 
    style="border: 0" width="100%" height="600" frameborder="0" scrolling="no"></iframe>
    """
    import streamlit.components.v1 as components
    components.html(calendar_iframe, height=600)