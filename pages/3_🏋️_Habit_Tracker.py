import streamlit as st
import pandas as pd
import plotly.express as px
import datetime
from zoneinfo import ZoneInfo
from streamlit_gsheets import GSheetsConnection
import calendar
import plotly.graph_objects as go

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
HABITS_LIST = ["Gym Workout", "Journaling"]

# --- ⏳ TIMEZONE & NIGHT OWL ROLLOVER ENGINE ---
# Force evaluation in local Eastern Time (London, Ontario)
now_local = datetime.datetime.now(ZoneInfo("America/Toronto"))

# 2:00 AM Rollover Rule: If it's between 12:00 AM and 1:59 AM, hold the previous date track
if now_local.hour < 2:
    productivity_date = now_local - datetime.timedelta(days=1)
else:
    productivity_date = now_local

today_str = productivity_date.strftime('%Y-%m-%d')

# --- DATABASE LAYER CONNECTIONS ---
conn = st.connection("gsheets", type=GSheetsConnection)

try:
    df = conn.read(spreadsheet=st.secrets.connections.gsheets.mission_control_sheet, worksheet="Habits", ttl=0)
    if df is None or df.empty or "Date" not in df.columns:
        df = pd.DataFrame(columns=["Date"] + HABITS_LIST)
except Exception:
    df = pd.DataFrame(columns=["Date"] + HABITS_LIST)

# Normalize data formatting rules
df["Date"] = df["Date"].astype(str)
for h in HABITS_LIST:
    if h not in df.columns:
        df[h] = False
    df[h] = df[h].replace({"TRUE": True, "FALSE": False, "True": True, "False": False}).fillna(False).astype(bool)
df = df[["Date"] + HABITS_LIST]

# Initialize today's productivity row if missing
if today_str not in df["Date"].values:
    new_day = {col: (today_str if col == "Date" else False) for col in df.columns}
    df = pd.concat([df, pd.DataFrame([new_day])], ignore_index=True)
    conn.update(data=df, spreadsheet=st.secrets.connections.gsheets.mission_control_sheet, worksheet="Habits")

today_idx = df[df["Date"] == today_str].index[0]

# --- 🛰️ CROSS-TAB AUTOMATION BRIDGE ---
try:
    df_mission = conn.read(spreadsheet=st.secrets.connections.gsheets.mission_control_sheet, ttl=0)
    if not df_mission.empty and "Item Name" in df_mission.columns and "Status" in df_mission.columns and "Date" in df_mission.columns:
        df_mission["Status"] = df_mission["Status"].replace({"TRUE": True, "FALSE": False, "True": True, "False": False}).fillna(False).astype(bool)
        df_mission["Date"] = df_mission["Date"].astype(str)
        
        todays_gym_completions = df_mission[
            (df_mission["Date"] == today_str) & 
            (df_mission["Status"] == True) & 
            (df_mission["Item Name"].str.lower().str.contains("gym", na=False) | df_mission["Item Name"].str.lower().str.contains("workout", na=False))
        ]
        
        if not todays_gym_completions.empty and not df.at[today_idx, "Gym Workout"]:
            df.at[today_idx, "Gym Workout"] = True
            conn.update(data=df, spreadsheet=st.secrets.connections.gsheets.mission_control_sheet, worksheet="Habits")
            st.toast("💪 Auto-Sync: Gym Workout updated based on your Mission Control Dashboard!")
except Exception:
    pass

# --- WORKSPACE TABBED LAYOUT ---
tab_log, tab_analytics = st.tabs(["🎯 Log Today's Habits", "📊 Performance Analytics"])

