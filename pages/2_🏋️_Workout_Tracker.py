import streamlit as st
import pandas as pd
import plotly.express as px
import datetime
from zoneinfo import ZoneInfo
from streamlit_gsheets import GSheetsConnection

def parse_sleep_duration(val):
    if pd.isna(val) or val == "":
        return 0.0
    val_str = str(val).strip().lower()
    if "h" in val_str or "m" in val_str:
        try:
            hours = 0.0
            minutes = 0.0
            if "h" in val_str:
                parts = val_str.split("h")
                hours = float(parts[0].strip())
                val_str = parts[1].strip()
            if "m" in val_str:
                parts = val_str.split("m")
                minutes = float(parts[0].strip())
            return hours + (minutes / 60.0)
        except Exception:
            pass
    try:
        return float(val)
    except ValueError:
        return 0.0

def parse_workout_duration(val):
    if pd.isna(val) or val == "":
        return 0.0
    val_str = str(val).strip()
    if ":" in val_str:
        parts = val_str.split(":")
        try:
            if len(parts) == 3:
                h, m, s = int(parts[0]), int(parts[1]), float(parts[2])
                if h >= 24 or (h > 5 and m == 0 and s == 0):
                    return float(h) + (m / 60.0)
                return h * 60.0 + m + (s / 60.0)
            elif len(parts) == 2:
                m, s = int(parts[0]), float(parts[1])
                return m + (s / 60.0)
        except ValueError:
            pass
    try:
        return float(val_str)
    except ValueError:
        return 0.0


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
    try:
        raw_df = conn.read(spreadsheet=st.secrets.connections.gsheets.workout_tracker_sheet, worksheet="workout_logs", ttl=0)
    except Exception as e:
        st.error("🔒 **Google Sheets Connection Error**")
        st.info(
            "Could not retrieve your workout logs. Please check that:\n"
            "1. Your Streamlit Secrets are correctly configured with your Google Service Account credentials.\n"
            "2. The Service Account email (`client_email`) has been shared with your spreadsheet as an **Editor**.\n"
            "3. You are not being rate-limited by Google (try refreshing in a few seconds)."
        )
        st.stop()
    required_cols = ["Date", "Split Day", "Exercise", "Set Number", "Weight (lbs)", "Reps", "Estimated 1RM", "Timestamp", "Duration (Mins)", "Gym Duration (Mins)", "Distance (km)"]
    for col in required_cols:
        if col not in raw_df.columns: raw_df[col] = ""
        
    df_logs = raw_df[raw_df["Exercise"].astype(str).str.strip() != ""].copy()
    df_logs["Weight (lbs)"] = pd.to_numeric(df_logs["Weight (lbs)"], errors='coerce').fillna(0.0)
    df_logs["Reps"] = pd.to_numeric(df_logs["Reps"], errors='coerce').fillna(0).astype(int)
    df_logs["Estimated 1RM"] = pd.to_numeric(df_logs["Estimated 1RM"], errors='coerce').fillna(0.0)
    df_logs["Duration (Mins)"] = df_logs["Duration (Mins)"].apply(parse_workout_duration)
    df_logs["Gym Duration (Mins)"] = df_logs["Gym Duration (Mins)"].apply(parse_workout_duration)
    df_logs["Distance (km)"] = pd.to_numeric(df_logs["Distance (km)"], errors='coerce').fillna(0.0)
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

# Ensure columns exist in case of cached session state
if "Distance (km)" not in df_logs.columns:
    df_logs["Distance (km)"] = 0.0
if "Gym Duration (Mins)" not in df_logs.columns:
    df_logs["Gym Duration (Mins)"] = 0.0
