import streamlit as st
import pandas as pd
import plotly.express as px
import datetime
from zoneinfo import ZoneInfo
from streamlit_gsheets import GSheetsConnection

# --- APP CONFIGURATION ---
st.set_page_config(page_title="Custom PPL Fitness Tracker", layout="wide", initial_sidebar_state="expanded")

st.markdown("""
    <style>
    .main { background-color: #121212; color: #FFFFFF; }
    div.stButton > button:first-child { background-color: #00CC66; color: white; border-radius: 8px; font-weight: bold; }
    
    /* Premium Stat Cards */
    .stat-card {
        background: #16161D;
        border: 1px solid #23232F;
        border-radius: 6px;
        padding: 12px;
        text-align: center;
        box-shadow: 0 4px 6px rgba(0,0,0,0.2);
    }
    .stat-val {
        font-size: 1.6rem;
        font-weight: 800;
        color: #00CC66;
        line-height: 1.2;
    }
    .stat-lbl {
        font-size: 0.75rem;
        color: #A0A0AB;
        text-transform: uppercase;
        font-weight: 700;
        margin-top: 4px;
    }
    
    /* Muscle Recovery Grid System */
    .muscle-box {
        background: #1A1A24;
        border: 1px solid #2D2D3D;
        border-radius: 6px;
        padding: 10px;
        margin-bottom: 6px;
    }
    .status-fresh { border-left: 5px solid #00FF66; }
    .status-recovering { border-left: 5px solid #FFA500; }
    .status-fatigued { border-left: 5px solid #FF3333; }
    </style>
    """, unsafe_allow_html=True)

# --- GOOGLE SHEETS CONNECTION ---
conn = st.connection("gsheets", type=GSheetsConnection)

# --- ENGINE 1: WORKOUT LOGS LOCAL MEMORY CACHE ---
if "master_workout_df" not in st.session_state:
    raw_df = conn.read(spreadsheet=st.secrets.connections.gsheets.workout_tracker_sheet, worksheet="workout_logs", ttl=0)
    required_cols = ["Date", "Split Day", "Exercise", "Set Number", "Weight (lbs)", "Reps", "Estimated 1RM", "Timestamp", "Duration (Mins)"]
    for col in required_cols:
        if col not in raw_df.columns: raw_df[col] = ""
        
    df_logs = raw_df[raw_df["Exercise"].astype(str).str.strip() != ""].copy()
    df_logs["Weight (lbs)"] = pd.to_numeric(df_logs["Weight (lbs)"], errors='coerce').fillna(0.0)
    df_logs["Reps"] = pd.to_numeric(df_logs["Reps"], errors='coerce').fillna(0).astype(int)
    df_logs["Estimated 1RM"] = pd.to_numeric(df_logs["Estimated 1RM"], errors='coerce').fillna(0.0)
    df_logs["Duration (Mins)"] = pd.to_numeric(df_logs["Duration (Mins)"], errors='coerce').fillna(0.0)
    df_logs["Date"] = pd.to_datetime(df_logs["Date"].astype(str).str.strip(), errors='coerce')
    df_logs = df_logs[df_logs["Date"].notna()]
    
    # 🩹 AUTOMATIC DATABASE HEALER ENGINE
    # Automatically fixes rows with corrupted set numbers by sorting chronologically
    # and re-indexing sequences per day/exercise block.
    if not df_logs.empty:
        df_logs = df_logs.sort_values(by=["Date", "Timestamp"]).reset_index(drop=True)
        df_logs["Set Number"] = df_logs.groupby(["Date", "Exercise"]).cumcount() + 1
        
    st.session_state.master_workout_df = df_logs

df_logs = st.session_state.master_workout_df

# --- ENGINE 2: BIOMETRICS LOCAL MEMORY CACHE ---
if "master_bio_df" not in st.session_state:
    try:
        raw_bio = conn.read(spreadsheet=st.secrets.connections.gsheets.workout_tracker_sheet, worksheet="health_metrics", ttl=0)
        for col in ["Date", "HRV", "Sleep Duration", "RHR", "Steps", "Bodyweight"]:
            if col not in raw_bio.columns: raw_bio[col] = ""
        df_bio_clean = raw_bio[raw_bio["Date"].astype(str).str.strip() != ""].copy()
        df_bio_clean["Date"] = pd.to_datetime(df_bio_clean["Date"].astype(str).str.strip(), errors='coerce')
        df_bio_clean = df_bio_clean[df_bio_clean["Date"].notna()]
        df_bio_clean["Bodyweight"] = pd.to_numeric(df_bio_clean["Bodyweight"], errors='coerce').fillna(0.0)
        st.session_state.master_bio_df = df_bio_clean
    except Exception:
        st.session_state.master_bio_df = pd.DataFrame(columns=["Date", "HRV", "Sleep Duration", "RHR", "Steps", "Bodyweight"])

