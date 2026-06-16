import streamlit as st
import pandas as pd
import plotly.express as px
from datetime import datetime
from streamlit_gsheets import GSheetsConnection

# --- APP CONFIGURATION ---
st.set_page_config(page_title="Custom PPL Fitness Tracker", layout="wide", initial_sidebar_state="expanded")

# Custom Dark Theme Styling via Markdown
st.markdown("""
    <style>
    .main { background-color: #121212; color: #FFFFFF; }
    div.stButton > button:first-child { background-color: #00CC66; color: white; border-radius: 8px; font-weight: bold; }
    </style>
    """, unsafe_allow_html=True)

# --- GOOGLE SHEETS DATABASE CONFIGURATION ---
conn = st.connection("gsheets", type=GSheetsConnection)
raw_df = conn.read(spreadsheet=st.secrets.connections.gsheets.workout_tracker_sheet, ttl=0)

# --- THE MASTER CLEANER ---
required_cols = ["Date", "Split Day", "Exercise", "Set Number", "Weight (lbs)", "Reps", "Estimated 1RM", "Timestamp"]
for col in required_cols:
    if col not in raw_df.columns:
        raw_df[col] = ""

df_logs = raw_df[raw_df["Exercise"].astype(str).str.strip() != ""].copy()
df_logs = df_logs[df_logs["Exercise"].notna()]

df_logs["Exercise"] = df_logs["Exercise"].astype(str).str.strip()
df_logs["Weight (lbs)"] = pd.to_numeric(df_logs["Weight (lbs)"], errors='coerce').fillna(0.0)
df_logs["Reps"] = pd.to_numeric(df_logs["Reps"], errors='coerce').fillna(0).astype(int)
df_logs["Estimated 1RM"] = pd.to_numeric(df_logs["Estimated 1RM"], errors='coerce').fillna(0.0)
df_logs["Date"] = pd.to_datetime(df_logs["Date"], errors='coerce')

df_logs = df_logs[df_logs["Date"].notna()]
# ---------------------------

# --- EXERCISE DATABASE ---
exercises_dict = {
    "Push (Chest/Shoulders/Triceps)": [
        "Incline Dumbbell Bench Press", "Flat Bench Press", 
        "Cable Lateral Raises", "Seated Overhead Dumbbell Press", "Cable Tricep Overhead Extensions"
    ],
    "Pull (Back/Biceps)": [
        "Pull-Ups", "Barbell Row", 
        "Cable Face Pulls", "Dumbbell Incline Bicep Curls", "Cable Hammer Curls"
    ],
    "Legs & Abs (Thigh/Calf Focus)": [
        "Barbell Squats", "Dumbbell Bulgarian Split Squats", 
        "Calf Raises", "Hanging Knee Raises", "Cable Woodchoppers"
    ],
    "Cardio (Treadmill)": [
        "Treadmill Steady State", "Treadmill Intervals"
    ]
}

# --- HEADER ---
st.title("⚡ Dynamic Performance Dashboard")
st.subheader("6-Day Home Gym PPL - Permanent Cloud Storage Edition")

# --- SIDEBAR: BULK LOGGING DATA ---
st.sidebar.header("🏋️ Log a Workout")
date_input = st.sidebar.date_input("Workout Date", datetime.today())
split_input = st.sidebar.selectbox("Select Split Category", list(exercises_dict.keys()))
exercise_input = st.sidebar.selectbox("Select Exercise", exercises_dict[split_input])

if split_input == "Cardio (Treadmill)":
    with st.sidebar.form("cardio_form", clear_on_submit=True):
        duration_input = st.number_input("Duration (Minutes)", min_value=1, max_value=180, value=45)
        if st.form_submit_button("Log Cardio Session"):
            new_row = {
                "Date": date_input.strftime('%Y-%m-%d'),
                "Split Day": split_input,
                "Exercise": exercise_input,
                "Set Number": 1,
                "Weight (lbs)": 0.0,
                "Reps": duration_input, 
                "Estimated 1RM": 0.0,
                "Timestamp": datetime.now().strftime("%H:%M:%S")
            }
            updated_df = pd.concat([df_logs, pd.DataFrame([new_row])], ignore_index=True)
            try:
                conn.update(data=updated_df, spreadsheet=st.secrets.connections.gsheets.workout_tracker_sheet)
                st.sidebar.success("Cardio logged!")
                st.rerun()
            except Exception as e:
                st.sidebar.error(f"Save failed: {e}")