df_logs["Duration (Mins)"] = df_logs["Duration (Mins)"].apply(parse_workout_duration)
df_logs["Gym Duration (Mins)"] = df_logs["Gym Duration (Mins)"].apply(parse_workout_duration)

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
        df_bio_clean["Sleep Duration"] = df_bio_clean["Sleep Duration"].apply(parse_sleep_duration)
        st.session_state.master_bio_df = df_bio_clean
    except Exception:
        st.session_state.master_bio_df = pd.DataFrame(columns=["Date", "HRV", "Sleep Duration", "RHR", "Steps", "Bodyweight"])

df_bio = st.session_state.master_bio_df
if "Bodyweight" not in df_bio.columns:
    df_bio["Bodyweight"] = 0.0
df_bio["Bodyweight"] = pd.to_numeric(df_bio["Bodyweight"], errors='coerce').fillna(0.0)
if "Sleep Duration" in df_bio.columns:
    df_bio["Sleep Duration"] = df_bio["Sleep Duration"].apply(parse_sleep_duration)

# --- REUSABLE BODYWEIGHT TRACKER WIDGET ---
def render_bodyweight_tracker(key_prefix):
    latest_bw = 170.0
    if not df_bio.empty and "Bodyweight" in df_bio.columns:
        valid_bw = df_bio[df_bio["Bodyweight"] > 0]
        if not valid_bw.empty:
            latest_bw = float(valid_bw.sort_values(by="Date", ascending=False).iloc[0]["Bodyweight"])
            
    st.markdown(f"##### ⚖️ Current Weight: **{latest_bw} lbs** (Synced from Health App)")


def generate_weekly_digest(df_logs, df_bio):
    # Today's date and 7 days ago date
    today = datetime.date.today()
    seven_days_ago = today - datetime.timedelta(days=7)
    
    # Filter logs from the past 7 days
    df_logs_filtered = pd.DataFrame()
    if not df_logs.empty and "Date" in df_logs.columns:
        df_logs_copy = df_logs.copy()
        df_logs_copy["Date"] = pd.to_datetime(df_logs_copy["Date"]).dt.date
        df_logs_filtered = df_logs_copy[(df_logs_copy["Date"] >= seven_days_ago) & (df_logs_copy["Date"] <= today)]
        df_logs_filtered = df_logs_filtered.sort_values(by=["Date", "Exercise", "Set Number"])
        
    # Filter biometrics from the past 7 days
    df_bio_filtered = pd.DataFrame()
    if not df_bio.empty and "Date" in df_bio.columns:
        df_bio_copy = df_bio.copy()
        df_bio_copy["Date"] = pd.to_datetime(df_bio_copy["Date"]).dt.date
        df_bio_filtered = df_bio_copy[(df_bio_copy["Date"] >= seven_days_ago) & (df_bio_copy["Date"] <= today)]
        df_bio_filtered = df_bio_filtered.sort_values(by="Date", ascending=False)

    digest = []
    digest.append("=== WEEKLY TRAINING & HEALTH DIGEST FOR GEMINI ===")
    digest.append(f"Generated on: {today}")
    digest.append(f"Period: {seven_days_ago} to {today}\n")
    
    # 1. ADD WORKOUTS SUMMARY
    digest.append("--- WORKOUT LOGS ---")
    if df_logs_filtered.empty:
        digest.append("No workouts logged in the past 7 days.")
    else:
        # Group by Date
        grouped_by_date = df_logs_filtered.groupby("Date")
        for date_val, group in grouped_by_date:
            digest.append(f"\n📅 Date: {date_val}")
            # Group by Exercise
            grouped_by_exe = group.groupby("Exercise")
            for exe, exe_group in grouped_by_exe:
                split_day = exe_group["Split Day"].iloc[0] if "Split Day" in exe_group.columns else "N/A"
                digest.append(f"  🏋️ Exercise: {exe} (Split: {split_day})")
                for _, row in exe_group.iterrows():
                    set_num = row["Set Number"]
                    weight = row["Weight (lbs)"]
                    reps = row["Reps"]
                    dur = row.get("Duration (Mins)", 0.0)
                    dist = row.get("Distance (km)", 0.0)
                    
                    is_treadmill = "treadmill" in str(exe).lower()
                    if is_treadmill:
                        digest.append(f"    - Set {set_num}: {dur} mins | {dist} km")
                    else:
                        digest.append(f"    - Set {set_num}: {weight} lbs x {reps} reps")
    
    # 2. ADD BIOMETRICS SUMMARY
    digest.append("\n--- BIO & RECOVERY METRICS ---")
    if df_bio_filtered.empty:
        digest.append("No biometric data logged in the past 7 days.")
    else:
        for _, row in df_bio_filtered.iterrows():
            date_val = row["Date"]
            steps = row.get("Steps", 0)
            sleep = row.get("Sleep Duration", 0.0)
            hrv = row.get("HRV", 0)
            rhr = row.get("RHR", 0)
            weight = row.get("Bodyweight", 0.0)
            wake = row.get("Wake Time", "N/A")
            
            digest.append(f"📅 Date: {date_val}")
            digest.append(f"  - Steps: {steps}")
            digest.append(f"  - Sleep: {sleep} hours")
            digest.append(f"  - HRV: {hrv} ms | RHR: {rhr} bpm")
            digest.append(f"  - Weight: {weight} lbs")
            digest.append(f"  - Wake Time: {wake}")
            digest.append("")

    # 3. ADD COCHING INSTRUCTIONS / PROMPT FOR GEMINI
    digest.append("\n--- PROMPT TEMPLATE FOR GEMINI ---")
    digest.append("Copy the text above and paste it together with this prompt into Gemini:")
    digest.append("\"\"\"")
    digest.append("You are an elite strength & conditioning coach and bio-hacker. Please analyze my training and health data from the past week (above):")
    digest.append("1. Progressive Overload: Identify if I increased weight, reps, or volume on repeat exercises compared to previous sessions.")
    digest.append("2. Muscle Group Gaps: Map out which muscles were hit. What muscles did I miss this week, and what exercises should I add to address them?")
    digest.append("3. Cardio & Recovery Analysis: Look at my cardio (treadmill durations/distances) and map them against my sleep, HRV, and RHR. How is my cardiovascular conditioning affecting my recovery curves?")
    digest.append("4. Next Week's Blueprint: Give me concrete target weights/reps/durations for my next sessions to guarantee progression.\"\"\"")
    
    return "\n".join(digest)


