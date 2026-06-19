import streamlit as st
import pandas as pd
import plotly.express as px
from datetime import datetime
from streamlit_gsheets import GSheetsConnection

st.set_page_config(page_title="Habit Core", layout="wide")

# --- HIGH-DENSITY COMPACT CSS ---
st.markdown("""
    <style>
    .main { background-color: #0F0F12; }
    div.stButton > button {
        padding: 4px 12px !important;
        font-size: 0.8rem !important;
        background-color: #1E1E24 !important;
        border: 1px solid #2D2D3D !important;
        border-radius: 4px !important;
    }
    .metric-card {
        background: #16161D;
        border: 1px solid #23232F;
        border-radius: 6px;
        padding: 10px;
        text-align: center;
        box-shadow: 0 2px 4px rgba(0,0,0,0.15);
    }
    .metric-val {
        font-size: 1.5rem;
        font-weight: 800;
        color: #00F0FF;
    }
    .metric-lbl {
        font-size: 0.72rem;
        color: #A0A0AB;
        text-transform: uppercase;
    }
    </style>
    """, unsafe_allow_html=True)

st.title("🏋️ Habit Core Engine")

# --- TRACKED HABITS CONFIGURATION ---
HABITS_LIST = ["Gym Workout", "Journaling", "Meditation", "Reading", "Leetcoding"]

# --- DATABASE LAYER CONNECTIONS ---
conn = st.connection("gsheets", type=GSheetsConnection)
today_str = datetime.now().strftime('%Y-%m-%d')

try:
    # Read specifically from a 'Habits' worksheet inside your master file
    df = conn.read(spreadsheet=st.secrets.connections.gsheets.mission_control_sheet, worksheet="Habits", ttl=0)
    if df is None or df.empty or "Date" not in df.columns:
        df = pd.DataFrame(columns=["Date"] + HABITS_LIST)
except Exception:
    df = pd.DataFrame(columns=["Date"] + HABITS_LIST)

# Ensure data formatting is strictly normalized
df["Date"] = df["Date"].astype(str)
for h in HABITS_LIST:
    if h not in df.columns:
        df[h] = False
    df[h] = df[h].replace({"TRUE": True, "FALSE": False, "True": True, "False": False}).fillna(False).astype(bool)

# Initialize today's row if missing
if today_str not in df["Date"].values:
    new_day = {col: (today_str if col == "Date" else False) for col in df.columns}
    df = pd.concat([df, pd.DataFrame([new_day])], ignore_index=True)
    conn.update(data=df, spreadsheet=st.secrets.connections.gsheets.mission_control_sheet, worksheet="Habits")

today_idx = df[df["Date"] == today_str].index[0]

# --- 🛰️ CROSS-TAB AUTOMATION BRIDGE ---
try:
    # Silently scan the default main worksheet ledger (Mission Control log)
    df_mission = conn.read(spreadsheet=st.secrets.connections.gsheets.mission_control_sheet, ttl=0)
    if not df_mission.empty and "Item Name" in df_mission.columns and "Status" in df_mission.columns and "Date" in df_mission.columns:
        df_mission["Status"] = df_mission["Status"].replace({"TRUE": True, "FALSE": False, "True": True, "False": False}).fillna(False).astype(bool)
        df_mission["Date"] = df_mission["Date"].astype(str)
        
        # Query for matching completed gym or workout sessions assigned to today
        todays_gym_completions = df_mission[
            (df_mission["Date"] == today_str) & 
            (df_mission["Status"] == True) & 
            (df_mission["Item Name"].str.lower().str.contains("gym", na=False) | df_mission["Item Name"].str.lower().str.contains("workout", na=False))
        ]
        
        # If completed in dashboard but still marked False in habits, auto-resolve it immediately
        if not todays_gym_completions.empty and not df.at[today_idx, "Gym Workout"]:
            df.at[today_idx, "Gym Workout"] = True
            conn.update(data=df, spreadsheet=st.secrets.connections.gsheets.mission_control_sheet, worksheet="Habits")
            st.toast("💪 Auto-Sync: Gym Workout updated based on your Mission Control Dashboard!")
except Exception:
    pass

# --- WORKSPACE TABBED LAYOUT ---
tab_log, tab_analytics = st.tabs(["🎯 Log Today's Habits", "📊 Performance Analytics"])

with tab_log:
    st.write(f"### Target Agenda: **{datetime.now().strftime('%A, %b %d')}**")
    
    cols = st.columns(len(HABITS_LIST))
    updated_values = {}
    
    for i, habit in enumerate(HABITS_LIST):
        with cols[i]:
            current_state = bool(df.at[today_idx, habit])
            updated_values[habit] = st.checkbox(habit, value=current_state, key=f"habit_{habit}")
            
    st.write(" ")
    if st.button("💾 Commit Habit Progress to Ledger", use_container_width=True):
        for habit, val in updated_values.items():
            df.at[today_idx, habit] = val
        conn.update(data=df, spreadsheet=st.secrets.connections.gsheets.mission_control_sheet, worksheet="Habits")
        st.success("✅ Cloud ledger updated successfully!")
        st.rerun()

with tab_analytics:
    st.write("### Analytics Command Center")
    
    if len(df) <= 1 and today_str in df["Date"].values:
        st.info("Analytics engine requires at least a couple days of tracking history to compute logs.")
    else:
        df_sorted = df.sort_values(by="Date", ascending=True).copy()
        
        # --- STREAK & CONSISTENCY ENGINE ---
        metric_cols = st.columns(len(HABITS_LIST))
        
        for idx, habit in enumerate(HABITS_LIST):
            streak = 0
            for val in reversed(df_sorted[habit].values):
                if val:
                    streak += 1
                else:
                    break
                    
            total_days = len(df_sorted)
            completions = df_sorted[habit].sum()
            rate = int((completions / total_days) * 100) if total_days > 0 else 0
            
            with metric_cols[idx]:
                st.markdown(f"""
                <div class="metric-card">
                    <div class="metric-lbl">{habit}</div>
                    <div class="metric-val">{streak} 🔥</div>
                    <div class="metric-lbl">Streak Count</div>
                    <div style="margin-top:4px; font-size:0.75rem; color:#00FF66; font-weight:700;">{rate}% Consistent</div>
                </div>
                """, unsafe_allow_html=True)
        
        # --- PLOTLY TIMELINE VISUALIZATION ---
        st.write("---")
        st.write("### 30-Day Completeness Velocity")
        
        melted_df = df_sorted.melt(id_vars=["Date"], value_vars=HABITS_LIST, var_name="Habit", value_name="Completed")
        melted_df = melted_df[melted_df["Completed"] == True]
        
        if not melted_df.empty:
            fig = px.bar(
                melted_df, 
                x="Date", 
                color="Habit",
                title="Daily Habit Aggregation Timeline",
                labels={"Date": "Timeline Execution", "count": "Habits Hit"},
                color_discrete_sequence=px.colors.qualitative.Pastel
            )
            fig.update_layout(
                template="plotly_dark",
                paper_bgcolor="rgba(0,0,0,0)",
                plot_bgcolor="rgba(0,0,0,0)",
                legend_title_text="Tracked Routines",
                height=350,
                margin=dict(l=20, r=20, t=40, b=20)
            )
            st.plotly_chart(fig, use_container_width=True)
        else:
            st.info("Timeline visualization will render here as soon as habits are checked off.")