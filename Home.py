import streamlit as st
from streamlit_gsheets import GSheetsConnection

st.title("🔌 Final Connection Tester")

sheet_url = st.secrets.connections.gsheets.mission_control_sheet
bot_email = st.secrets.connections.gsheets.client_email

st.write("### 🔍 What the bot is seeing:")
st.write(f"**Bot Email:** `{bot_email}`")
st.write(f"**Target URL:** `{sheet_url}`")

try:
    conn = st.connection("gsheets", type=GSheetsConnection)
    df = conn.read(spreadsheet=sheet_url, ttl=0)
    
    st.success("🎉 SUCCESS! The bot is inside the Google Sheet.")
    st.dataframe(df)
    
except Exception as e:
    st.error("🚨 FAILED to connect.")
    st.write("Error Details:", e)