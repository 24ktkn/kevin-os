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
        w_cal = day_health.get("Workout Calories", 0)
        w_cal = 0 if pd.isna(w_cal) else int(w_cal)
        w_dur = day_health.get("Workout Duration", 0)
        w_dur = 0 if pd.isna(w_dur) else int(w_dur)
        
        m1, m2, m3, m4, m5, m6 = st.columns(6)
        with m1:
            st.markdown(f'<div class="metric-card"><div class="metric-value">{day_health.get("Steps", 0)}</div><div class="metric-label">Steps</div></div>', unsafe_allow_html=True)
        with m2:
            st.markdown(f'<div class="metric-card"><div class="metric-value">{day_health.get("Sleep Duration", 0)}h</div><div class="metric-label">Sleep</div></div>', unsafe_allow_html=True)
        with m3:
            st.markdown(f'<div class="metric-card"><div class="metric-value">{day_health.get("HRV", 0)}</div><div class="metric-label">HRV</div></div>', unsafe_allow_html=True)
        with m4:
            st.markdown(f'<div class="metric-card"><div class="metric-value">{day_health.get("RHR", 0)}</div><div class="metric-label">RHR</div></div>', unsafe_allow_html=True)
        with m5:
            st.markdown(f'<div class="metric-card"><div class="metric-value">{w_cal}</div><div class="metric-label">W. Kcal</div></div>', unsafe_allow_html=True)
        with m6:
            st.markdown(f'<div class="metric-card"><div class="metric-value">{w_dur}m</div><div class="metric-label">W. Min</div></div>', unsafe_allow_html=True)
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
                
    # 4. GOOGLE PHOTOS & AI HIGHLIGHTS
    st.markdown("---")
    st.markdown("### 📸 Daily Photos (Google Photos Sync)")
    
    import requests
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    import base64
    import json
    import google.generativeai as genai
    
    @st.cache_data(ttl=3600)
    def fetch_google_photos(year, month, day):
        try:
            creds_info = st.secrets["tasks_api"]
            creds = Credentials(
                token=None,
                refresh_token=creds_info["refresh_token"],
                token_uri="https://oauth2.googleapis.com/token",
                client_id=creds_info["client_id"],
                client_secret=creds_info["client_secret"]
            )
            creds.refresh(Request())
            access_token = creds.token
            
            url = "https://photoslibrary.googleapis.com/v1/mediaItems:search"
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json"
            }
            payload = {
                "filters": {
                    "dateFilter": {
                        "dates": [{"year": year, "month": month, "day": day}]
                    },
                    "mediaTypeFilter": {
                        "mediaTypes": ["PHOTO"]
                    }
                },
                "pageSize": 50
            }
            
            resp = requests.post(url, headers=headers, json=payload)
            if resp.status_code == 200:
                return resp.json().get("mediaItems", [])
            else:
                st.error(f"Google Photos API Error: {resp.text}")
                return []
        except Exception as e:
            st.error(f"Failed to fetch photos: {e}")
            return []
            
    if st.button("✨ Sync & Highlight Best Photos with Gemini", use_container_width=True):
        with st.spinner("Fetching photos from Google Cloud..."):
            media_items = fetch_google_photos(selected_date.year, selected_date.month, selected_date.day)
            
            if not media_items:
                st.info("No photos found in your Google Photos for this day.")
            else:
                st.write(f"Found {len(media_items)} photos. Gemini is picking the best ones...")
                
                # Fetch thumbnails and prepare for Gemini
                images_for_gemini = []
                image_urls = []
                
                for item in media_items[:30]: # Cap at 30 to save API limits
                    img_url = item["baseUrl"] + "=w400-h400-c"
                    image_urls.append(img_url)
                    
                    try:
                        img_bytes = requests.get(img_url).content
                        images_for_gemini.append({
                            "mime_type": "image/jpeg",
                            "data": img_bytes # Gemini SDK handles bytes directly
                        })
                    except:
                        pass
                
                # Setup Gemini
                api_key = st.secrets.get("GEMINI_API_KEY")
                if not api_key:
                    api_key = st.secrets.get("connections", {}).get("gsheets", {}).get("GEMINI_API_KEY")
                
                if api_key:
                    genai.configure(api_key=api_key)
                    model = genai.GenerativeModel('gemini-1.5-flash')
                    
                    prompt = f"Here are {len(images_for_gemini)} photos from a user's day. Select up to 4 that are the most visually beautiful or meaningful to highlight the day. Ignore receipts, screenshots, blur, and text. Return ONLY a JSON list of the integer indices of the chosen photos, starting from 0 (e.g. [0, 5, 12])."
                    
                    try:
                        response = model.generate_content([prompt] + images_for_gemini)
                        # Parse JSON array
                        json_str = response.text.replace('```json', '').replace('```', '').strip()
                        best_indices = json.loads(json_str)
                        
                        st.markdown("#### ✨ AI Highlights")
                        cols = st.columns(len(best_indices) if best_indices else 1)
                        
                        for i, idx in enumerate(best_indices):
                            if idx < len(image_urls):
                                with cols[i]:
                                    st.image(image_urls[idx], use_container_width=True)
                                    
                        st.markdown("#### All Photos")
                        all_cols = st.columns(4)
                        for i, url in enumerate(image_urls):
                            with all_cols[i % 4]:
                                st.image(url, use_container_width=True)
                                
                    except Exception as e:
                        st.error(f"Gemini failed to select photos: {e}")
                        st.markdown("#### All Photos")
                        all_cols = st.columns(4)
                        for i, url in enumerate(image_urls):
                            with all_cols[i % 4]:
                                st.image(url, use_container_width=True)

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
