import streamlit as st
from streamlit_gsheets import GSheetsConnection
import pandas as pd

conn = st.connection("gsheets", type=GSheetsConnection)
df = conn.read(spreadsheet=st.secrets.connections.gsheets.mission_control_sheet, worksheet="Habits", ttl=0)
print(df.head())
print("Total rows:", len(df))
if 'Date' in df.columns:
    print("Dates:", df['Date'].tolist()[:10])
