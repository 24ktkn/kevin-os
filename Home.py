import streamlit as st

st.set_page_config(page_title="Kevin's Operating System", page_icon="🧠", layout="wide")
st.title("🧠 Central Operating System")
st.write("Welcome to your unified dashboard.")
st.markdown("""
### Available Modules
* **🚀 Mission Control:** Manage your Google Calendar sync, Tasks, and master schedule.
* **🏋️ Workout Tracker:** Log your 6-day split, track cable machine sets, and monitor progress.
""")

# ==========================================
# TEMPORARY CODE: RUN ONCE TO FIND TASK LIST IDs
# ==========================================
st.write("### 🔍 Your Google Task List IDs")
try:
    lists_result = tasks_service.tasklists().list().execute()
    tasklists = lists_result.get('items', [])
    
    for tl in tasklists:
        st.code(f"Title: {tl['title']} | ID: {tl['id']}")
except Exception as e:
    st.error(f"Could not fetch task lists: {e}")
# ==========================================