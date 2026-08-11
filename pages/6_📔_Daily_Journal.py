import streamlit as st
import pandas as pd
from datetime import datetime
from streamlit_gsheets import GSheetsConnection

st.set_page_config(page_title="Daily Time Atlas", layout="wide")

# --- CSS STYLING ---
st.markdown("""
    <style>
    .main { background-color: #0F0F12; color: #FFFFFF; }
    h1, h2, h3, p { color: #FFFFFF; }
    .stTextArea textarea { background-color: #16161D !important; color: #FFFFFF !important; border: 1px solid #23232F !important; }
    div.stButton > button { background-color: #00FF66 !important; color: #000000 !important; border: none !important; font-weight: bold; border-radius: 8px !important; }
    div.stButton > button:hover { background-color: #00CC52 !important; }
    .metric-card {
        background-color: #16161D;
        border: 1px solid #23232F;
        border-radius: 12px;
        padding: 16px;
        text-align: center;
    }
    .metric-value { font-size: 24px; font-weight: 900; color: #00F0FF; }
    .metric-label { font-size: 11px; font-weight: bold; color: #888888; text-transform: uppercase; }
    
    .timeline-container {
        border-left: 2px solid #23232F;
        margin-left: 20px;
        padding-left: 20px;
        padding-top: 10px;
        padding-bottom: 10px;
    }
    .timeline-item {
        margin-bottom: 24px;
        position: relative;
    }
    .timeline-dot {
        position: absolute;
        left: -27px;
        top: 4px;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background-color: #00FF66;
        border: 2px solid #0F0F12;
    }
    .timeline-dot.workout { background-color: #FF3333; }
    .timeline-dot.location { background-color: #00F0FF; }
    
    .timeline-time {
        font-size: 12px;
        color: #A855F7;
        font-weight: bold;
        margin-bottom: 4px;
    }
    .timeline-content {
        background-color: #16161D;
        border: 1px solid #23232F;
        border-radius: 8px;
        padding: 12px;
    }
    .timeline-title {
        font-weight: bold;
        font-size: 16px;
        margin-bottom: 4px;
    }
    .timeline-subtitle {
        font-size: 13px;
        color: #AAAAAA;
    }
    </style>
""", unsafe_allow_html=True)

st.title("📔 Daily Time Atlas")
st.markdown("Your locations, activities, and journals summarized in one beautiful view.")

# --- DATE SELECTION ---
col_date, _ = st.columns([1, 3])
with col_date:
    selected_date = st.date_input("Select Date", value=datetime.now())
selected_date_str = selected_date.strftime("%Y-%m-%d")

# --- FETCH DATA ---
conn = st.connection("gsheets", type=GSheetsConnection)
mission_sheet_url = st.secrets.connections.gsheets.mission_control_sheet
workout_sheet_url = st.secrets.connections.gsheets.workout_tracker_sheet

@st.cache_data(ttl=60)
def load_data():
    # 1. Location Log
    try:
        df_loc = conn.read(spreadsheet=mission_sheet_url, worksheet="location_log", ttl=0)
    except Exception:
        df_loc = pd.DataFrame(columns=["Timestamp", "Latitude", "Longitude", "Location Name"])
        
    # 2. Journal Entries
    try:
        df_journal = conn.read(spreadsheet=mission_sheet_url, worksheet="journal_entries", ttl=0)
    except Exception:
        df_journal = pd.DataFrame(columns=["Date", "Entry"])
        
    # 3. Health Metrics
    try:
        df_health = conn.read(spreadsheet=workout_sheet_url, worksheet="health_metrics", ttl=0)
    except Exception:
        df_health = pd.DataFrame()
        
    # 4. Workouts
    try:
        df_workouts = conn.read(spreadsheet=workout_sheet_url, worksheet="workout_logs", ttl=0)
    except Exception:
        df_workouts = pd.DataFrame()
        
    # Clean data
    if not df_loc.empty:
        df_loc = df_loc.dropna(subset=["Latitude", "Longitude"])
        # Standardize timestamp to datetime
        df_loc["Timestamp"] = pd.to_datetime(df_loc["Timestamp"], errors='coerce')
        
    if not df_workouts.empty and "Date" in df_workouts.columns:
        df_workouts["DateStr"] = df_workouts["Date"].astype(str).str[:10]
        
    return df_loc, df_journal, df_health, df_workouts

