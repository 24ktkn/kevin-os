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

# --- SECURE DATABASE CONNECTION ---
# Using the exact same bot we set up for Mission Control
conn = st.connection("gsheets", type=GSheetsConnection)

try:
    df_logs = conn.read(spreadsheet=st.secrets.connections.gsheets.workout_tracker_sheet, ttl=0)
    # Clean up the date column for charting
    if not df_logs.empty and 'Date' in df_logs.columns:
        df_logs['Date'] = pd.to_datetime(df_logs['Date'])
except Exception as e:
    st.error("Could not read Workout Sheet. Is it completely empty? Try adding headers manually first.")
    df_logs = pd.DataFrame(columns=["Date", "Split Day", "Exercise", "Weight (lbs)", "Reps", "Estimated 1RM"])

# Fallback if the sheet has no columns yet
if df_logs.empty or 'Exercise' not in df_logs.columns:
    df_logs = pd.DataFrame(columns=["Date", "Split Day", "Exercise", "Weight (lbs)", "Reps", "Estimated 1RM"])

# --- EXERCISE DATABASE (Home Gym Routine) ---
exercises_dict = {
    "Push (Chest/Shoulders/Triceps)": [
        "Incline Dumbbell Bench Press", "Flat Bench Press", 
        "Cable Lateral Raises", "Seated Overhead Dumbbell Press", "Cable Tricep Overhead Extensions"
    ],
    "Pull (Back/Biceps)": [
        "Lat Pulldown / Pull-Ups", "Seated Cable Row / Barbell Row", 
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

# --- SIDEBAR: LOG WORKOUT DATA ---
st.sidebar.header("🏋️ Log a Set")
date_input = st.sidebar.date_input("Workout Date", datetime.today())
split_input = st.sidebar.selectbox("Select Split Category", list(exercises_dict.keys()))
exercise_input = st.sidebar.selectbox("Select Exercise", exercises_dict[split_input])

# CONDITIONAL INTERFACE: If Cardio is selected, show time instead of weight/reps
if split_input == "Cardio (Treadmill)":
    duration_input = st.sidebar.number_input("Duration (Minutes)", min_value=1, max_value=180, value=45)
    weight_input = 0.0
    reps_input = duration_input  # Storing minutes in the 'Reps' column for tracking
    estimated_1rm = 0.0
else:
    last_weight = 135.0
    if not df_logs.empty and "Exercise" in df_logs.columns:
        past_exe_data = df_logs[df_logs["Exercise"] == exercise_input]
        if not past_exe_data.empty:
            last_weight = float(past_exe_data.sort_values(by="Date").iloc[-1]["Weight (lbs)"])

    weight_input = st.sidebar.number_input("Weight (lbs)", min_value=0.0, step=2.5, value=last_weight)
    reps_input = st.sidebar.number_input("Reps Performed", min_value=1, max_value=50, value=10)

    # Calculate Estimated 1-Rep Max using the Epley formula
    if reps_input > 1:
        estimated_1rm = round(weight_input * (1 + (reps_input / 30.0)), 1)
    else:
        estimated_1rm = weight_input

if st.sidebar.button("Log Set to Dashboard"):
    new_row = {
        "Date": str(date_input),
        "Split Day": split_input,
        "Exercise": exercise_input,
        "Weight (lbs)": float(weight_input),
        "Reps": int(reps_input),
        "Estimated 1RM": float(estimated_1rm)
    }
    
    st.sidebar.warning("Pushing to Google Cloud...")
    updated_df = pd.concat([df_logs, pd.DataFrame([new_row])], ignore_index=True)
    # The actual magic that saves it permanently!
    conn.update(data=updated_df)
    
    st.sidebar.success("✅ Cloud sync complete!")
    st.rerun()

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
                if not df_logs.empty and "Exercise" in df_logs.columns:
                    exe_history = df_logs[df_logs["Exercise"] == exe].sort_values(by="Date", ascending=False)
                    if not exe_history.empty:
                        last_session = exe_history.iloc[0]
                        if split == "Cardio (Treadmill)":
                            last_weight_str = "Cardio Session"
                            last_reps_str = f"{int(last_session['Reps'])} mins"
                        else:
                            last_weight_str = f"**{last_session['Weight (lbs)']} lbs**"
                            last_reps_str = f"{int(last_session['Reps'])} reps"
                        
                        last_date_str = pd.to_datetime(last_session['Date']).strftime('%b %d, %Y')
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
                elif "Squats" in exe or "Press" in exe:
                    target_range = "3 Sets x 8-12 Reps (90s rest)"
                elif "Cardio" in split:
                    target_range = "45-60 Mins (Treadmill)"
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
    if df_logs.empty or "Exercise" not in df_logs.columns:
        st.info("No cloud data logged yet. Log your first set to see trajectory analytics!")
    else:
        st.markdown("### Trajectory Analytics")
        all_exercises = df_logs["Exercise"].dropna().unique()
        
        if len(all_exercises) > 0:
            selected_chart_exe = st.selectbox("Select Exercise to Visualize", all_exercises)
            filtered_df = df_logs[df_logs["Exercise"] == selected_chart_exe].sort_values(by="Date")
            
            if not filtered_df.empty:
                if "Treadmill" in selected_chart_exe:
                    fig = px.line(
                        filtered_df, 
                        x="Date", 
                        y="Reps", 
                        markers=True,
                        title= f"Cardio Endurance Over Time: {selected_chart_exe}",
                        labels={"Reps": "Session Duration (Minutes)", "Date": "Training Date"}
                    )
                else:
                    fig = px.line(
                        filtered_df, 
                        x="Date", 
                        y="Estimated 1RM", 
                        markers=True,
                        title= f"Strength Progression Curve: {selected_chart_exe}",
                        labels={"Estimated 1RM": "Calculated 1RM (lbs)", "Date": "Training Date"}
                    )
                fig.update_traces(line_color='#00CC66', marker=dict(size=8))
                fig.update_layout(template="plotly_dark")
                st.plotly_chart(fig, use_container_width=True)

with tab3:
    st.markdown("### Cloud Sync Master Ledger")
    st.write("*(Data is now pulled directly from your connected Workout Google Sheet)*")
    if not df_logs.empty and "Exercise" in df_logs.columns:
        st.dataframe(df_logs.sort_values(by="Date", ascending=False), use_container_width=True)
    else:
        st.info("Your spreadsheet is currently empty. Log a set on the left to start your database!")

with tab4:
    st.markdown("### In-Workout Precision Rest Timer")
    col1, col2 = st.columns(2)
    with col1:
        st.metric("Compound Movements (Squats, Bench, Rows)", "90 - 120 sec")
    with col2:
        st.metric("Isolation Movements (Raises, Curls, Extensions)", "60 sec")