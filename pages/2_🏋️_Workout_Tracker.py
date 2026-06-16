import streamlit as st
import pandas as pd
import datetime
from streamlit_gsheets import GSheetsConnection

st.set_page_config(page_title="Workout Tracker", layout="wide")
st.title("🏋️ Workout Tracker")

# --- GOOGLE SHEETS SETUP ---
conn = st.connection("gsheets", type=GSheetsConnection)
df = conn.read(spreadsheet=st.secrets.connections.gsheets.workout_tracker_sheet, ttl=0)

# --- READ SHIELD ---
# Ensures our required columns exist in memory to prevent crashes if the sheet is empty
required_cols = ["Date", "Exercise", "Weight (lbs)", "Reps", "Set Number", "Timestamp"]
for col in required_cols:
    if col not in df.columns:
        df[col] = ""

# Lock data into the correct formats
df["Weight (lbs)"] = pd.to_numeric(df["Weight (lbs)"], errors='coerce').fillna(0.0)
df["Reps"] = pd.to_numeric(df["Reps"], errors='coerce').fillna(0).astype(int)
df["Set Number"] = pd.to_numeric(df["Set Number"], errors='coerce').fillna(1).astype(int)
df["Date"] = df["Date"].astype(str)
# -------------------

tab1, tab2 = st.tabs(["📝 Log Workout", "📊 History"])

with tab1:
    st.header("Log an Exercise")

    # 1. Ask for the exercise and number of sets OUTSIDE the form
    col1, col2 = st.columns([2, 1])
    with col1:
        exercise_name = st.text_input("Exercise Name", placeholder="e.g., Incline Dumbbell Bench Press")
    with col2:
        num_sets = st.number_input("Number of Sets", min_value=1, max_value=10, value=3, step=1)

    # 2. Build the dynamic form based on the number chosen above
    with st.form("bulk_log_form", clear_on_submit=True):
        st.write("### Fill out your sets")
        
        # Create header columns so it looks like a clean spreadsheet
        h1, h2, h3 = st.columns([1, 2, 2])
        h1.write("**Set**")
        h2.write("**Weight (lbs)**")
        h3.write("**Reps**")
        
        captured_sets = []
        
        # Generate the exact number of rows you requested
        for i in range(int(num_sets)):
            c1, c2, c3 = st.columns([1, 2, 2])
            with c1:
                st.write(f"**{i + 1}**")
            with c2:
                weight_val = st.number_input("Weight", min_value=0.0, value=0.0, step=2.5, key=f"weight_{i}", label_visibility="collapsed")
            with c3:
                reps_val = st.number_input("Reps", min_value=0, value=0, step=1, key=f"reps_{i}", label_visibility="collapsed")
            
            captured_sets.append({
                "Date": str(datetime.date.today()),
                "Exercise": exercise_name,
                "Weight (lbs)": float(weight_val),
                "Reps": int(reps_val),
                "Set Number": i + 1,
                "Timestamp": datetime.datetime.now().strftime("%H:%M:%S")
            })
            
        # 3. The Submit Button
        if st.form_submit_button("Log All Sets"):
            if exercise_name:
                # Filter out any sets where you left the reps at 0
                valid_sets = [s for s in captured_sets if s["Reps"] > 0]
                
                if valid_sets:
                    new_rows_df = pd.DataFrame(valid_sets)
                    updated_df = pd.concat([df, new_rows_df], ignore_index=True)
                    
                    try:
                        conn.update(
                            data=updated_df, 
                            spreadsheet=st.secrets.connections.gsheets.workout_tracker_sheet
                        )
                        st.success(f"💪 Successfully logged {len(valid_sets)} sets for {exercise_name}!")
                        st.rerun()
                    except Exception as e:
                        st.error(f"Failed to save to Google Sheets: {e}")
                else:
                    st.warning("Please enter reps for at least one set before saving.")
            else:
                st.warning("Please enter an exercise name at the top.")

with tab2:
    st.header("Workout History")
    # Display the master sheet data cleanly in the dashboard
    st.dataframe(df, use_container_width=True, hide_index=True)