# --- MASTER EXERCISE DICTIONARY ---
exercises_dict = {
    "Push (Chest/Shoulders/Triceps)": ["Bench Press (Dumbbell)", "Bench Press (Barbell)", "Lateral Raise (Cable)", "Overhead Press (Dumbbell)", "Triceps Extension (Cable)"],
    "Pull (Back/Biceps)": ["Pull Up", "Bent Over Row (Barbell)", "Face Pull", "Seated Incline Curl (Dumbbell)", "Dumbbell Pinwheel Curl (Cross-Body Hammer Curl)"],
    "Legs & Abs (Thigh/Calf Focus)": ["Squat (Barbell)", "Bulgarian Split Squat", "Romanian Deadlift (Barbell)", "Standing Calf Raise (Dumbbell)", "Hanging Knee Raise", "Cable Twist (Up to down)"],
    "Cardio (Treadmill)": ["Treadmill Steady State", "Treadmill Intervals"]
}

# --- CLEAN OVERHEAD SIDEBAR ---
with st.sidebar:
    st.markdown("### 🛰️ System Control Panel")
    st.info("Manual logging disabled. Application is running in 100% Autonomous Hevy Cloud-Sync Mode.")

# --- MAIN DASHBOARD INTERFACE ---
tab_analytics, tab_guide, tab_ledger, tab_recovery = st.tabs(["📈 Premium Analytics Suite", "📋 Exercise Guide & Target Weights", "📜 Session History Ledger", "❤️ Recovery & Readiness"])

