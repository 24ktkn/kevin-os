import streamlit as st
from streamlit_gsheets import GSheetsConnection

st.title("🔌 Deep Error Diagnostic")

st.write("Checking connection...")

try:
    conn = st.connection("gsheets", type=GSheetsConnection)
    sheet_url = st.secrets.connections.gsheets.mission_control_sheet
    df = conn.read(spreadsheet=sheet_url, ttl=0)
    
    st.success("🎉 SUCCESS! The bot is inside the Google Sheet.")
    st.dataframe(df)
    
except Exception as e:
    st.error("🚨 FAILED to connect.")
    st.write("### 🛑 The Exact Reason Google Blocked It:")
    
    # This rips the hidden JSON error out of Google's response
    if hasattr(e, 'response'):
        try:
            st.json(e.response.json())
        except:
            st.write(e.response.text)
    else:
        st.write(str(e))