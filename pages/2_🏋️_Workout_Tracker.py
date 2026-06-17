import streamlit as st
import pandas as pd
import plotly.express as px
from datetime import datetime
from streamlit_gsheets import GSheetsConnection

# --- APP CONFIGURATION ---
st.set_page_config(page_title="Custom PPL Fitness Tracker", layout="wide", initial_sidebar_state="expanded")

st.markdown("""
    <style>
    .main { background-color: #121212; color: #FFFFFF; }
    div.stButton > button:first-child { background-color: #00CC66; color: white; border-radius: 8px; font-weight: bold; }
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
date_input = st.sidebar.date_input("Workout Date", datetime.today())
split_input = st.sidebar.selectbox("Select Split Category", list(exercises_dict.keys()))
exercise_input = st.sidebar.selectbox("Select Exercise", exercises_dict[split_input])

if split_input == "Cardio (Treadmill)":
    with st.sidebar.form("cardio_form", clear_on_submit=True):
        duration_input = st.number_input("Duration (Minutes)", min_value=1, max_value=180, value=45)
        if st.form_submit_button("Log Cardio Session"):
            new_row = {"Date": pd.to_datetime(date_input.strftime('%Y-%m-%d')), "Split Day": split_input, "Exercise": exercise_input, "Set Number": 1, "Weight (lbs)": 0.0, "Reps": duration_input, "Estimated 1RM": 0.0, "Timestamp": datetime.now().strftime("%H:%M:%S")}
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
                    new_rows.append({"Date": pd.to_datetime(date_input.strftime('%Y-%m-%d')), "Split Day": split_input, "Exercise": exercise_input, "Set Number": s["set"], "Weight (lbs)": master_weight, "Reps": s["r"], "Estimated 1RM": est_1rm, "Timestamp": datetime.now().strftime("%H:%M:%S")})
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
tab1, tab2, tab3, tab4, tab5 = st.tabs(["📋 Exercise Guide & Target Weights", "📈 Progress Analytics", "📜 Session History Ledger", "⏱️ Rest Interval Pacer", "❤️ Recovery & Readiness"])

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
    if df_logs.empty: st.info("No logs present. Use the sidebar or Hevy importer to start!")
    else:
        selected_chart_exe = st.selectbox("Select Exercise to Visualize", sorted(df_logs["Exercise"].dropna().unique()))
        filtered_df = df_logs[df_logs["Exercise"] == selected_chart_exe].sort_values(by="Date")
        if not filtered_df.empty:
            y_axis = "Reps" if ("Treadmill" in selected_chart_exe or selected_chart_exe in ["Pull-Ups", "Hanging Knee Raises"]) else "Estimated 1RM"
            lbl = "Duration (Mins)" if "Treadmill" in selected_chart_exe else "Performance Units"
            fig = px.line(filtered_df, x="Date", y=y_axis, markers=True, title=f"Progression Tracking: {selected_chart_exe}", labels={y_axis: lbl})
            fig.update_traces(line_color='#00CC66', marker=dict(size=8)).update_layout(template="plotly_dark")
            st.plotly_chart(fig, use_container_width=True)

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
                    parsed_rows = []
                    for _, row in df_hevy.iterrows():
                        raw_dt = pd.to_datetime(row[h_date], errors='coerce')
                        if pd.isna(raw_dt): continue
                        w_val, r_val, s_val = pd.to_numeric(row[h_weight], errors='coerce').fillna(0.0), pd.to_numeric(row[h_reps], errors='coerce').fillna(0).astype(int), pd.to_numeric(row[h_set], errors='coerce').fillna(1).astype(int)
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
                
                # Format to uniform parsing design patterns
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
                    # Deduplicate rows by checking incoming dates against existing dates
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