df_bio = st.session_state.master_bio_df
if "Bodyweight" not in df_bio.columns:
    df_bio["Bodyweight"] = 0.0
df_bio["Bodyweight"] = pd.to_numeric(df_bio["Bodyweight"], errors='coerce').fillna(0.0)

# --- REUSABLE BODYWEIGHT TRACKER WIDGET ---
def render_bodyweight_tracker(key_prefix):
    latest_bw = 170.0
    if not df_bio.empty and "Bodyweight" in df_bio.columns:
        valid_bw = df_bio[df_bio["Bodyweight"] > 0]
        if not valid_bw.empty:
            latest_bw = float(valid_bw.sort_values(by="Date", ascending=False).iloc[0]["Bodyweight"])
            
    st.markdown(f"##### ⚖️ Bodyweight Tracker (Current Baseline: **{latest_bw} lbs**)")
    bw_col1, bw_col2 = st.columns([3, 1])
    with bw_col1:
        new_bw = st.number_input("Log current weight (lbs):", min_value=50.0, max_value=500.0, value=latest_bw, step=0.5, key=f"{key_prefix}_bw_input")
    with bw_col2:
        st.write("<div style='height:28px;'></div>", unsafe_allow_html=True) # spacing
        if st.button("Log Weight", key=f"{key_prefix}_bw_btn"):
            today_dt = pd.to_datetime(datetime.date.today())
            df_bio_copy = df_bio.copy()
            df_bio_copy["Date"] = pd.to_datetime(df_bio_copy["Date"])
            
            # Check if today's date already exists
            matching_idx = df_bio_copy[df_bio_copy["Date"].dt.date == today_dt.date()]
            if not matching_idx.empty:
                idx = matching_idx.index[0]
                df_bio_copy.at[idx, "Bodyweight"] = new_bw
            else:
                new_row = {
                    "Date": today_dt,
                    "HRV": 0,
                    "Sleep Duration": 0.0,
                    "RHR": 0,
                    "Steps": 0,
                    "Bodyweight": new_bw
                }
                df_bio_copy = pd.concat([df_bio_copy, pd.DataFrame([new_row])], ignore_index=True)
            
            # Push to sheet
            push_bio = df_bio_copy.copy()
            push_bio["Date"] = push_bio["Date"].dt.strftime('%Y-%m-%d')
            try:
                conn.update(data=push_bio, spreadsheet=st.secrets.connections.gsheets.workout_tracker_sheet, worksheet="health_metrics")
                st.cache_data.clear()
                st.session_state.master_bio_df = df_bio_copy
                st.success(f"Logged bodyweight: {new_bw} lbs!")
                st.rerun()
            except Exception as e:
                st.error(f"Failed to log weight: {e}")


# --- MASTER EXERCISE DICTIONARY ---
exercises_dict = {
    "Push (Chest/Shoulders/Triceps)": ["Bench Press (Dumbbell)", "Bench Press (Barbell)", "Lateral Raise (Cable)", "Overhead Press (Dumbbell)", "Triceps Extension (Cable)"],
    "Pull (Back/Biceps)": ["Pull Up", "Bent Over Row (Barbell)", "Face Pull", "Seated Incline Curl (Dumbbell)", "Hammer Curl (Dumbbell)"],
    "Legs & Abs (Thigh/Calf Focus)": ["Squat (Barbell)", "Bulgarian Split Squat", "Romanian Deadlift (Barbell)", "Standing Calf Raise (Dumbbell)", "Hanging Knee Raise", "Cable Twist (Up to down)"],
    "Cardio (Treadmill)": ["Treadmill Steady State", "Treadmill Intervals"]
}

# --- CLEAN OVERHEAD SIDEBAR ---
with st.sidebar:
    st.markdown("### 🛰️ System Control Panel")
    st.info("Manual logging disabled. Application is running in 100% Autonomous Hevy Cloud-Sync Mode.")

# --- MAIN DASHBOARD INTERFACE ---
tab1, tab2, tab3, tab4, tab5 = st.tabs(["📋 Exercise Guide & Target Weights", "📈 Premium Analytics Suite", "📜 Session History Ledger", "⏱️ Rest Interval Pacer", "❤️ Recovery & Readiness"])

