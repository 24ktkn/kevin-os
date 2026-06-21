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

# --- DYNAMIC BIOMETRICS SUMMARY PANEL ---
try:
    conn = st.connection("gsheets", type=GSheetsConnection)
    raw_bio = conn.read(spreadsheet=st.secrets.connections.gsheets.workout_tracker_sheet, worksheet="health_metrics", ttl=0)
    
    # Check that Date exists
    if "Date" in raw_bio.columns:
        df_bio_clean = raw_bio[raw_bio["Date"].astype(str).str.strip() != ""].copy()
        df_bio_clean["Date"] = pd.to_datetime(df_bio_clean["Date"].astype(str).str.strip(), errors='coerce')
        df_bio_clean = df_bio_clean[df_bio_clean["Date"].notna()]
        
        if not df_bio_clean.empty:
            latest_day = df_bio_clean.sort_values(by="Date", ascending=False).iloc[0]
            latest_date_str = latest_day["Date"].strftime('%A, %b %d')
            
            # Parse values (safe check)
            steps = int(latest_day["Steps"]) if "Steps" in latest_day and pd.notna(latest_day["Steps"]) else 0
            hrv = float(latest_day["HRV"]) if "HRV" in latest_day and pd.notna(latest_day["HRV"]) else 0
            sleep = float(latest_day["Sleep Duration"]) if "Sleep Duration" in latest_day and pd.notna(latest_day["Sleep Duration"]) else 0
            rhr = float(latest_day["RHR"]) if "RHR" in latest_day and pd.notna(latest_day["RHR"]) else 0
            weight = float(latest_day["Bodyweight"]) if "Bodyweight" in latest_day and pd.notna(latest_day["Bodyweight"]) else 0

            # Render Daily Steps
            step_goal = 10000
            progress_pct = min(1.0, steps / step_goal)
            progress_pct_display = int(progress_pct * 100)
            
            st.markdown(f"### 🧬 Biometrics Command Center ({latest_date_str})")
            
            st.markdown(f"""
            <div class="status-card">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <div class="status-lbl">Daily Steps Tracker</div>
                        <div class="status-val">{steps:,} <span style="font-size: 1.1rem; color: #A0A0AB; font-weight: 500;">/ {step_goal:,} steps</span></div>
                    </div>
                    <div style="text-align:right;">
                        <div class="goal-pct">{progress_pct_display}% Goal</div>
                    </div>
                </div>
            </div>
            """, unsafe_allow_html=True)
            st.progress(progress_pct)
            
            st.write("<div style='height:12px;'></div>", unsafe_allow_html=True)
            
            # Render secondary metrics in columns
            m_col1, m_col2, m_col3, m_col4 = st.columns(4)
            
            with m_col1:
                hrv_str = f"{int(hrv)} ms" if hrv > 0 else "No data"
                st.markdown(f"""
                <div class="status-card" style="text-align:center;">
                    <div class="status-lbl">HRV (Variability)</div>
                    <div class="status-val" style="color: #00F0FF; font-size: 1.6rem;">{hrv_str}</div>
                </div>
                """, unsafe_allow_html=True)
                
            with m_col2:
                sleep_str = f"{sleep} hrs" if sleep > 0 else "No data"
                st.markdown(f"""
                <div class="status-card" style="text-align:center;">
                    <div class="status-lbl">Sleep Duration</div>
                    <div class="status-val" style="color: #FFB703; font-size: 1.6rem;">{sleep_str}</div>
                </div>
                """, unsafe_allow_html=True)
                
            with m_col3:
                rhr_str = f"{int(rhr)} bpm" if rhr > 0 else "No data"
                st.markdown(f"""
                <div class="status-card" style="text-align:center;">
                    <div class="status-lbl">Resting Heart Rate</div>
                    <div class="status-val" style="color: #FF3333; font-size: 1.6rem;">{rhr_str}</div>
                </div>
                """, unsafe_allow_html=True)
                
            with m_col4:
                weight_str = f"{weight} lbs" if weight > 0 else "No data"
                st.markdown(f"""
                <div class="status-card" style="text-align:center;">
                    <div class="status-lbl">Bodyweight</div>
                    <div class="status-val" style="color: #00FF66; font-size: 1.6rem;">{weight_str}</div>
                </div>
                """, unsafe_allow_html=True)
except Exception:
    # Fail silently to avoid breaking the Home page if the sheet connection fails
    pass

st.write(" ")
st.markdown("""
### Available Modules
* **🚀 Mission Control:** Manage your Google Calendar sync, Tasks, and master schedule.
* **🏋️ Workout Tracker:** Log your 6-day split, track cable machine sets, and monitor progress.
* **🏋️ Habit Tracker:** Track your daily habits.
* **🥗 Meal Prep:** Manage your meal prep.
""")
