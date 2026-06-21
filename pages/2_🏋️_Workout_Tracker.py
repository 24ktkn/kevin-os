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
    required_cols = ["Date", "Split Day", "Exercise", "Set Number", "Weight (lbs)", "Reps", "Estimated 1RM", "Timestamp"]
    for col in required_cols:
        if col not in raw_df.columns: raw_df[col] = ""
    df_logs = raw_df[raw_df["Exercise"].astype(str).str.strip() != ""].copy()
    df_logs["Weight (lbs)"] = pd.to_numeric(df_logs["Weight (lbs)"], errors='coerce').fillna(0.0)
    df_logs["Reps"] = pd.to_numeric(df_logs["Reps"], errors='coerce').fillna(0).astype(int)
    df_logs["Estimated 1RM"] = pd.to_numeric(df_logs["Estimated 1RM"], errors='coerce').fillna(0.0)
    df_logs["Date"] = pd.to_datetime(df_logs["Date"].astype(str).str.strip(), errors='coerce')
    df_logs = df_logs[df_logs["Date"].notna()]
    st.session_state.master_workout_df = df_logs

df_logs = st.session_state.master_workout_df

# --- ENGINE 2: BIOMETRICS LOCAL MEMORY CACHE ---
if "master_bio_df" not in st.session_state:
    try:
        raw_bio = conn.read(spreadsheet=st.secrets.connections.gsheets.workout_tracker_sheet, worksheet="health_metrics", ttl=0)
        for col in ["Date", "HRV", "Sleep Duration", "RHR", "Steps"]:
            if col not in raw_bio.columns: raw_bio[col] = ""
        df_bio_clean = raw_bio[raw_bio["Date"].astype(str).str.strip() != ""].copy()
        df_bio_clean["Date"] = pd.to_datetime(df_bio_clean["Date"].astype(str).str.strip(), errors='coerce')
        df_bio_clean = df_bio_clean[df_bio_clean["Date"].notna()]
        st.session_state.master_bio_df = df_bio_clean
    except Exception:
        st.session_state.master_bio_df = pd.DataFrame(columns=["Date", "HRV", "Sleep Duration", "RHR", "Steps"])

df_bio = st.session_state.master_bio_df

# --- EXERCISE DATABASE ---
exercises_dict = {
    "Push (Chest/Shoulders/Triceps)": ["Incline Dumbbell Bench Press", "Flat Bench Press", "Cable Lateral Raises", "Seated Overhead Dumbbell Press", "Cable Tricep Overhead Extensions"],
    "Pull (Back/Biceps)": ["Pull-Ups", "Barbell Row", "Cable Face Pulls", "Dumbbell Incline Bicep Curls", "Cable Hammer Curls"],
    "Legs & Abs (Thigh/Calf Focus)": ["Barbell Squats", "Dumbbell Bulgarian Split Squats", "Calf Raises", "Hanging Knee Raises", "Cable Woodchoppers"],
    "Cardio (Treadmill)": ["Treadmill Steady State", "Treadmill Intervals"]
}

# --- HEADER ---
st.title("⚡ Dynamic Performance Dashboard")
st.subheader("6-Day Home Gym PPL - Permanent Cloud Storage Edition")

# --- SIDEBAR: MANUAL BULK LOGGING DATA ---
st.sidebar.header("🏋️ Log a Workout")
date_input = st.sidebar.date_input("Workout Date", datetime.date.today())
split_input = st.sidebar.selectbox("Select Split Category", list(exercises_dict.keys()))
exercise_input = st.sidebar.selectbox("Select Exercise", exercises_dict[split_input])

if split_input == "Cardio (Treadmill)":
    with st.sidebar.form("cardio_form", clear_on_submit=True):
        duration_input = st.number_input("Duration (Minutes)", min_value=1, max_value=180, value=45)
        if st.form_submit_button("Log Cardio Session"):
            new_row = {"Date": pd.to_datetime(date_input.strftime('%Y-%m-%d')), "Split Day": split_input, "Exercise": exercise_input, "Set Number": 1, "Weight (lbs)": 0.0, "Reps": duration_input, "Estimated 1RM": 0.0, "Timestamp": datetime.datetime.now().strftime("%H:%M:%S")}
            updated_df = pd.concat([df_logs, pd.DataFrame([new_row])], ignore_index=True)
            push_df = updated_df.copy()
            push_df["Date"] = push_df["Date"].astype(str)
            try:
                conn.update(data=push_df, spreadsheet=st.secrets.connections.gsheets.workout_tracker_sheet, worksheet="workout_logs")
                st.cache_data.clear()
                st.session_state.master_workout_df = updated_df
                st.sidebar.success("Cardio logged!")
                st.rerun()
            except Exception as e: st.sidebar.error(f"Save failed: {e}")