with tab1:
    st.markdown("### Your Active Hevy-Synced Target Guidelines")
    render_bodyweight_tracker("tab1")
    st.markdown("---")
    if st.button("🔄 Force Cloud Sync (Pull latest from Sheet)"):
        st.cache_data.clear()
        if "master_workout_df" in st.session_state: del st.session_state["master_workout_df"]
        if "master_bio_df" in st.session_state: del st.session_state["master_bio_df"]
        st.rerun()

    for split, exercises in exercises_dict.items():
        with st.expander(f"➔ {split}", expanded=True):
            guide_data = []
            for exe in exercises:
                last_weight_str, last_reps_str, last_date_str = "No history", "Clear to start", "-"
                
                if not df_logs.empty:
                    exe_clean = exe.lower().strip()
                    exe_history = df_logs[df_logs["Exercise"].str.lower().str.strip() == exe_clean].sort_values(by="Date", ascending=False)
                    
                    if exe_history.empty:
                        # Fallback for known synonym naming mismatches
                        synonyms = {
                            "incline bicep curl": "seated incline curl",
                            "seated incline curl": "incline bicep curl"
                        }
                        for k, v in synonyms.items():
                            if k in exe_clean:
                                exe_history = df_logs[df_logs["Exercise"].str.lower().str.contains(v, na=False)].sort_values(by="Date", ascending=False)
                                break
                    
                    if exe_history.empty:
                        core_keyword = exe_clean.split('(')[0].strip()
                        exe_history = df_logs[df_logs["Exercise"].str.lower().str.contains(core_keyword, na=False)].sort_values(by="Date", ascending=False)
                    
                    if not exe_history.empty:
                        last_session = exe_history.iloc[0]
                        is_cardio = "cardio" in split.lower() or any(x in exe_clean for x in ["treadmill", "run", "walk", "bike", "cycle", "cycling", "elliptical", "rower", "spin"])
                        is_bodyweight = not is_cardio and (any(x in exe_clean for x in ["pull up", "pull-up", "chin up", "chin-up", "knee raise", "leg raise", "push up", "pushup", "dip", "bodyweight", "body weight", "plank", "sit up", "situp", "crunch", "ab wheel"]) or last_session['Weight (lbs)'] == 0)
                        
                        if is_cardio:
                            last_weight_str = "Cardio Session"
                            last_reps_str = f"{int(last_session['Reps'])} mins" if last_session['Reps'] > 0 else (f"{last_session['Duration (Mins)']} mins" if last_session['Duration (Mins)'] > 0 else "0 mins")
                        elif is_bodyweight:
                            last_weight_str = "Bodyweight"
                            last_reps_str = f"{int(last_session['Reps'])} reps"
                        else:
                            last_weight_str = f"**{last_session['Weight (lbs)']} lbs**"
                            last_reps_str = f"{int(last_session['Reps'])} reps"
                        
                        last_date_str = last_session['Date'].strftime('%b %d, %Y')
                
                target_range = "3 Sets x 10-12 Reps (60s rest)" if ("raise" in exe.lower() or "curl" in exe.lower() or "extension" in exe.lower() or "twist" in exe.lower()) else ("3 Sets x 8-12 Reps (90s rest)" if ("squat" in exe.lower() or "press" in exe.lower() or "row" in exe.lower() or "deadlift" in exe.lower() or "romanian" in exe.lower()) else ("45-60 Mins (Treadmill)" if "cardio" in split.lower() else "3 Sets x AMRAP (90s rest)"))
                guide_data.append({"Exercise Name": exe, "Target Progression Protocol": target_range, "Last Weight Used": last_weight_str, "Last Reps/Duration": last_reps_str, "Last Workout Date": last_date_str})
            st.write(pd.DataFrame(guide_data).to_html(escape=False, index=False), unsafe_allow_html=True)