else:
    is_bodyweight = exercise_input in ["Pull-Ups", "Hanging Knee Raises"]

    last_weight = 135.0
    if not df_logs.empty and not is_bodyweight:
        past_exe_data = df_logs[df_logs["Exercise"] == exercise_input]
        if not past_exe_data.empty:
            last_weight = float(past_exe_data.sort_values(by="Date").iloc[-1]["Weight (lbs)"])

    num_sets = st.sidebar.number_input("Number of Sets", min_value=1, max_value=10, value=3, step=1)
    
    with st.sidebar.form("bulk_log_form", clear_on_submit=True):
        if not is_bodyweight:
            master_weight = st.number_input("Working Weight (lbs)", min_value=0.0, value=last_weight, step=2.5)
        else:
            st.write("*(Bodyweight Exercise)*")
            master_weight = 0.0
            
        st.write("### Reps Per Set")
        captured_sets = []
        
        for i in range(int(num_sets)):
            r_val = st.number_input(f"Set {i+1}", min_value=0, value=0, step=1, key=f"r_{i}")
            captured_sets.append({"set": i+1, "r": r_val})
            
        if st.form_submit_button("Log All Sets to Dashboard"):
            valid_sets = [s for s in captured_sets if s["r"] > 0]
            
            if valid_sets:
                new_rows = []
                for s in valid_sets:
                    if is_bodyweight:
                        est_1rm = 0.0
                    else:
                        est_1rm = round(master_weight * (1 + (s["r"] / 30.0)), 1) if s["r"] > 1 else master_weight
                        
                    new_rows.append({
                        "Date": date_input.strftime('%Y-%m-%d'),
                        "Split Day": split_input,
                        "Exercise": exercise_input,
                        "Set Number": s["set"],
                        "Weight (lbs)": master_weight, 
                        "Reps": s["r"],
                        "Estimated 1RM": est_1rm,
                        "Timestamp": datetime.now().strftime("%H:%M:%S")
                    })
                
                updated_df = pd.concat([df_logs, pd.DataFrame(new_rows)], ignore_index=True)
                try:
                    conn.update(data=updated_df, spreadsheet=st.secrets.connections.gsheets.workout_tracker_sheet)
                    st.sidebar.success(f"Logged {len(valid_sets)} sets{'!' if is_bodyweight else f' at {master_weight} lbs!'}")
                    st.rerun()
                except Exception as e:
                    st.sidebar.error(f"Save failed: {e}")
            else:
                st.sidebar.warning("Enter reps for at least one set.")

# --- MAIN DASHBOARD INTERFACE ---
tab1, tab2, tab3, tab4 = st.tabs([
    "📋 Exercise Guide & Target Weights", 
    "📈 Progress Analytics", 
    "📜 Session History Ledger", 
    "⏱️ Rest Interval Pacer"
])

with tab1:
    st.markdown("### Your Active 6-Day Home Gym Routine")
    st.write("Below is your weekly plan paired with a live reminder of your **last recorded working weight** to guide your next session.")
    
    for split, exercises in exercises_dict.items():
        with st.expander(f"➔ {split}", expanded=True):
            guide_data = []
            for exe in exercises:
                if not df_logs.empty:
                    exe_history = df_logs[df_logs["Exercise"] == exe].sort_values(by="Date", ascending=False)
                    if not exe_history.empty:
                        last_session = exe_history.iloc[0]
                        if split == "Cardio (Treadmill)":
                            last_weight_str = "Cardio Session"
                            last_reps_str = f"{int(last_session['Reps'])} mins"
                        elif exe in ["Pull-Ups", "Hanging Knee Raises"]:
                            last_weight_str = "Bodyweight"
                            last_reps_str = f"{int(last_session['Reps'])} reps"
                        else:
                            last_weight_str = f"**{last_session['Weight (lbs)']} lbs**"
                            last_reps_str = f"{int(last_session['Reps'])} reps"
                        
                        last_date_str = last_session['Date'].strftime('%b %d, %Y')
                    else:
                        last_weight_str = "No history"
                        last_reps_str = "Clear to start"
                        last_date_str = "-"
                else:
                    last_weight_str = "No history"
                    last_reps_str = "Clear to start"
                    last_date_str = "-"
                
                if "Raises" in exe or "Curls" in exe or "Extensions" in exe:
                    target_range = "3 Sets x 10-12 Reps (60s rest)"
                elif "Squats" in exe or "Press" in exe or "Row" in exe:
                    target_range = "3 Sets x 8-12 Reps (90s rest)"
                elif "Cardio" in split:
                    target_range = "45-60 Mins (Treadmill)"
                elif "Pull-Ups" in exe:
                    target_range = "3 Sets x AMRAP (90s rest)"
                else:
                    target_range = "3-4 Sets x 8-12 Reps"

                guide_data.append({
                    "Exercise Name": exe,
                    "Target Progression Protocol": target_range,
                    "Last Weight Used": last_weight_str,
                    "Last Reps/Duration": last_reps_str,
                    "Last Workout Date": last_date_str
                })
            
            guide_df = pd.DataFrame(guide_data)
            st.write(guide_df.to_html(escape=False, index=False), unsafe_allow_html=True)
            st.markdown("<br>", unsafe_allow_html=True)