else:
    is_bodyweight = exercise_input in ["Pull-Ups", "Hanging Knee Raises"]
    last_weight = 135.0
    if not df_logs.empty and not is_bodyweight:
        past_exe_data = df_logs[df_logs["Exercise"] == exercise_input]
        if not past_exe_data.empty: last_weight = float(past_exe_data.sort_values(by="Date").iloc[-1]["Weight (lbs)"])

    num_sets = st.sidebar.number_input("Number of Sets", min_value=1, max_value=10, value=3, step=1)
    with st.sidebar.form("bulk_log_form", clear_on_submit=True):
        master_weight = st.number_input("Working Weight (lbs)", min_value=0.0, value=last_weight, step=2.5) if not is_bodyweight else 0.0
        captured_sets = []
        for i in range(int(num_sets)):
            r_val = st.number_input(f"Set {i+1}", min_value=0, value=0, step=1, key=f"r_{i}")
            captured_sets.append({"set": i+1, "r": r_val})
            
        if st.form_submit_button("Log All Sets to Dashboard"):
            valid_sets = [s for s in captured_sets if s["r"] > 0]
            if valid_sets:
                new_rows = []
                for s in valid_sets:
                    est_1rm = 0.0 if is_bodyweight else (round(master_weight * (1 + (s["r"] / 30.0)), 1) if s["r"] > 1 else master_weight)
                    new_rows.append({"Date": pd.to_datetime(date_input.strftime('%Y-%m-%d')), "Split Day": split_input, "Exercise": exercise_input, "Set Number": s["set"], "Weight (lbs)": master_weight, "Reps": s["r"], "Estimated 1RM": est_1rm, "Timestamp": datetime.datetime.now().strftime("%H:%M:%S")})
                updated_df = pd.concat([df_logs, pd.DataFrame(new_rows)], ignore_index=True)
                push_df = updated_df.copy()
                push_df["Date"] = push_df["Date"].astype(str)
                try:
                    conn.update(data=push_df, spreadsheet=st.secrets.connections.gsheets.workout_tracker_sheet, worksheet="workout_logs")
                    st.cache_data.clear()
                    st.session_state.master_workout_df = updated_df
                    st.sidebar.success(f"Logged {len(valid_sets)} sets!")
                    st.rerun()
                except Exception as e: st.sidebar.error(f"Save failed: {e}")

# --- MAIN DASHBOARD INTERFACE ---
tab1, tab2, tab3, tab4, tab5 = st.tabs(["📋 Exercise Guide & Target Weights", "📈 Premium Analytics Suite", "📜 Session History Ledger", "⏱️ Rest Interval Pacer", "❤️ Recovery & Readiness"])

with tab1:
    st.markdown("### Your Active 6-Day Home Gym Routine")
    if st.button("🔄 Force Cloud Sync (Pull latest from Sheet)"):
        st.cache_data.clear()
        if "master_workout_df" in st.session_state: del st.session_state["master_workout_df"]
        if "master_bio_df" in st.session_state: del st.session_state["master_bio_df"]
        st.rerun()

    for split, exercises in exercises_dict.items():
        with st.expander(f"➔ {split}", expanded=True):
            guide_data = []
            for exe in exercises:
                if not df_logs.empty:
                    exe_history = df_logs[df_logs["Exercise"] == exe].sort_values(by="Date", ascending=False)
                    if not exe_history.empty:
                        last_session = exe_history.iloc[0]
                        last_weight_str = "Cardio Session" if split == "Cardio (Treadmill)" else ("Bodyweight" if exe in ["Pull-Ups", "Hanging Knee Raises"] else f"**{last_session['Weight (lbs)']} lbs**")
                        last_reps_str = f"{int(last_session['Reps'])} mins" if split == "Cardio (Treadmill)" else f"{int(last_session['Reps'])} reps"
                        last_date_str = last_session['Date'].strftime('%b %d, %Y')
                    else: last_weight_str, last_reps_str, last_date_str = "No history", "Clear to start", "-"
                else: last_weight_str, last_reps_str, last_date_str = "No history", "Clear to start", "-"
                
                target_range = "3 Sets x 10-12 Reps (60s rest)" if ("Raises" in exe or "Curls" in exe or "Extensions" in exe) else ("3 Sets x 8-12 Reps (90s rest)" if ("Squats" in exe or "Press" in exe or "Row" in exe) else ("45-60 Mins (Treadmill)" if "Cardio" in split else "3 Sets x AMRAP (90s rest)"))
                guide_data.append({"Exercise Name": exe, "Target Progression Protocol": target_range, "Last Weight Used": last_weight_str, "Last Reps/Duration": last_reps_str, "Last Workout Date": last_date_str})
            st.write(pd.DataFrame(guide_data).to_html(escape=False, index=False), unsafe_allow_html=True)

