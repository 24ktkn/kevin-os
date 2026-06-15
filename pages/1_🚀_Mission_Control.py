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
    col1, col2 = st.columns(2)
    with col1: view_filter = st.selectbox("Filter by Calendar:", ["All", "Kevin Nguyen", "Family", "School", "Volunteering"])
    with col2: type_filter = st.selectbox("Filter by Type:", ["All", "Task", "Event"])

    filtered_df = df.copy()
    if view_filter != "All": filtered_df = filtered_df[filtered_df["Calendar"] == view_filter]
    if type_filter != "All": filtered_df = filtered_df[filtered_df["Type"] == type_filter]

    edited_df = st.data_editor(filtered_df, use_container_width=True, hide_index=True)
    if st.button("💾 Save Edits to Google Sheet"):
        df.update(edited_df)
        conn.update(data=df)
        st.success("Master database updated successfully!")

with tab3:
    st.header("Google Calendar Overview")
    st.info("Paste your Google Calendar iframe embed link in the code to see it here.")