with tab2:
    if df_logs.empty:
        st.info("No cloud data logged yet. Use the sidebar to log your first sets!")
    else:
        st.markdown("### Trajectory Analytics")
        all_exercises = df_logs["Exercise"].dropna().unique()
        selected_chart_exe = st.selectbox("Select Exercise to Visualize", all_exercises)
        
        filtered_df = df_logs[df_logs["Exercise"] == selected_chart_exe].sort_values(by="Date")
        
        if not filtered_df.empty:
            if "Treadmill" in selected_chart_exe:
                fig = px.line(
                    filtered_df, 
                    x="Date", y="Reps", 
                    markers=True,
                    title= f"Cardio Endurance Over Time: {selected_chart_exe}",
                    labels={"Reps": "Session Duration (Minutes)", "Date": "Training Date"}
                )
            elif selected_chart_exe in ["Pull-Ups", "Hanging Knee Raises"]:
                fig = px.line(
                    filtered_df, 
                    x="Date", y="Reps", 
                    markers=True,
                    title= f"Bodyweight Endurance Over Time: {selected_chart_exe}",
                    labels={"Reps": "Reps Completed", "Date": "Training Date"}
                )
            else:
                fig = px.line(
                    filtered_df, 
                    x="Date", y="Estimated 1RM", 
                    markers=True,
                    title= f"Strength Progression Curve: {selected_chart_exe}",
                    labels={"Estimated 1RM": "Calculated 1RM (lbs)", "Date": "Training Date"}
                )
            fig.update_traces(line_color='#00CC66', marker=dict(size=8))
            fig.update_layout(template="plotly_dark")
            st.plotly_chart(fig, use_container_width=True)

with tab3:
    st.markdown("### Cloud Sync Master Ledger")
    st.info("Edit your cells directly or check the box to delete. Click Save when done.")
    
    if not df_logs.empty:
        display_ledger = df_logs.copy()
        display_ledger['Date'] = display_ledger['Date'].dt.date
        display_ledger["🗑️ Delete?"] = False
        
        # Sort for easy reading, but Pandas keeps the original indices attached behind the scenes
        display_ledger = display_ledger.sort_values(by=["Date", "Timestamp"], ascending=[False, False])
        
        edited_ledger = st.data_editor(
            display_ledger, 
            use_container_width=True, 
            hide_index=True,
            column_config={
                "🗑️ Delete?": st.column_config.CheckboxColumn("Delete Action", default=False),
                "Date": st.column_config.DateColumn("Date")
            }
        )
        
        if st.button("💾 Save Ledger Changes"):
            # 1. Handle Deletions
            indices_to_delete = edited_ledger[edited_ledger["🗑️ Delete?"] == True].index
            updated_df = df_logs.drop(index=indices_to_delete)
            
            # 2. Handle Edits (Update the remaining rows with any text/number changes)
            rows_to_keep = edited_ledger[edited_ledger["🗑️ Delete?"] == False].drop(columns=["🗑️ Delete?"])
            updated_df.update(rows_to_keep)
            
            try:
                conn.update(data=updated_df, spreadsheet=st.secrets.connections.gsheets.workout_tracker_sheet)
                st.success("✅ Ledger updated successfully!")
                st.rerun()
            except Exception as e:
                st.error(f"Failed to update sheet: {e}")
    else:
        st.info("Your spreadsheet is currently empty. Use the sidebar to log a set!")

with tab4:
    st.markdown("### In-Workout Precision Rest Timer")
    col1, col2 = st.columns(2)
    with col1:
        st.metric("Compound Movements (Squats, Bench, Rows, Pull-Ups)", "90 - 120 sec")
    with col2:
        st.metric("Isolation Movements (Raises, Curls, Extensions)", "60 sec")