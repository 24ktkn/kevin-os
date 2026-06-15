import streamlit as st
from streamlit_gsheets import GSheetsConnection

st.title("🔌 Ultimate System Debugger")

st.write("### 1. Checking Server Memory (Secrets)")
try:
    # Safely check if secrets exist without leaking private keys
    keys = list(st.secrets.keys())
    st.write(f"✅ Secrets file found! Root categories: {keys}")
    
    if "connections" in st.secrets:
        if "gsheets" in st.secrets["connections"]:
            gsheets = st.secrets["connections"]["gsheets"]
            st.write("**Bot Email Loaded:**", gsheets.get("client_email", "❌ MISSING!"))
            st.write("**Mission Control URL Loaded:**", gsheets.get("mission_control_sheet", "❌ MISSING!"))
            st.write("**Private Key Loaded:**", "✅ YES" if "private_key" in gsheets else "❌ NO")
        else:
            st.error("❌ 'gsheets' category is missing from secrets!")
    else:
        st.error("❌ 'connections' category is missing from secrets!")
        
except Exception as e:
    st.error(f"🚨 FAILED to read secrets entirely. Check TOML formatting.")
    st.write("Error Type:", type(e).__name__)

st.write("---")
st.write("### 2. Attempting Connection")
try:
    conn = st.connection("gsheets", type=GSheetsConnection)
    sheet_url = st.secrets["connections"]["gsheets"]["mission_control_sheet"]
    df = conn.read(spreadsheet=sheet_url, ttl=0)
    
    st.success("🎉 SUCCESS! The bot is inside the Google Sheet.")
    st.dataframe(df)
    
except Exception as e:
    st.error("🚨 CONNECTION FAILED.")
    st.write("**Exact Error Type:**", type(e).__name__)
    st.write("**Computer Translation:**", repr(e))