with tab2:
    st.markdown("### 📊 Hevy & LifeApp Unified Analytics Engine")
    
    if df_logs.empty:
        st.info("Ingest training sessions using the uploader or sidebar form to build visual aggregates.")
    else:
        # --- 🧬 ADVANCED RESOLUTION PIPELINE ENGINE ---
        df_analytics = df_logs.copy()
        df_analytics["Volume"] = df_analytics["Weight (lbs)"] * df_analytics["Reps"]
        df_analytics["Month_Year"] = df_analytics["Date"].dt.strftime('%b %Y')
        df_analytics["Year_Week"] = df_analytics["Date"].dt.strftime('%Y-W%U')
        
        # Cross-platform keyword normalizer to bypass "Hevy Import" split empty space blocks
        def resolve_anatomy(row):
            exe = str(row["Exercise"]).lower()
            split = str(row["Split Day"]).lower()
            
            if "push" in split or "chest" in split: return "Chest / Shoulders / Triceps"
            if "pull" in split or "back" in split: return "Back / Biceps"
            if "leg" in split or "thigh" in split or "calf" in split: return "Quads / Hamstrings / Calves"
            if "cardio" in split or "treadmill" in split: return "Cardio"
            
            # Direct text scan parsing fallback for unmapped Hevy rows
            if any(x in exe for x in ["squat", "split squat", "calf", "leg", "lunge", "hamstring", "quad", "rdl", "deadlift"]):
                return "Quads / Hamstrings / Calves"
            if any(x in exe for x in ["bench", "press", "lateral", "tricep", "dip", "fly", "pushup", "overhead"]):
                return "Chest / Shoulders / Triceps"
            if any(x in exe for x in ["pull", "row", "bicep", "curl", "lat", "face pull", "chin"]):
                return "Back / Biceps"
            if any(x in exe for x in ["knee raise", "abs", "crunch", "woodchopper", "twist", "plank"]):
                return "Core Pillars (Abs)"
            if "treadmill" in exe or "run" in exe or "cardio" in exe:
                return "Cardio"
            return "Other Core Pillars"

        df_analytics["Unified Muscle Group"] = df_analytics.apply(resolve_anatomy, axis=1)
        
        # Metric Calculations
        weight_sessions = df_analytics[df_analytics["Unified Muscle Group"] != "Cardio"]
        cardio_sessions = df_analytics[df_analytics["Unified Muscle Group"] == "Cardio"]
        
        unique_workout_days = df_analytics.groupby(df_analytics["Date"].dt.date)["Unified Muscle Group"].nunique().sum()
        total_cardio_minutes = cardio_sessions["Reps"].sum()
        total_gym_minutes = int((unique_workout_days * 45) + total_cardio_minutes)
        total_volume_moved = int(df_analytics["Volume"].sum())
        total_workouts_logged = int(df_analytics["Date"].dt.date.nunique())

        # --- TOP LEVEL PERFORMANCE STATS BANNER ---
        m_col1, m_col2, m_col3, m_col4 = st.columns(4)
        with m_col1:
            st.markdown(f'<div class="stat-card"><div class="stat-val">{total_workouts_logged}</div><div class="stat-lbl">Total Workouts Logged</div></div>', unsafe_allow_html=True)
        with m_col2:
            st.markdown(f'<div class="stat-card"><div class="stat-val">{total_gym_minutes // 60}h {total_gym_minutes % 60}m</div><div class="stat-lbl">Time Invested in Gym</div></div>', unsafe_allow_html=True)
        with m_col3:
            st.markdown(f'<div class="stat-card"><div class="stat-val">{total_volume_moved:,} lbs</div><div class="stat-lbl">Hevy Total Volume Moved</div></div>', unsafe_allow_html=True)
        with m_col4:
            st.markdown(f'<div class="stat-card"><div class="stat-val">{df_analytics["Exercise"].nunique()}</div><div class="stat-lbl">Exercises Tracked</div></div>', unsafe_allow_html=True)

        st.write(" ")
        
        # --- SPLIT MONITOR LAYOUT PANELS ---
        left_panel, right_panel = st.columns([3, 2])
        
        with left_panel:
            st.markdown("#### 📈 Frequency Metrics & Mass Tonnage Load Graph")
            
            # Chart A: Workouts completed chronologically per month
            monthly_frequency = df_analytics.groupby("Month_Year")["Date"].nunique().reset_index(name="Sessions Completed")
            fig_freq = px.bar(monthly_frequency, x="Month_Year", y="Sessions Completed", title="Monthly Gym Visit Volumes", text_auto=True)
            fig_freq.update_traces(marker_color='#00CC66').update_layout(template="plotly_dark", paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)")
            st.plotly_chart(fig_freq, use_container_width=True)
            
            # Chart B: Load Progression Tracking
            weekly_volume = df_analytics.groupby("Year_Week")["Volume"].sum().reset_index(name="Weekly Mass (lbs)")
            fig_vol = px.line(weekly_volume, x="Year_Week", y="Weekly Mass (lbs)", title="Weekly Load Progression Trend (Total Volume)", markers=True)
            fig_vol.update_traces(line_color='#00F0FF', marker=dict(size=6)).update_layout(template="plotly_dark", paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)")
            st.plotly_chart(fig_vol, use_container_width=True)
            
            # Table C: Strength Records List
            st.markdown("#### 🏆 Strongest Lifts (Hevy Personal Records Record)")
            pr_df = df_analytics.groupby("Exercise").agg({"Weight (lbs)": "max", "Estimated 1RM": "max"}).reset_index()
            pr_df = pr_df[pr_df["Estimated 1RM"] > 0].sort_values(by="Estimated 1RM", ascending=False).rename(columns={"Exercise": "Exercise Name", "Weight (lbs)": "Heaviest Working Weight", "Estimated 1RM": "Peak Predicted 1RM"})
            st.dataframe(pr_df, use_container_width=True, hide_index=True)

        with right_panel:
            st.markdown("#### 🧬 Muscle Recovery Readiness Matrix")
            st.caption("Calculated via localized exhaustion variables across a systematic rolling 48-hour restoration window.")
            
            right_now = datetime.datetime.now(ZoneInfo("America/Toronto"))
            
            muscle_targets = ["Chest / Shoulders / Triceps", "Back / Biceps", "Quads / Hamstrings / Calves", "Core Pillars (Abs)"]
            
            for muscle in muscle_targets:
                matching_logs = df_analytics[df_analytics["Unified Muscle Group"] == muscle]
                
                if matching_logs.empty:
                    hours_since = 999
                    last_trained_str = "No record found"
                else:
                    latest_entry_date = matching_logs["Date"].max()
                    time_delta = right_now - latest_entry_date.replace(tzinfo=ZoneInfo("America/Toronto"))
                    hours_since = max(0, int(time_delta.total_seconds() / 3600))
                    last_trained_str = f"Last hit: {latest_entry_date.strftime('%a, %b %d')}"
                
                if hours_since >= 48:
                    status_lbl, status_css, rec_pct = "Optimized (100% Repaired)", "status-fresh", 100
                elif hours_since >= 24:
                    status_lbl, status_css, rec_pct = f"Rebuilding ({int((hours_since/48)*100)}%)", "status-recovering", int((hours_since/48)*100)
                else:
                    status_lbl, status_css, rec_pct = f"Fatigued / Damaged Fibers ({int((hours_since/48)*100)}%)", "status-fatigued", max(5, int((hours_since/48)*100))
                
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
                
            # Chart D: Muscle split distribution volume allocation circle
            st.markdown("<br>#### 🎯 Target Muscular Allocation Spread", unsafe_allow_html=True)
            split_volume = df_analytics.groupby("Unified Muscle Group")["Volume"].sum().reset_index(name="Total Tonnage Volume")
            fig_pie = px.pie(split_volume, values="Total Tonnage Volume", names="Unified Muscle Group", hole=0.4, color_discrete_sequence=px.colors.qualitative.Pastel)
            fig_pie.update_layout(template="plotly_dark", paper_bgcolor="rgba(0,0,0,0)", showlegend=True, margin=dict(l=10, r=10, t=10, b=10), height=240)
            st.plotly_chart(fig_pie, use_container_width=True)

        # --- DETAILED PERFORMANCE CHART DROPDOWN OVERLAY SCREEN ---
        st.write("---")
        st.markdown("#### 🔍 Micro Exercise Progression Overlays")
        selected_chart_exe = st.selectbox("Select Target Exercise to Plot Progression Path", sorted(df_analytics["Exercise"].dropna().unique()))
        filtered_df = df_analytics[df_analytics["Exercise"] == selected_chart_exe].sort_values(by="Date")
        if not filtered_df.empty:
            y_axis = "Reps" if ("Treadmill" in selected_chart_exe or selected_chart_exe in ["Pull-Ups", "Hanging Knee Raises"]) else "Estimated 1RM"
            lbl = "Duration (Mins)" if "Treadmill" in selected_chart_exe else "Performance Units"
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
                
                if h_date and h_exe and h_weight and h_reps:
                    df_hevy[h_weight] = pd.to_numeric(df_hevy[h_weight], errors='coerce').fillna(0.0)
                    df_hevy[h_reps] = pd.to_numeric(df_hevy[h_reps], errors='coerce').fillna(0).astype(int)
                    if h_set:
                        df_hevy[h_set] = pd.to_numeric(df_hevy[h_set], errors='coerce').fillna(1).astype(int)
                    
                    parsed_rows = []
                    for _, row in df_hevy.iterrows():
                        raw_dt = pd.to_datetime(row[h_date], errors='coerce')
                        if pd.isna(raw_dt): continue
                        
                        w_val = float(row[h_weight])
                        r_val = int(row[h_reps])
                        s_val = int(row[h_set]) if h_set else 1
                        
                        est_1rm = round(w_val * (1 + (r_val / 30.0)), 1) if r_val > 1 else w_val
                        parsed_rows.append({"Date": raw_dt, "Split Day": str(row[h_title]).strip() if h_title and pd.notna(row[h_title]) else "Hevy Import", "Exercise": str(row[h_exe]).strip() if h_exe else "Unknown", "Set Number": s_val, "Weight (lbs)": w_val, "Reps": r_val, "Estimated 1RM": est_1rm, "Timestamp": raw_dt.strftime("%H:%M:%S")})
                    
                    hevy_parsed_df = pd.DataFrame(parsed_rows)
                    st.success(f"Processed {len(hevy_parsed_df)} entries from Hevy!")
                    st.dataframe(hevy_parsed_df, use_container_width=True)
                    
                    if st.button("🔥 Append All Hevy Data & Push to Cloud Sheet"):
                        updated_df = pd.concat([df_logs, hevy_parsed_df], ignore_index=True)
                        push_df = updated_df.copy()
                        push_df["Date"] = push_df["Date"].astype(str)
                        conn.update(data=push_df, spreadsheet=st.secrets.connections.gsheets.workout_tracker_sheet, worksheet="workout_logs")
                        st.cache_data.clear()
                        st.session_state.master_workout_df = updated_df
                        st.success("✅ Injected to cloud sheets!")
                        st.rerun()
            except Exception as e: st.error(f"Error: {e}")
    
    st.markdown("---")
    if not df_logs.empty:
        display_ledger = df_logs.copy()
        display_ledger['Date'] = pd.to_datetime(display_ledger['Date']).dt.date
        display_ledger["🗑️ Delete?"] = False
        display_ledger = display_ledger.sort_values(by=["Date", "Timestamp"], ascending=[False, False])
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
                        "Steps": int(row[steps_col]) if steps_col and pd.notna(row[steps_col]) else 0
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