with tab_log:
    # Uses normalized productivity date tracking instead of server clock time
    st.write(f"### Target Agenda: **{productivity_date.strftime('%A, %b %d')}**")
    
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
            
        st.write("---")
        st.write("### 📅 Monthly Habit Calendar Heatmap")
        
        # Select habit to view on calendar
        cal_habit = st.selectbox("Select Habit to Plot on Calendar Grid", ["All Habits (Combined Count)"] + HABITS_LIST)
        
        # Select month/year
        months_list = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
        col_y, col_m = st.columns(2)
        with col_y:
            selected_year = st.selectbox("Calendar Year", sorted(list(range(2025, now_local.year + 2))), index=sorted(list(range(2025, now_local.year + 2))).index(now_local.year))
        with col_m:
            selected_month = st.selectbox("Calendar Month", months_list, index=now_local.month - 1)
            selected_month_num = months_list.index(selected_month) + 1
            
        # Build calendar grid
        cal_grid = calendar.monthcalendar(selected_year, selected_month_num)
        days_of_week = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        
        grid_values = []
        grid_labels = []
        grid_hovers = []
        
        for week in cal_grid:
            row_vals = []
            row_lbls = []
            row_hovers = []
            for day_idx, day_num in enumerate(week):
                if day_num == 0:
                    row_vals.append(None)
                    row_lbls.append("")
                    row_hovers.append("")
                else:
                    current_date = datetime.date(selected_year, selected_month_num, day_num)
                    date_str = current_date.strftime('%Y-%m-%d')
                    matching_rows = df_sorted[df_sorted["Date"] == date_str]
                    
                    if matching_rows.empty:
                        row_vals.append(0.0)
                        row_lbls.append(str(day_num))
                        row_hovers.append(f"{current_date.strftime('%b %d, %Y')}: No record logged / Not completed")
                    else:
                        row_data = matching_rows.iloc[0]
                        if cal_habit == "All Habits (Combined Count)":
                            completed_count = sum(bool(row_data[h]) for h in HABITS_LIST)
                            row_vals.append(completed_count)
                            row_lbls.append(str(day_num))
                            row_hovers.append(f"{current_date.strftime('%b %d, %Y')}: {completed_count}/{len(HABITS_LIST)} habits completed")
                        else:
                            completed = bool(row_data[cal_habit])
                            row_vals.append(1.0 if completed else 0.0)
                            row_lbls.append(str(day_num))
                            row_hovers.append(f"{current_date.strftime('%b %d, %Y')}: {cal_habit} - {'Done ✅' if completed else 'Not Done ❌'}")
            grid_values.append(row_vals)
            grid_labels.append(row_lbls)
            grid_hovers.append(row_hovers)

        # Plotly configuration
        if cal_habit == "All Habits (Combined Count)":
            colorscale = [
                [0.0, "#16161D"],   # background gray
                [0.2, "#0D3E26"],   # dark green
                [0.4, "#14623C"],
                [0.6, "#1B8752"],
                [0.8, "#22AC68"],
                [1.0, "#00FF66"]    # neon green
            ]
            zmin_val, zmax_val = 0, len(HABITS_LIST)
        else:
            colorscale = [
                [0.0, "#16161D"],
                [1.0, "#00FF66"]
            ]
            zmin_val, zmax_val = 0, 1

        fig_cal = go.Figure(data=go.Heatmap(
            z=grid_values,
            x=days_of_week,
            y=[f"Week {i+1}" for i in range(len(grid_values))],
            colorscale=colorscale,
            zmin=zmin_val,
            zmax=zmax_val,
            showscale=True if cal_habit == "All Habits (Combined Count)" else False,
            xgap=5,
            ygap=5,
            hoverinfo="text",
            text=grid_hovers,
            colorbar=dict(title="Habits", tickmode="linear", tick0=0, dtick=1) if cal_habit == "All Habits (Combined Count)" else None
        ))
        
        fig_cal.update_layout(
            template="plotly_dark",
            paper_bgcolor="rgba(0,0,0,0)",
            plot_bgcolor="rgba(0,0,0,0)",
            height=320,
            margin=dict(l=10, r=10, t=30, b=10),
            yaxis=dict(autorange="reversed", showgrid=False, showticklabels=False, fixedrange=True),
            xaxis=dict(showgrid=False, side="top", fixedrange=True)
        )
        
        # Add cell day annotations
        for y_idx, row in enumerate(grid_labels):
            for x_idx, val in enumerate(row):
                if val != "":
                    cell_val = grid_values[y_idx][x_idx]
                    is_hit = cell_val is not None and cell_val > 0
                    
                    # Decides on black or white text depending on cell brightness for high contrast
                    if is_hit:
                        if cal_habit == "All Habits (Combined Count)":
                            text_color = "#000000" if cell_val >= 3 else "#FFFFFF"
                        else:
                            text_color = "#000000"
                    else:
                        text_color = "#8E8E93"
                        
                    fig_cal.add_annotation(
                        x=days_of_week[x_idx],
                        y=f"Week {y_idx+1}",
                        text=f"<b>{val}</b>",
                        showarrow=False,
                        font=dict(color=text_color, size=11)
                    )
                    
        st.plotly_chart(fig_cal, use_container_width=True)