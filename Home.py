import streamlit as st
import pandas as pd
import datetime
from streamlit_gsheets import GSheetsConnection
from zoneinfo import ZoneInfo
import calendar

# --- ⏳ TIMEZONE & NIGHT OWL ROLLOVER ENGINE ---
now_local = datetime.datetime.now(ZoneInfo("America/Toronto"))
if now_local.hour < 2:
    productivity_date = now_local - datetime.timedelta(days=1)
else:
    productivity_date = now_local
today_str = productivity_date.strftime('%Y-%m-%d')

HABITS_LIST = ["Wake Up On Time", "Gym Workout", "Journaling"]


def draw_mini_calendar(df_sorted, habit_name, today_str, year, month):
    streak = 0
    for val in reversed(df_sorted[habit_name].values):
        if val:
            streak += 1
        else:
            break
            
    total_days = len(df_sorted)
    completions = df_sorted[habit_name].sum()
    rate = int((completions / total_days) * 100) if total_days > 0 else 0
    
    cal = calendar.monthcalendar(year, month)
    month_name = calendar.month_name[month]
    
    completions_dict = {}
    for idx, row in df_sorted.iterrows():
        try:
            r_date = datetime.datetime.strptime(str(row["Date"]).strip(), "%Y-%m-%d")
            if r_date.year == year and r_date.month == month:
                completions_dict[r_date.strftime("%Y-%m-%d")] = bool(row[habit_name])
        except ValueError:
            continue
            
    html = f"""
    <div style="background: #16161D; border: 1px solid #23232F; border-radius: 8px; padding: 10px; margin-bottom: 6px; box-shadow: 0 4px 6px rgba(0,0,0,0.2);">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; border-bottom: 1px solid #23232F; padding-bottom: 6px;">
            <div>
                <div style="font-size: 0.9rem; font-weight: 800; color: #FFFFFF; display: flex; align-items: center; gap: 4px;">
                    { '⏰' if 'Wake' in habit_name else ('💪' if 'Gym' in habit_name else '✍️') } {habit_name}
                </div>
                <div style="font-size: 0.65rem; color: #A0A0AB; text-transform: uppercase; font-weight: 700; margin-top: 1px;">{month_name} {year}</div>
            </div>
            <div style="text-align: right;">
                <div style="font-size: 0.95rem; font-weight: 800; color: #00FF66;">{streak} 🔥</div>
                <div style="font-size: 0.55rem; color: #A0A0AB; font-weight: 700; text-transform: uppercase;">Streak</div>
            </div>
            <div style="text-align: right; margin-left: 8px;">
                <div style="font-size: 0.95rem; font-weight: 800; color: #00F0FF;">{rate}%</div>
                <div style="font-size: 0.55rem; color: #A0A0AB; font-weight: 700; text-transform: uppercase;">Cons.</div>
            </div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; text-align: center;">
    """
    
    for d in ["M", "T", "W", "T", "F", "S", "S"]:
        html += f'<div style="font-size: 0.55rem; color: #5E5E6E; font-weight: 700; padding-bottom: 2px;">{d}</div>'
        
    for week in cal:
        for day in week:
            if day == 0:
                html += '<div></div>'
            else:
                date_str = f"{year:04d}-{month:02d}-{day:02d}"
                completed = completions_dict.get(date_str, False)
                is_today = (date_str == today_str)
                
                if completed:
                    bg = "#00FF66"
                    color = "#000000"
                    border = "none"
                else:
                    bg = "#1E1E24"
                    color = "#8E8E93"
                    border = "1px solid #2D2D3D"
                    
                today_style = "outline: 2px solid #00F0FF; outline-offset: 1px;" if is_today else ""
                
                html += f"""
                <div style="
                    background: {bg};
                    color: {color};
                    border: {border};
                    border-radius: 3px;
                    font-size: 0.6rem;
                    font-weight: 700;
                    aspect-ratio: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    {today_style}
                ">
                    {day}
                </div>
                """
    html += "</div></div>"
    # Collapse and strip all indentation to prevent Streamlit markdown parser from treating it as a code block
    minified_html = "".join([line.strip() for line in html.splitlines()])
    return minified_html


