import streamlit as st
from streamlit_gsheets import GSheetsConnection

st.title("🔌 Connection Tester")

try:
    conn = st.connection("gsheets", type=GSheetsConnection)
    # Pulling directly from the Mission Control URL in secrets
    df = conn.read(spreadsheet=st.secrets.connections.gsheets.mission_control_sheet, ttl=0)
    
    st.success("SUCCESS! The bot is inside the Google Sheet.")
    st.write("Here is the data it found:", df)
    
except Exception as e:
    st.error("FAILED to connect.")
    st.write("Error Details:", e)
    st.write("Email the bot is using:", st.secrets.connections.gsheets.client_email)