with st.spinner("Loading Time Atlas..."):
    df_loc, df_journal, df_health, df_workouts = load_data()

# --- FILTER DATA FOR SELECTED DATE ---
# Filter Locations
day_locs = pd.DataFrame()
if not df_loc.empty:
    day_locs = df_loc[df_loc["Timestamp"].dt.strftime("%Y-%m-%d") == selected_date_str].copy()
    day_locs = day_locs.sort_values("Timestamp")

# Filter Health
day_health = None
if not df_health.empty and "Date" in df_health.columns:
    df_health["DateStr"] = df_health["Date"].astype(str).str[:10]
    match = df_health[df_health["DateStr"] == selected_date_str]
    if not match.empty:
        day_health = match.iloc[0]

# Filter Workouts
day_workouts = pd.DataFrame()
if not df_workouts.empty and "DateStr" in df_workouts.columns:
    day_workouts = df_workouts[df_workouts["DateStr"] == selected_date_str].copy()


# --- UI LAYOUT ---
col_main, col_side = st.columns([2, 1])

with col_main:
    # 1. BIOMETRICS SUMMARY BAR
    if day_health is not None:
        st.markdown("### 📊 Daily Summary")
        m1, m2, m3, m4 = st.columns(4)
        with m1:
            st.markdown(f'<div class="metric-card"><div class="metric-value">{day_health.get("Steps", 0)}</div><div class="metric-label">Steps</div></div>', unsafe_allow_html=True)
        with m2:
            st.markdown(f'<div class="metric-card"><div class="metric-value">{day_health.get("Sleep Duration", 0)}h</div><div class="metric-label">Sleep</div></div>', unsafe_allow_html=True)
        with m3:
            st.markdown(f'<div class="metric-card"><div class="metric-value">{day_health.get("HRV", 0)}</div><div class="metric-label">HRV</div></div>', unsafe_allow_html=True)
        with m4:
            st.markdown(f'<div class="metric-card"><div class="metric-value">{day_health.get("RHR", 0)}</div><div class="metric-label">RHR</div></div>', unsafe_allow_html=True)
        st.markdown("<br>", unsafe_allow_html=True)
    
    # 2. MAP TRAJECTORY
    st.markdown("### 🗺️ Movement Trajectory")
    if not day_locs.empty:
        # Streamlit map requires lowercase 'latitude' and 'longitude'
        map_data = day_locs.copy()
        map_data = map_data.rename(columns={"Latitude": "latitude", "Longitude": "longitude"})
        
        # We can use st.map for a beautiful native dark mode map
        st.map(map_data, size=20, color="#00F0FF", zoom=12, use_container_width=True)
    else:
        st.info(f"No background location data recorded for {selected_date_str}.")
        
    # 3. MANUAL JOURNAL ENTRY
    st.markdown("---")
    st.markdown("### ✍️ Daily Journal")
    
    # Check if entry already exists
    existing_entry = ""
    if not df_journal.empty:
        df_journal["DateStr"] = df_journal["Date"].astype(str).str[:10]
        match = df_journal[df_journal["DateStr"] == selected_date_str]
        if not match.empty:
            existing_entry = str(match.iloc[-1]["Entry"])
            
    with st.form("journal_form"):
        journal_text = st.text_area("Reflect on your day...", value=existing_entry, height=250)
        submitted = st.form_submit_button("Save Journal Entry")
        
        if submitted:
            if journal_text.strip():
                # Prepare new dataframe
                if df_journal.empty:
                    df_journal = pd.DataFrame(columns=["Date", "Entry"])
                
                # Check if we should update or append
                if "DateStr" in df_journal.columns:
                    # Update existing
                    mask = df_journal["DateStr"] == selected_date_str
                    if mask.any():
                        idx = df_journal[mask].index[-1]
                        df_journal.at[idx, "Entry"] = journal_text
                    else:
                        new_row = pd.DataFrame([{"Date": selected_date_str, "Entry": journal_text}])
                        df_journal = pd.concat([df_journal, new_row], ignore_index=True)
                else:
                    new_row = pd.DataFrame([{"Date": selected_date_str, "Entry": journal_text}])
                    df_journal = pd.concat([df_journal, new_row], ignore_index=True)
                
                # Clean up DateStr before saving
                if "DateStr" in df_journal.columns:
                    df_journal = df_journal.drop(columns=["DateStr"])
                    
                conn.update(data=df_journal, spreadsheet=mission_sheet_url, worksheet="journal_entries")
                st.success("Journal saved successfully!")
                st.cache_data.clear()
                st.rerun()
                
    # 4. PHOTO GALLERY & UPLOADER
    st.markdown("---")
    st.markdown("### 📸 Daily Photos")
    
    import os
    photos_dir = os.path.join("data", "photos", selected_date_str)
    os.makedirs(photos_dir, exist_ok=True)
    
    # Upload new photos
    uploaded_files = st.file_uploader("Upload photos from this day", accept_multiple_files=True, type=["png", "jpg", "jpeg", "heic"])
    if uploaded_files:
        for uf in uploaded_files:
            file_path = os.path.join(photos_dir, uf.name)
            with open(file_path, "wb") as f:
                f.write(uf.getbuffer())
        st.success(f"Successfully uploaded {len(uploaded_files)} photos!")
        st.rerun()
        
    # Display existing photos
    photo_files = [f for f in os.listdir(photos_dir) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.heic'))]
    if photo_files:
        cols = st.columns(3)
        for i, photo in enumerate(photo_files):
            with cols[i % 3]:
                st.image(os.path.join(photos_dir, photo), use_container_width=True)
    else:
        st.info("No photos uploaded for this day yet.")

with col_side:
    st.markdown("### ⏱️ Timeline")
    
    timeline_html = '<div class="timeline-container">'
    has_events = False
    
    # 1. Location Events
    if not day_locs.empty:
        # Group locations by hour/name to avoid spamming the timeline
        day_locs["Hour"] = day_locs["Timestamp"].dt.floor("H")
        grouped_locs = day_locs.drop_duplicates(subset=["Hour", "Location Name"])
        
        for _, row in grouped_locs.iterrows():
            has_events = True
            time_str = row["Timestamp"].strftime("%I:%M %p")
            loc_name = str(row["Location Name"]).split(",")[0]
            if loc_name == "Unknown Location" or not loc_name.strip():
                loc_name = "Location Update"
                
            timeline_html += f'''
            <div class="timeline-item">
                <div class="timeline-dot location"></div>
                <div class="timeline-time">{time_str}</div>
                <div class="timeline-content">
                    <div class="timeline-title">📍 {loc_name}</div>
                </div>
            </div>
            '''
            
    # 2. Workout Events
    if not day_workouts.empty:
        # Group by exercise
        grouped_workouts = day_workouts.groupby("Exercise").agg({
            "Set Number": "count",
            "Weight": "max"
        }).reset_index()
        
        for _, row in grouped_workouts.iterrows():
            has_events = True
            exe = row["Exercise"]
            sets = row["Set Number"]
            max_w = row["Weight"]
            
            timeline_html += f'''
            <div class="timeline-item">
                <div class="timeline-dot workout"></div>
                <div class="timeline-time">Workout Session</div>
                <div class="timeline-content">
                    <div class="timeline-title">💪 {exe}</div>
                    <div class="timeline-subtitle">{sets} Sets • Max: {max_w} lbs</div>
                </div>
            </div>
            '''
            
    if not has_events:
        timeline_html += '<p style="color: #888;">No tracked events for this day.</p>'
        
    timeline_html += '</div>'
    
    st.markdown(timeline_html, unsafe_allow_html=True)