with tab2:
    st.markdown("### 📊 Hevy & LifeApp Unified Analytics Engine")
    render_bodyweight_tracker("tab2")
    st.markdown("---")
    if df_logs.empty:
        st.info("Ingest training sessions using the uploader tab to build visual aggregates.")
    else:
        df_analytics = df_logs.copy()
        
        # Resolve bodyweight per date
        def get_bodyweight_for_date(d):
            if df_bio.empty or "Bodyweight" not in df_bio.columns:
                return 170.0
            # Find matching or closest prior date in df_bio
            matching = df_bio[df_bio["Date"] <= d]
            if not matching.empty:
                val = matching.sort_values(by="Date", ascending=False).iloc[0]["Bodyweight"]
                try:
                    val_f = float(val)
                    if val_f > 0: return val_f
                except:
                    pass
            # Fallback to latest overall logged bodyweight
            all_valid = df_bio[pd.to_numeric(df_bio["Bodyweight"], errors='coerce').fillna(0) > 0] if "Bodyweight" in df_bio.columns else pd.DataFrame()
            if not all_valid.empty:
                return float(all_valid.sort_values(by="Date", ascending=False).iloc[0]["Bodyweight"])
            return 170.0

        df_analytics["User Bodyweight"] = df_analytics["Date"].apply(get_bodyweight_for_date)
        
        def calculate_effective_volume(row):
            exe = str(row["Exercise"]).lower().strip()
            is_cardio = "cardio" in exe or any(x in exe for x in ["treadmill", "run", "walk", "bike", "cycle", "cycling", "elliptical", "rower", "spin"])
            if is_cardio:
                return 0.0
            
            weight = float(row["Weight (lbs)"])
            reps = int(row["Reps"])
            is_bodyweight = (any(x in exe for x in ["pull up", "pull-up", "chin up", "chin-up", "knee raise", "leg raise", "push up", "pushup", "dip", "bodyweight", "body weight", "plank", "sit up", "situp", "crunch", "ab wheel"]) or weight == 0)
            
            if is_bodyweight:
                effective_weight = row["User Bodyweight"]
            else:
                effective_weight = weight
            return effective_weight * reps

        df_analytics["Volume"] = df_analytics.apply(calculate_effective_volume, axis=1)
        df_analytics["Month_Year"] = df_analytics["Date"].dt.strftime('%b %Y')
        df_analytics["Year_Week"] = df_analytics["Date"].dt.strftime('%Y-W%U')
        
        def resolve_anatomy(row):
            exe = str(row["Exercise"]).lower().strip()
            if any(x in exe for x in ["knee raise", "ab ", "ab,", "crunch", "woodchopper", "twist", "plank", "leg raise"]): return "Abs/Core"
            if any(x in exe for x in ["squat", "leg press", "lunge", "quad", "leg extension"]): 
                if "tricep" in exe: return "Triceps"
                return "Quads"
            if any(x in exe for x in ["rdl", "romanian", "leg curl", "hamstring", "glute", "hip thrust"]):
                if "bicep" in exe or "hammer" in exe: return "Biceps"
                return "Hamstrings & Glutes"
            if "calf" in exe or "calves" in exe: return "Calves"
            if any(x in exe for x in ["bench", "fly", "pushup", "chest", "pec"]): return "Chest"
            if any(x in exe for x in ["lateral raise", "overhead press", "shoulder", "delt", "face pull", "military"]): return "Shoulders"
            if "tricep" in exe or "kickback" in exe or "pushdown" in exe: return "Triceps"
            if any(x in exe for x in ["pull-up", "row", "lat", "chin-up", "back", "deadlift"]): return "Back"
            if "bicep" in exe or "curl" in exe or "hammer" in exe: return "Biceps"
            if any(x in exe for x in ["treadmill", "run", "walk", "bike", "cardio"]): return "Cardio"
            
            split = str(row["Split Day"]).lower().strip()
            if "push" in split: return "Chest"
            if "pull" in split: return "Back"
            if "leg" in split: return "Quads"
            if "cardio" in split: return "Cardio"
            return "Other"

        df_analytics["Individual Muscle Target"] = df_analytics.apply(resolve_anatomy, axis=1)
        
        if "Duration (Mins)" in df_analytics.columns:
            df_unique_workouts = df_analytics.groupby(["Date", "Timestamp", "Split Day"])["Duration (Mins)"].max().reset_index()
            total_gym_minutes = int(df_unique_workouts["Duration (Mins)"].sum())
        else:
            total_gym_minutes = 0

        total_volume_moved = int(df_analytics["Volume"].sum())
        total_workouts_logged = int(df_analytics["Date"].dt.date.nunique())

        m_col1, m_col2, m_col3, m_col4 = st.columns(4)
        with m_col1: st.markdown(f'<div class="stat-card"><div class="stat-val">{total_workouts_logged}</div><div class="stat-lbl">Total Workouts Logged</div></div>', unsafe_allow_html=True)
        with m_col2: st.markdown(f'<div class="stat-card"><div class="stat-val">{total_gym_minutes // 60}h {total_gym_minutes % 60}m</div><div class="stat-lbl">Time Invested in Gym</div></div>', unsafe_allow_html=True)
        with m_col3: st.markdown(f'<div class="stat-card"><div class="stat-val">{total_volume_moved:,} lbs</div><div class="stat-lbl">Hevy Total Volume Moved</div></div>', unsafe_allow_html=True)
        with m_col4: st.markdown(f'<div class="stat-card"><div class="stat-val">{df_analytics["Exercise"].nunique()}</div><div class="stat-lbl">Exercises Tracked</div></div>', unsafe_allow_html=True)

        st.write(" ")
        left_panel, right_panel = st.columns([3, 2])
        
        with left_panel:
            st.markdown("#### 📈 Frequency Metrics & Mass Tonnage Load Graph")
            monthly_frequency = df_analytics.groupby("Month_Year")["Date"].nunique().reset_index(name="Sessions Completed")
            fig_freq = px.bar(monthly_frequency, x="Month_Year", y="Sessions Completed", title="Monthly Gym Visit Volumes", text_auto=True)
            fig_freq.update_traces(marker_color='#00CC66').update_layout(template="plotly_dark", paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)")
            st.plotly_chart(fig_freq, use_container_width=True)
            
            weekly_volume = df_analytics.groupby("Year_Week")["Volume"].sum().reset_index(name="Weekly Mass (lbs)")
            fig_vol = px.line(weekly_volume, x="Year_Week", y="Weekly Mass (lbs)", title="Weekly Load Progression Trend (Total Volume)", markers=True)
            fig_vol.update_traces(line_color='#00F0FF', marker=dict(size=6)).update_layout(template="plotly_dark", paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)")
            st.plotly_chart(fig_vol, use_container_width=True)
            
            st.markdown("#### 🏆 Strongest Lifts (Hevy Personal Records Record)")
            pr_df = df_analytics.groupby("Exercise").agg({"Weight (lbs)": "max", "Estimated 1RM": "max"}).reset_index()
            pr_df = pr_df[pr_df["Estimated 1RM"] > 0].sort_values(by="Estimated 1RM", ascending=False).rename(columns={"Exercise": "Exercise Name", "Weight (lbs)": "Heaviest Working Weight", "Estimated 1RM": "Peak Predicted 1RM"})
            st.dataframe(pr_df, use_container_width=True, hide_index=True)

        with right_panel:
            st.markdown("#### 🧬 Premium Muscle Recovery Matrix")
            st.caption("Tracks fatigue windows for individual muscle types (48-hour localized muscular cell optimization windows).")
            
            right_now = datetime.datetime.now(ZoneInfo("America/Toronto"))
            muscle_targets = ["Chest", "Shoulders", "Triceps", "Back", "Biceps", "Quads", "Hamstrings & Glutes", "Calves", "Abs/Core"]
            
            for muscle in muscle_targets:
                matching_logs = df_analytics[df_analytics["Individual Muscle Target"] == muscle]
                if matching_logs.empty:
                    hours_since = 999
                    last_trained_str = "No record found"
                else:
                    latest_entry_date = matching_logs["Date"].max()
                    time_delta = right_now - latest_entry_date.replace(tzinfo=ZoneInfo("America/Toronto"))
                    hours_since = max(0, int(time_delta.total_seconds() / 3600))
                    last_trained_str = f"Last hit: {latest_entry_date.strftime('%a, %b %d')}"
                
                if hours_since >= 48: status_lbl, status_css, rec_pct = "Optimized (100% Repaired)", "status-fresh", 100
                elif hours_since >= 24: status_lbl, status_css, rec_pct = f"Rebuilding ({int((hours_since/48)*100)}%)", "status-recovering", int((hours_since/48)*100)
                else: status_lbl, status_css, rec_pct = f"Fatigued ({int((hours_since/48)*100)}%)", "status-fatigued", max(5, int((hours_since/48)*100))
                
                st.markdown(f"""
                <div class="muscle-box {status_css}">
                    <div style="display:flex; justify-content:between; align-items:center;">
                        <span style="font-weight:700; font-size:0.95rem; color:#FFFFFF; width:60%;">{muscle}</span>
                        <span style="font-size:0.75rem; font-weight:700; text-align:right; width:40%; color:#A0A0AB;">{last_trained_str}</span>
                    </div>
                    <div style="font-size:0.8rem; font-weight:600; margin-top:2px; color:#E4E4E7;">Status: {status_lbl}</div>
                    <div style="background-color:#2A2A35; border-radius:4px; height:6px; margin-top:6px; width:100%;">
                        <div style="background-color:{'#00FF66' if rec_pct==100 else ('#FFA500' if rec_pct>=50 else '#FF3333')}; width:{rec_pct}%; height:6px; border-radius:4px;"></div>
                    </div>
                </div>
                """, unsafe_allow_html=True)
                
            st.markdown("<br>#### 🎯 Granular Muscular Volume Distribution Spread", unsafe_allow_html=True)
            split_volume = df_analytics[df_analytics["Individual Muscle Target"] != "Cardio"].groupby("Individual Muscle Target")["Volume"].sum().reset_index(name="Total Tonnage Volume")
            fig_pie = px.pie(split_volume, values="Total Tonnage Volume", names="Individual Muscle Target", hole=0.4, color_discrete_sequence=px.colors.qualitative.Pastel)
            fig_pie.update_layout(template="plotly_dark", paper_bgcolor="rgba(0,0,0,0)", showlegend=True, margin=dict(l=10, r=10, t=10, b=10), height=260)
            st.plotly_chart(fig_pie, use_container_width=True)

        st.write("---")
        st.markdown("#### 🔍 Micro Exercise Progression Overlays")
        selected_chart_exe = st.selectbox("Select Target Exercise to Plot Progression Path", sorted(df_analytics["Exercise"].dropna().unique()))
        filtered_df = df_analytics[df_analytics["Exercise"] == selected_chart_exe].sort_values(by="Date")
        if not filtered_df.empty:
            exe_name_lower = selected_chart_exe.lower()
            is_cardio = "cardio" in exe_name_lower or any(x in exe_name_lower for x in ["treadmill", "run", "walk", "bike", "cycle", "cycling", "elliptical", "rower", "spin"])
            is_bodyweight = not is_cardio and (any(x in exe_name_lower for x in ["pull up", "pull-up", "chin up", "chin-up", "knee raise", "leg raise", "push up", "pushup", "dip", "bodyweight", "body weight", "plank", "sit up", "situp", "crunch", "ab wheel"]) or filtered_df["Weight (lbs)"].max() == 0)
            
            if is_cardio:
                y_axis = "Duration (Mins)" if filtered_df["Duration (Mins)"].max() > 0 else "Reps"
                lbl = "Duration (Mins)" if y_axis == "Duration (Mins)" else "Minutes / Reps"
            elif is_bodyweight:
                y_axis = "Reps"
                lbl = "Reps Completed"
            else:
                y_axis = "Estimated 1RM"
                lbl = "Estimated 1RM (lbs)"
                
            fig_micro = px.line(filtered_df, x="Date", y=y_axis, markers=True, title=f"Progression Tracking: {selected_chart_exe}", labels={y_axis: lbl})
            fig_micro.update_traces(line_color='#00CC66', marker=dict(size=8)).update_layout(template="plotly_dark")
            st.plotly_chart(fig_micro, use_container_width=True)