with tab_guide:
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

with tab_analytics:
    st.markdown("### 📊 Hevy & LifeApp Unified Analytics Engine")
    render_bodyweight_tracker("tab2")
    
    st.markdown("### 🤖 Gemini Auto-Digest Exporter")
    with st.expander("📥 Export Weekly Training Digest for Gemini", expanded=False):
        st.markdown("Generate a copyable digest of your workouts, steps, and recovery metrics to paste into Gemini for an AI coaching analysis.")
        digest_text = generate_weekly_digest(df_logs, df_bio)
        st.text_area("Copy this digest:", value=digest_text, height=350)
        
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
        
        # Calculate gym minutes from Gym Duration (Mins) with fallback to Duration (Mins)
        if "Gym Duration (Mins)" in df_analytics.columns:
            # Parse both columns as floats securely
            df_analytics["Temp_Gym_Dur"] = df_analytics["Gym Duration (Mins)"].apply(parse_workout_duration)
            df_analytics["Temp_Cardio_Dur"] = df_analytics["Duration (Mins)"].apply(parse_workout_duration)
            
            # Use Gym Duration as primary; if 0, fall back to Cardio/Exercise Duration
            df_analytics["Temp_Final_Dur"] = df_analytics.apply(
                lambda r: r["Temp_Cardio_Dur"] if r["Temp_Gym_Dur"] == 0 else r["Temp_Gym_Dur"], axis=1
            )
            
            df_unique_workouts = df_analytics.groupby("Date")["Temp_Final_Dur"].max().reset_index()
            total_gym_minutes = int(df_unique_workouts["Temp_Final_Dur"].sum())
        elif "Duration (Mins)" in df_analytics.columns:
            df_analytics["Temp_Cardio_Dur"] = df_analytics["Duration (Mins)"].apply(parse_workout_duration)
            df_unique_workouts = df_analytics.groupby("Date")["Temp_Cardio_Dur"].max().reset_index()
            total_gym_minutes = int(df_unique_workouts["Temp_Cardio_Dur"].sum())
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
        filtered_df = df_analytics[df_analytics["Exercise"] == selected_chart_exe].sort_values(by="Date").copy()
        if not filtered_df.empty:
            exe_name_lower = selected_chart_exe.lower()
            is_cardio = "cardio" in exe_name_lower or any(x in exe_name_lower for x in ["treadmill", "run", "walk", "bike", "cycle", "cycling", "elliptical", "rower", "spin"])
            is_bodyweight = not is_cardio and (any(x in exe_name_lower for x in ["pull up", "pull-up", "chin up", "chin-up", "knee raise", "leg raise", "push up", "pushup", "dip", "bodyweight", "body weight", "plank", "sit up", "situp", "crunch", "ab wheel"]) or filtered_df["Weight (lbs)"].max() == 0)
            
            if is_cardio:
                cardio_metric = st.radio("Select Cardio Metric to Plot", ["Distance (km)", "Duration (Mins)", "Pace (min/km)"], horizontal=True, key=f"cardio_metric_{selected_chart_exe}")
                if cardio_metric == "Distance (km)":
                    y_axis = "Distance (km)"
                    lbl = "Distance (km)"
                elif cardio_metric == "Duration (Mins)":
                    y_axis = "Duration (Mins)"
                    lbl = "Duration (Mins)"
                else:
                    filtered_df["Pace (min/km)"] = filtered_df["Duration (Mins)"] / filtered_df["Distance (km)"].replace(0, np.nan)
                    filtered_df["Pace (min/km)"] = filtered_df["Pace (min/km)"].fillna(0.0)
                    y_axis = "Pace (min/km)"
                    lbl = "Pace (min/km)"
            elif is_bodyweight:
                y_axis = "Reps"
                lbl = "Reps Completed"
            else:
                y_axis = "Estimated 1RM"
                lbl = "Estimated 1RM (lbs)"
                
            if is_cardio and cardio_metric == "Pace (min/km)":
                temp_df = filtered_df.copy()
                temp_df.loc[temp_df[y_axis] == 0, y_axis] = np.nan
                daily_trend_df = temp_df.groupby("Date")[y_axis].min().reset_index()
                daily_trend_df[y_axis] = daily_trend_df[y_axis].fillna(0.0)
                
                def format_pace(decimal_mins):
                    if decimal_mins <= 0 or pd.isna(decimal_mins) or np.isinf(decimal_mins):
                        return "N/A"
                    mins = int(decimal_mins)
                    secs = int(round((decimal_mins - mins) * 60))
                    if secs == 60:
                        mins += 1
                        secs = 0
                    return f"{mins}:{secs:02d} /km"
                daily_trend_df["Pace Label"] = daily_trend_df[y_axis].apply(format_pace)
                
                fig_micro = px.line(daily_trend_df, x="Date", y=y_axis, markers=True, title=f"Progression Tracking: {selected_chart_exe} (Fastest Pace)", labels={y_axis: lbl}, text="Pace Label")
                fig_micro.update_traces(textposition="top center")
            else:
                daily_trend_df = filtered_df.groupby("Date")[y_axis].max().reset_index()
                fig_micro = px.line(daily_trend_df, x="Date", y=y_axis, markers=True, title=f"Progression Tracking: {selected_chart_exe} (Daily Peak)", labels={y_axis: lbl})
            fig_micro.update_traces(line_color='#00CC66', marker=dict(size=8)).update_layout(template="plotly_dark")
            st.plotly_chart(fig_micro, use_container_width=True)

