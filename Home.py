import streamlit as st
import pandas as pd
import datetime
from streamlit_gsheets import GSheetsConnection

st.set_page_config(page_title="Kevin's Operating System", page_icon="🧠", layout="wide")

# --- HIGH-DENSITY COMPACT CSS ---
st.markdown("""
    <style>
    .main { background-color: #0F0F12; }
    
    /* Premium Stat Card */
    .status-card {
        background: #16161D;
        border: 1px solid #23232F;
        border-radius: 8px;
        padding: 16px;
        box-shadow: 0 4px 6px rgba(0,0,0,0.2);
        margin-bottom: 8px;
    }
    .status-val {
        font-size: 2.0rem;
        font-weight: 800;
        color: #00FF66;
        line-height: 1.1;
    }
    .status-lbl {
        font-size: 0.8rem;
        color: #A0A0AB;
        text-transform: uppercase;
        font-weight: 700;
        margin-bottom: 6px;
    }
    .goal-pct {
        font-size: 1.3rem;
        font-weight: 800;
        color: #00F0FF;
    }
    </style>
    """, unsafe_allow_html=True)

st.title("🧠 Central Operating System")
st.write("Welcome to your unified dashboard.")

# --- DYNAMIC BIOMETRICS SIDEBAR / SUMMARY CARD ---
try:
    conn = st.connection("gsheets", type=GSheetsConnection)
    raw_bio = conn.read(spreadsheet=st.secrets.connections.gsheets.workout_tracker_sheet, worksheet="health_metrics", ttl=0)
    
    # Check that required columns exist
    if "Date" in raw_bio.columns and "Steps" in raw_bio.columns:
        df_bio_clean = raw_bio[raw_bio["Date"].astype(str).str.strip() != ""].copy()
        df_bio_clean["Date"] = pd.to_datetime(df_bio_clean["Date"].astype(str).str.strip(), errors='coerce')
        df_bio_clean = df_bio_clean[df_bio_clean["Date"].notna()]
        
        if not df_bio_clean.empty:
            latest_day = df_bio_clean.sort_values(by="Date", ascending=False).iloc[0]
            steps = int(latest_day["Steps"])
            latest_date_str = latest_day["Date"].strftime('%A, %b %d')
            
            step_goal = 10000
            progress_pct = min(1.0, steps / step_goal)
            progress_pct_display = int(progress_pct * 100)
            
            st.markdown(f"""
            <div class="status-card">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div class="status-lbl">Daily Steps Tracker — {latest_date_str}</div>
                        <div class="status-val">{steps:,} <span style="font-size: 1.2rem; color: #A0A0AB; font-weight: 500;">/ {step_goal:,} steps</span></div>
                    </div>
                    <div style="text-align:right;">
                        <div class="goal-pct">{progress_pct_display}% Goal</div>
                    </div>
                </div>
            </div>
            """, unsafe_allow_html=True)
            st.progress(progress_pct)
except Exception:
    # Fail silently to avoid breaking the Home page if the sheet connection fails or is empty
    pass

st.write(" ")
st.markdown("""
### Available Modules
* **🚀 Mission Control:** Manage your Google Calendar sync, Tasks, and master schedule.
* **🏋️ Workout Tracker:** Log your 6-day split, track cable machine sets, and monitor progress.
* **🏋️ Habit Tracker:** Track your daily habits.
* **🥗 Meal Prep:** Manage your meal prep.
""")
