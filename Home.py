import streamlit as st

st.set_page_config(page_title="Kevin's Operating System", page_icon="🧠", layout="wide")
st.title("🧠 Central Operating System")
st.write("Welcome to your unified dashboard.")
st.markdown("""
### Available Modules
* **🚀 Mission Control:** Manage your Google Calendar sync, Tasks, and master schedule.
* **🏋️ Workout Tracker:** Log your 6-day split, track cable machine sets, and monitor progress.
""")
st.write("### 🔍 Diagnostic Info")
try:
    st.write("Bot Email: ", st.secrets.connections.gsheets.client_email)
except:
    st.write("Cannot read secrets! Check your TOML formatting.")