with tab3:
    st.markdown("### Cloud Sync Master Ledger")
    with st.expander("📥 Bulk Import Workouts from Hevy App CSV", expanded=False):
        uploaded_hevy_file = st.file_uploader("Drop Hevy CSV File Here", type=["csv"], key="hevy_importer_zone")
        if uploaded_hevy_file is not None:
            try:
                df_hevy = pd.read_csv(uploaded_hevy_file)
                df_hevy.columns = df_hevy.columns.str.strip().str.lower()
                h_date, h_exe, h_weight, h_reps, h_set, h_title = next((c for c in df_hevy.columns if "start" in c or "date" in c), None), next((c for c in df_hevy.columns if "exercise" in c), None), next((c for c in df_hevy.columns if "weight" in c), None), next((c for c in df_hevy.columns if "reps" in c), None), next((c for c in df_hevy.columns if "set" in c and "type" not in c), None), next((c for c in df_hevy.columns if "title" in c or "workout" in c), None)
                
                h_start = next((c for c in df_hevy.columns if "start_time" in c or "start" in c), None)
                h_end = next((c for c in df_hevy.columns if "end_time" in c or "end" in c), None)
                
                if h_date and h_exe and h_weight and h_reps:
                    df_hevy[h_weight] = pd.to_numeric(df_hevy[h_weight], errors='coerce').fillna(0.0)
                    df_hevy[h_reps] = pd.to_numeric(df_hevy[h_reps], errors='coerce').fillna(0).astype(int)
                    
                    if h_start and h_end:
                        df_hevy[h_start] = pd.to_datetime(df_hevy[h_start], errors='coerce')
                        df_hevy[h_end] = pd.to_datetime(df_hevy[h_end], errors='coerce')
                        df_hevy['computed_dur'] = (df_hevy[h_end] - df_hevy[h_start]).dt.total_seconds() / 60.0
                        df_hevy['computed_dur'] = df_hevy['computed_dur'].fillna(60.0).round(1)
                    
                    # 🛠️ AUTONOMOUS SET COUNT GENERATOR
                    # Completely bypasses hardcoded text columns to evaluate set progression lines by appearance
                    df_hevy['computed_set_num'] = df_hevy.groupby([h_date, h_exe]).cumcount() + 1
                    
                    parsed_rows = []
                    for _, row in df_hevy.iterrows():
                        raw_dt = pd.to_datetime(row[h_date], errors='coerce')
                        if pd.isna(raw_dt): continue
                        
                        w_val = float(row[h_weight])
                        r_val = int(row[h_reps])
                        s_val = int(row['computed_set_num'])
                        dur_val = float(row['computed_dur']) if 'computed_dur' in df_hevy.columns else 60.0
                        
                        if dur_val > 240: dur_val = round(dur_val / 60.0, 1)
                        
                        est_1rm = round(w_val * (1 + (r_val / 30.0)), 1) if r_val > 1 else w_val
                        parsed_rows.append({"Date": raw_dt, "Split Day": str(row[h_title]).strip() if h_title and pd.notna(row[h_title]) else "Hevy Import", "Exercise": str(row[h_exe]).strip() if h_exe else "Unknown", "Set Number": s_val, "Weight (lbs)": w_val, "Reps": r_val, "Estimated 1RM": est_1rm, "Timestamp": raw_dt.strftime("%H:%M:%S"), "Duration (Mins)": dur_val})
                    
                    hevy_parsed_df = pd.DataFrame(parsed_rows)
                    
                    # --- 🛡️ COMPOSITE MATRIX DEDUPLICATION ENGINE ---
                    combined_df = pd.concat([df_logs, hevy_parsed_df], ignore_index=True)
                    combined_df["Date"] = pd.to_datetime(combined_df["Date"])
                    combined_df["Exercise"] = combined_df["Exercise"].astype(str).str.strip()
                    combined_df["Set Number"] = combined_df["Set Number"].astype(int)
                    
                    deduped_df = combined_df.drop_duplicates(subset=["Date", "Exercise", "Set Number"], keep="first").reset_index(drop=True)
                    new_rows_discovered = len(deduped_df) - len(df_logs)
                    
                    st.success(f"Processed CSV! Found {len(hevy_parsed_df)} parsed sets. ({new_rows_discovered} are brand-new additions).")
                    st.dataframe(hevy_parsed_df, use_container_width=True)
                    
                    if new_rows_discovered > 0:
                        if st.button("🔥 Append All Hevy Data & Push to Cloud Sheet"):
                            push_df = deduped_df.copy()
                            push_df["Date"] = push_df["Date"].dt.strftime('%Y-%m-%d')
                            conn.update(data=push_df, spreadsheet=st.secrets.connections.gsheets.workout_tracker_sheet, worksheet="workout_logs")
                            st.cache_data.clear()
                            st.session_state.master_workout_df = deduped_df
                            st.success(f"✅ Injected {new_rows_discovered} brand-new rows! Duplicates ignored.")
                            st.rerun()
                    else:
                        st.warning("⚡ All workouts inside this file have already been permanently saved to your sheet database.")
            except Exception as e: st.error(f"Error: {e}")
    
    st.markdown("---")
    if not df_logs.empty:
        display_ledger = df_logs.copy()
        display_ledger['Date'] = pd.to_datetime(display_ledger['Date']).dt.date
        display_ledger["🗑️ Delete?"] = False
        
        # 📐 UNIFIED GROUPED SORT ENGINE
        # Groups matching exercises together for that day, sorted numerically by set sequence
        display_ledger = display_ledger.sort_values(by=["Date", "Exercise", "Set Number"], ascending=[False, True, True])
        edited_ledger = st.data_editor(display_ledger, use_container_width=True, hide_index=True, column_config={"🗑️ Delete?": st.column_config.CheckboxColumn("Delete Action", default=False), "Date": st.column_config.DateColumn("Date")})
        
        if st.button("💾 Save Ledger Changes"):
            updated_df = df_logs.drop(index=edited_ledger[edited_ledger["🗑️ Delete?"] == True].index)
            updated_df.update(edited_ledger[edited_ledger["🗑️ Delete?"] == False].drop(columns=["🗑️ Delete?"]))
            push_df = updated_df.copy()
            push_df["Date"] = push_df["Date"].astype(str)
            try:
                conn.update(data=push_df, spreadsheet=st.secrets.connections.gsheets.workout_tracker_sheet, worksheet="workout_logs")
                st.cache_data.clear()
                st.session_state.master_workout_df = updated_df
                st.success("✅ Ledger updated!")
                st.rerun()
            except Exception as e: st.error(f"Failed to update sheet: {e}")

        st.markdown("---")
        with st.expander("⚠️ Danger Zone (Destructive Actions)", expanded=False):
            st.markdown("### 🚨 Delete All Workout Logs")
            st.warning("Warning: This action is completely permanent and cannot be undone. This will delete all rows from your cloud Google Sheet for workout logs.")
            
            confirm = st.checkbox("I confirm that I want to delete ALL workout logs permanently.", key="confirm_clear_all_logs")
            if st.button("🔥 Permanently Clear All Workout Logs", disabled=not confirm):
                empty_df = pd.DataFrame(columns=["Date", "Split Day", "Exercise", "Set Number", "Weight (lbs)", "Reps", "Estimated 1RM", "Timestamp", "Duration (Mins)"])
                try:
                    conn.update(data=empty_df, spreadsheet=st.secrets.connections.gsheets.workout_tracker_sheet, worksheet="workout_logs")
                    st.cache_data.clear()
                    st.session_state.master_workout_df = empty_df
                    st.success("✅ All workout logs have been permanently cleared!")
                    st.rerun()
                except Exception as e:
                    st.error(f"Failed to clear sheet: {e}")