conn = st.connection("gsheets", type=GSheetsConnection)


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
    
    /* Habit Button Styles */
    .habit-button button {
        background-color: #1E1E24 !important;
        color: #FFFFFF !important;
        border: 1px solid #2D2D3D !important;
        border-radius: 6px !important;
        font-weight: 700 !important;
        transition: all 0.3s ease !important;
        font-size: 0.75rem !important;
        padding: 4px 8px !important;
    }
    .habit-button button:hover {
        border-color: #00FF66 !important;
        color: #00FF66 !important;
        box-shadow: 0 0 8px rgba(0, 255, 102, 0.2) !important;
    }
    .habit-button-completed button {
        background-color: rgba(0, 255, 102, 0.1) !important;
        color: #00FF66 !important;
        border: 1px solid #00FF66 !important;
        border-radius: 6px !important;
        font-weight: 700 !important;
        transition: all 0.3s ease !important;
        font-size: 0.75rem !important;
        padding: 4px 8px !important;
    }
    .habit-button-completed button:hover {
        background-color: rgba(255, 51, 51, 0.1) !important;
        color: #FF3333 !important;
        border-color: #FF3333 !important;
        box-shadow: 0 0 8px rgba(255, 51, 51, 0.2) !important;
    }
    </style>
    """, unsafe_allow_html=True)

st.title("🧠 Central Operating System")
st.write("Welcome to your unified dashboard.")

# --- DYNAMIC BIOMETRICS SUMMARY PANEL ---
try:
    raw_bio = conn.read(spreadsheet=st.secrets.connections.gsheets.workout_tracker_sheet, worksheet="health_metrics", ttl=0)
    
    # Check that Date exists
    if "Date" in raw_bio.columns:
        df_bio_clean = raw_bio[raw_bio["Date"].astype(str).str.strip() != ""].copy()
        df_bio_clean["Date"] = pd.to_datetime(df_bio_clean["Date"].astype(str).str.strip(), errors='coerce')
        df_bio_clean = df_bio_clean[df_bio_clean["Date"].notna()]
        
        if not df_bio_clean.empty:
            df_today = df_bio_clean[df_bio_clean["Date"].dt.strftime('%Y-%m-%d') == today_str]
            if not df_today.empty:
                latest_day = df_today.iloc[0]
            else:
                latest_day = df_bio_clean.sort_values(by="Date", ascending=False).iloc[0]
            latest_date_str = latest_day["Date"].strftime('%A, %b %d')

            
            # Parse values (safe check)
            steps = int(latest_day["Steps"]) if "Steps" in latest_day and pd.notna(latest_day["Steps"]) else 0
            hrv = float(latest_day["HRV"]) if "HRV" in latest_day and pd.notna(latest_day["HRV"]) else 0
            sleep = float(latest_day["Sleep Duration"]) if "Sleep Duration" in latest_day and pd.notna(latest_day["Sleep Duration"]) else 0
            rhr = float(latest_day["RHR"]) if "RHR" in latest_day and pd.notna(latest_day["RHR"]) else 0
            
            # Fetch wake time if available
            wake_time = ""
            if "Wake Time" in latest_day and pd.notna(latest_day["Wake Time"]):
                wake_val = str(latest_day["Wake Time"]).strip()
                if wake_val != "" and wake_val.lower() != "nan" and wake_val.lower() != "nat":
                    wake_time = wake_val
            
            # Find the most recent non-zero bodyweight from history
            weight = 0.0
            if "Bodyweight" in df_bio_clean.columns:
                valid_weights = df_bio_clean[df_bio_clean["Bodyweight"] > 0]
                if not valid_weights.empty:
                    weight = float(valid_weights.sort_values(by="Date", ascending=False).iloc[0]["Bodyweight"])
            if weight == 0:
                weight = 170.0 # absolute fallback

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
            m_col1, m_col2, m_col3, m_col4, m_col5 = st.columns(5)
            
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
                wake_str = wake_time if wake_time else "No data"
                st.markdown(f"""
                <div class="status-card" style="text-align:center;">
                    <div class="status-lbl">Wake Up Time</div>
                    <div class="status-val" style="color: #A855F7; font-size: 1.6rem;">{wake_str}</div>
                </div>
                """, unsafe_allow_html=True)
                
            with m_col4:
                rhr_str = f"{int(rhr)} bpm" if rhr > 0 else "No data"
                st.markdown(f"""
                <div class="status-card" style="text-align:center;">
                    <div class="status-lbl">Resting Heart Rate</div>
                    <div class="status-val" style="color: #FF3333; font-size: 1.6rem;">{rhr_str}</div>
                </div>
                """, unsafe_allow_html=True)
                
            with m_col5:
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

# --- HABITS COMMAND CENTER ---
st.write("<div style='height:16px;'></div>", unsafe_allow_html=True)
st.markdown("### ⚡ Habits Command Center")

try:
    df_habits = conn.read(spreadsheet=st.secrets.connections.gsheets.mission_control_sheet, worksheet="Habits", ttl=0)
    if df_habits is None or df_habits.empty or "Date" not in df_habits.columns:
        df_habits = pd.DataFrame(columns=["Date"] + HABITS_LIST)
        
    df_habits["Date"] = df_habits["Date"].astype(str)
    for h in HABITS_LIST:
        if h not in df_habits.columns:
            df_habits[h] = False
        df_habits[h] = df_habits[h].replace({"TRUE": True, "FALSE": False, "True": True, "False": False}).fillna(False).astype(bool)
    df_habits = df_habits[["Date"] + HABITS_LIST]
    
    # Initialize today's productivity row if missing
    if today_str not in df_habits["Date"].values:
        new_day = {col: (today_str if col == "Date" else False) for col in df_habits.columns}
        df_habits = pd.concat([df_habits, pd.DataFrame([new_day])], ignore_index=True)
        conn.update(data=df_habits, spreadsheet=st.secrets.connections.gsheets.mission_control_sheet, worksheet="Habits")
        
    today_idx = df_habits[df_habits["Date"] == today_str].index[0]
    df_sorted = df_habits.sort_values(by="Date", ascending=True).copy()
    
    cols = st.columns(len(HABITS_LIST))
    
    for idx, habit in enumerate(HABITS_LIST):
        with cols[idx]:
            cal_html = draw_mini_calendar(df_sorted, habit, today_str, productivity_date.year, productivity_date.month)
            st.markdown(cal_html, unsafe_allow_html=True)
            
            completed = bool(df_habits.at[today_idx, habit])
            button_class = "habit-button-completed" if completed else "habit-button"
            st.markdown(f"<div class='{button_class}'>", unsafe_allow_html=True)
            if completed:
                if st.button("Completed ✅", key=f"btn_{habit}", use_container_width=True):
                    df_habits.at[today_idx, habit] = False
                    conn.update(data=df_habits, spreadsheet=st.secrets.connections.gsheets.mission_control_sheet, worksheet="Habits")
                    st.toast(f"Unmarked {habit} as completed.")
                    st.rerun()
            else:
                if st.button("Mark Done", key=f"btn_{habit}", use_container_width=True):
                    df_habits.at[today_idx, habit] = True
                    conn.update(data=df_habits, spreadsheet=st.secrets.connections.gsheets.mission_control_sheet, worksheet="Habits")
                    st.toast(f"Logged {habit} as completed!")
                    st.rerun()
            st.markdown("</div>", unsafe_allow_html=True)

except Exception as e:
    st.error(f"Error loading habits data: {e}")

st.write(" ")
st.markdown("""
### Available Modules
* **🚀 Mission Control:** Manage your Google Calendar sync, Tasks, and master schedule.
* **🏋️ Workout Tracker:** Log your 6-day split, track cable machine sets, and monitor progress.
* **🏋️ Habit Tracker:** Track your daily habits.
* **🥗 Meal Prep:** Manage your meal prep.
""")