with tab_ledger:
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
                h_dist = next((c for c in df_hevy.columns if "distance" in c or "dist" in c), None)
                h_secs = next((c for c in df_hevy.columns if ("second" in c or "duration" in c) and "workout" not in c), None)
                h_workout_dur = next((c for c in df_hevy.columns if "workout duration" in c or "workout_duration" in c), None)
                
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
                    
                    def parse_distance_to_km(val):
                        if pd.isna(val) or val == "":
                            return 0.0
                        val_str = str(val).strip().lower()
                        import re
                        match = re.search(r"([0-9]+(?:\.[0-9]+)?)", val_str)
                        if match:
                            num = float(match.group(1))
                            # If explicitly km, keep as is
                            if "km" in val_str or "kilometer" in val_str:
                                return num
                            # If explicitly meters, convert to km
                            if "m" in val_str and "k" not in val_str:
                                return round(num / 1000.0, 2)
                            # If a raw number is extremely large (e.g. > 50), it is likely meters
                            if num > 50:
                                return round(num / 1000.0, 2)
                            # Otherwise, assume miles and convert to km
                            return round(num * 1.60934, 2)
                        return 0.0

                    def parse_duration_to_mins(val):
                        if pd.isna(val) or val == "":
                            return 0.0
                        val_str = str(val).strip()
                        try:
                            num = float(val_str)
                            if num > 300: 
                                return round(num / 60.0, 2)
                            return num
                        except ValueError:
                            pass
                        parts = val_str.split(":")
                        try:
                            if len(parts) == 3:
                                h, m, s = int(parts[0]), int(parts[1]), float(parts[2])
                                return round(h * 60.0 + m + s / 60.0, 2)
                            elif len(parts) == 2:
                                m, s = int(parts[0]), float(parts[1])
                                return round(m + s / 60.0, 2)
                        except ValueError:
                            pass
                        return 0.0
                    
                    parsed_rows = []
                    for _, row in df_hevy.iterrows():
                        raw_dt = pd.to_datetime(row[h_date], errors='coerce')
                        if pd.isna(raw_dt): continue
                        
                        w_val = float(row[h_weight])
                        r_val = int(row[h_reps])
                        s_val = int(row['computed_set_num'])
                        
                        # Use set-specific duration (seconds) if available in Hevy CSV for cardio pace calculations
                        raw_secs = row[h_secs] if h_secs and pd.notna(row[h_secs]) else ""
                        cardio_mins = parse_duration_to_mins(raw_secs)
                        
                        dur_val = cardio_mins if cardio_mins > 0 else 0.0
                        
                        # 1. Parse overall workout duration from "Workout Duration" column
                        gym_dur_val = 0.0
                        if h_workout_dur:
                            raw_workout_dur = row[h_workout_dur] if pd.notna(row[h_workout_dur]) else ""
                            gym_dur_val = parse_duration_to_mins(raw_workout_dur)
                            
                        # 2. Fallback to start/end time difference (computed_dur)
                        if gym_dur_val == 0.0 and 'computed_dur' in df_hevy.columns:
                            gym_dur_val = float(row['computed_dur'])
                            
                        # 3. Apply conversions / fallback
                        if gym_dur_val > 240:
                            gym_dur_val = round(gym_dur_val / 60.0, 1)
                        if gym_dur_val == 0.0 and dur_val > 0.0:
                            gym_dur_val = dur_val
                        
                        est_1rm = round(w_val * (1 + (r_val / 30.0)), 1) if r_val > 1 else w_val
                        raw_dist = row[h_dist] if h_dist and pd.notna(row[h_dist]) else ""
                        dist_val = parse_distance_to_km(raw_dist)
                        parsed_rows.append({"Date": raw_dt.normalize(), "Split Day": str(row[h_title]).strip() if h_title and pd.notna(row[h_title]) else "Hevy Import", "Exercise": str(row[h_exe]).strip() if h_exe else "Unknown", "Set Number": s_val, "Weight (lbs)": w_val, "Reps": r_val, "Estimated 1RM": est_1rm, "Timestamp": raw_dt.strftime("%H:%M:%S"), "Duration (Mins)": dur_val, "Gym Duration (Mins)": gym_dur_val, "Distance (km)": dist_val})
                    
                    hevy_parsed_df = pd.DataFrame(parsed_rows)
                    
                    # --- 🛡️ COMPOSITE MATRIX DEDUPLICATION & MERGE ENGINE ---
                    df_logs_copy = df_logs.copy()
                    df_logs_copy["Date"] = pd.to_datetime(df_logs_copy["Date"]).dt.normalize()
                    df_logs_copy["Exercise"] = df_logs_copy["Exercise"].astype(str).str.strip()
                    df_logs_copy["Set Number"] = df_logs_copy["Set Number"].astype(int)
                    df_logs_copy["Distance (km)"] = pd.to_numeric(df_logs_copy["Distance (km)"], errors='coerce').fillna(0.0)
                    df_logs_copy["Duration (Mins)"] = df_logs_copy["Duration (Mins)"].apply(parse_workout_duration)
                    df_logs_copy["Gym Duration (Mins)"] = df_logs_copy["Gym Duration (Mins)"].apply(parse_workout_duration)
                    
                    hevy_parsed_df["Date"] = pd.to_datetime(hevy_parsed_df["Date"]).dt.normalize()
                    hevy_parsed_df["Exercise"] = hevy_parsed_df["Exercise"].astype(str).str.strip()
                    hevy_parsed_df["Set Number"] = hevy_parsed_df["Set Number"].astype(int)
                    
                    new_rows = []
                    updated_rows_count = 0
                    
                    for _, row in hevy_parsed_df.iterrows():
                        # Find match in existing ledger
                        match_idx = df_logs_copy[(df_logs_copy["Date"] == row["Date"]) & 
                                                 (df_logs_copy["Exercise"] == row["Exercise"]) & 
                                                 (df_logs_copy["Set Number"] == row["Set Number"])].index
                        if len(match_idx) > 0:
                            idx = match_idx[0]
                            changed = False
                            
                            # Merge distance
                            csv_dist = float(row["Distance (km)"])
                            exist_dist = float(df_logs_copy.at[idx, "Distance (km)"])
                            if exist_dist == 0.0 and csv_dist > 0.0:
                                df_logs_copy.at[idx, "Distance (km)"] = csv_dist
                                changed = True
                                
                            # Merge cardio duration
                            csv_dur = float(row["Duration (Mins)"])
                            exist_dur = float(df_logs_copy.at[idx, "Duration (Mins)"])
                            if exist_dur == 0.0 and csv_dur > 0.0:
                                df_logs_copy.at[idx, "Duration (Mins)"] = csv_dur
                                changed = True
                                
                            # Merge gym duration
                            csv_gym_dur = float(row["Gym Duration (Mins)"])
                            exist_gym_dur = float(df_logs_copy.at[idx, "Gym Duration (Mins)"])
                            if exist_gym_dur == 0.0 and csv_gym_dur > 0.0:
                                df_logs_copy.at[idx, "Gym Duration (Mins)"] = csv_gym_dur
                                changed = True
                                
                            if changed:
                                updated_rows_count += 1
                        else:
                            new_rows.append(row)
                            
                    new_rows_df = pd.DataFrame(new_rows)
                    if not new_rows_df.empty:
                        deduped_df = pd.concat([df_logs_copy, new_rows_df], ignore_index=True)
                    else:
                        deduped_df = df_logs_copy
                        
                    new_rows_discovered = len(new_rows_df)
                    
                    st.success(f"Processed CSV! Found {len(hevy_parsed_df)} parsed sets. (Discovered {new_rows_discovered} brand-new sets, updated {updated_rows_count} existing sets with new durations/distances).")
                    st.dataframe(hevy_parsed_df, use_container_width=True)
                    
                    if new_rows_discovered > 0 or updated_rows_count > 0:
                        if st.button("🔥 Save Hevy Data & Push to Cloud Sheet"):
                            push_df = deduped_df.copy()
                            push_df["Date"] = push_df["Date"].dt.strftime('%Y-%m-%d')
                            push_df = push_df.fillna("")
                            conn.update(data=push_df, spreadsheet=st.secrets.connections.gsheets.workout_tracker_sheet, worksheet="workout_logs")
                            st.cache_data.clear()
                            st.session_state.master_workout_df = deduped_df
                            st.success(f"✅ Injected {new_rows_discovered} new rows and updated {updated_rows_count} existing rows! Cloud sheet synchronized successfully.")
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
                empty_df = pd.DataFrame(columns=["Date", "Split Day", "Exercise", "Set Number", "Weight (lbs)", "Reps", "Estimated 1RM", "Timestamp", "Duration (Mins)", "Gym Duration (Mins)", "Distance (km)"])
                try:
                    conn.update(data=empty_df, spreadsheet=st.secrets.connections.gsheets.workout_tracker_sheet, worksheet="workout_logs")
                    st.cache_data.clear()
                    st.session_state.master_workout_df = empty_df
                    st.success("✅ All workout logs have been permanently cleared!")
                    st.rerun()
                except Exception as e:
                    st.error(f"Failed to clear sheet: {e}")

with tab_recovery:
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
                        "Sleep Duration": round(parse_sleep_duration(row[sleep_col]), 2) if sleep_col else 0.0,
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
        
        latest_sleep = latest_day['Sleep Duration']
        latest_sleep_numeric = parse_sleep_duration(latest_sleep)
        if latest_sleep_numeric > 0:
            ls_hours = int(latest_sleep_numeric)
            ls_minutes = int(round((latest_sleep_numeric - ls_hours) * 60))
            if ls_minutes == 60:
                ls_hours += 1
                ls_minutes = 0
            sleep_val_str = f"{ls_hours}h {ls_minutes}m"
        else:
            sleep_val_str = "No data"
        col2.metric("Latest Sleep", sleep_val_str)
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