with tab4:
    col1, col2 = st.columns(2)
    with col1: st.metric("Compound Movements Rest", "90 - 120 sec")
    with col2: st.metric("Isolation Movements Rest", "60 sec")

with tab5:
    st.markdown("### 🍏 Permanent Apple Health Ledger (AI Health Export)")
    st.info("Upload your 7-day export CSV. It will be merged permanently into your cloud sheet without duplicates.")

    uploaded_health_file = st.file_uploader("Upload 'daily_summary.csv'", type=["csv"], key="health_export_dropzone")
    if uploaded_health_file is not None:
        try:
            df_incoming = pd.read_csv(uploaded_health_file)
            df_incoming.columns = df_incoming.columns.str.strip().str.lower()
            
            date_col = next((c for c in df_incoming.columns if "date" in c), None)
            hrv_col = next((c for c in df_incoming.columns if "hrv" in c or "variability" in c), None)
            sleep_col = next((c for c in df_incoming.columns if "sleep" in c or "bed" in c), None)
            rhr_col = next((c for c in df_incoming.columns if "resting" in c or "rhr" in c), None)
            steps_col = next((c for c in df_incoming.columns if "step" in c), None)

            if date_col:
                df_incoming[date_col] = pd.to_datetime(df_incoming[date_col])
                
                staging_rows = []
                for _, row in df_incoming.iterrows():
                    if pd.isna(row[date_col]): continue
                    staging_rows.append({
                        "Date": row[date_col],
                        "HRV": int(row[hrv_col]) if hrv_col and pd.notna(row[hrv_col]) else 0,
                        "Sleep Duration": round(float(row[sleep_col]), 1) if sleep_col and pd.notna(row[sleep_col]) else 0.0,
                        "RHR": int(row[rhr_col]) if rhr_col and pd.notna(row[rhr_col]) else 0,
                        "Steps": int(row[steps_col]) if steps_col and pd.notna(row[steps_col]) else 0,
                        "Bodyweight": 0.0
                    })
                df_staging = pd.DataFrame(staging_rows)
                st.dataframe(df_staging, use_container_width=True)
                
                if st.button("💾 Commit New Biometrics to Permanent Cloud Sheet"):
                    if not df_bio.empty:
                        existing_dates = pd.to_datetime(df_bio["Date"]).dt.date.values
                        df_staging = df_staging[~df_staging["Date"].dt.date.isin(existing_dates)]
                    
                    if not df_staging.empty:
                        updated_bio_df = pd.concat([df_bio, df_staging], ignore_index=True)
                        push_bio = updated_bio_df.copy()
                        push_bio["Date"] = push_bio["Date"].dt.strftime('%Y-%m-%d')
                        
                        conn.update(data=push_bio, spreadsheet=st.secrets.connections.gsheets.workout_tracker_sheet, worksheet="health_metrics")
                        st.cache_data.clear()
                        st.session_state.master_bio_df = updated_bio_df
                        st.success(f"✅ Successfully appended {len(df_staging)} new calendar days to your cloud ledger!")
                        st.rerun()
                    else:
                        st.warning("All dates inside this file have already been logged permanently.")
            else: st.error("No explicit date tracking markers located inside the uploaded CSV header row.")
        except Exception as e: st.error(f"File process breakdown: {e}")

    st.markdown("---")
    if not df_bio.empty:
        st.subheader("📈 All-Time Baseline Recovery Metrics")
        df_bio_sorted = df_bio.sort_values(by="Date", ascending=False)
        latest_day = df_bio_sorted.iloc[0]
        
        col1, col2, col3, col4 = st.columns(4)
        col1.metric("Latest HRV", f"{int(latest_day['HRV'])} ms")
        col2.metric("Latest Sleep", f"{latest_day['Sleep Duration']} hrs")
        col3.metric("Latest RHR", f"{int(latest_day['RHR'])} bpm")
        col4.metric("Latest Steps", f"{int(latest_day['Steps']):,}")
        
        st.markdown("<br>", unsafe_allow_html=True)
        chart_df = df_bio.sort_values(by="Date")
        metric_to_plot = st.selectbox("Select Core Biometric Overlay Tracking Panel", ["HRV", "Sleep Duration", "RHR", "Steps"])
        fig = px.line(chart_df, x="Date", y=metric_to_plot, markers=True, title=f"All-Time Trajectory Trend Lines: {metric_to_plot}")
        fig.update_traces(line_color='#00CC66', marker=dict(size=8)).update_layout(template="plotly_dark")
        st.plotly_chart(fig, use_container_width=True)
    else:
        st.info("Your permanent biometrics database is currently empty. Drop a weekly CSV file above to establish your historical timeline!")