import streamlit as st
import pandas as pd
import datetime
from zoneinfo import ZoneInfo
from streamlit_gsheets import GSheetsConnection

st.set_page_config(page_title="Meal Prep Core", layout="wide")

# --- HIGH-DENSITY MOBILE OPTIMIZED CSS ---
st.markdown("""
    <style>
    .main { background-color: #0F0F12; }
    
    /* Extra large tap targets for mobile shopping checkboxes */
    .stCheckbox [data-testid="stMarkdownContainer"] p {
        font-size: 1.05rem !important;
        font-weight: 600 !important;
        color: #E4E4E7 !important;
    }
    
    .dept-header {
        background: #1E1E24;
        border-left: 4px solid #FF9900; /* Costco Orange Accent */
        padding: 4px 10px;
        font-size: 0.95rem;
        font-weight: 700;
        text-transform: uppercase;
        color: #FFFFFF;
        margin-top: 14px;
        margin-bottom: 6px;
        border-radius: 0px 4px 4px 0px;
    }
    
    .meal-box {
        background: #16161D;
        border: 1px solid #23232F;
        border-radius: 6px;
        padding: 12px;
        margin-bottom: 8px;
    }
    .meal-title {
        font-size: 0.75rem;
        color: #A0A0AB;
        text-transform: uppercase;
        font-weight: 700;
        letter-spacing: 0.5px;
    }
    .meal-desc {
        font-size: 1rem;
        color: #00F0FF;
        font-weight: 700;
        margin-top: 2px;
    }
    .meal-instructions {
        font-size: 0.8rem;
        color: #E4E4E7;
        margin-top: 4px;
        line-height: 1.3;
    }
    </style>
    """, unsafe_allow_html=True)

st.title("🥗 Meal Prep & Provisioning")

# --- ⏳ AUTOMATED JULY 2026 CALENDAR LOGIC ---
now_local = datetime.datetime.now(ZoneInfo("America/Toronto"))
current_month = now_local.month
current_day = now_local.day
current_year = now_local.year

# Default auto-scheduling matrix calculation
if current_year == 2026 and current_month == 7:
    if current_day <= 7: auto_week = 1
    elif current_day <= 14: auto_week = 2
    elif current_day <= 21: auto_week = 3
    else: auto_week = 4
else:
    # Pre-July 2026 fallback/preview default
    auto_week = 1

# --- SIDEBAR INTERFACE CONTROLS ---
with st.sidebar:
    st.image("https://www.costco.com/wcsstore/CostcoResponsiveStaticAssets/images/Costco_Logo-White.png", width=140)
    st.markdown("### 🛒 Warehouse Transit Mode")
    
    # Simple mobile selector for shopping runs
    selected_trip = st.radio(
        "Select Active Shopping Target:",
        ["Trip 1 (Day 1 Master Stock)", "Trip 2 (Day 15 Mid-Month Refresh)"]
    )
    
    st.write("---")
    st.markdown("### 🗓️ Rotation Manifest Overrides")
    active_week = st.selectbox(
        "Viewing Agenda Context:",
        [1, 2, 3, 4],
        index=auto_week - 1,
        format_func=lambda x: f"Week {x} Rotation" + (" (Current Auto-Sync)" if x == auto_week else "")
    )

# --- DATABASE INGESTION LAYER ---
conn = st.connection("gsheets", type=GSheetsConnection)

try:
    df_raw = conn.read(spreadsheet=st.secrets.connections.gsheets.mission_control_sheet, worksheet="Costco_MealPlan", ttl=0)
except Exception:
    # Resilient fallback framework if the sheet tab hasn't run the script initialization yet
    fallback_data = {
        "Phase/Trip": ["Trip 1 (Day 1)"]*5 + ["Trip 2 (Day 15)"]*2,
        "Department": ["Meat & Deli", "Meat & Deli", "Dairy & Eggs", "Produce & Frozen", "Produce & Frozen", "Meat & Deli", "Produce & Frozen"],
        "Item Name": ["Kirkland Lean Ground Beef", "Kirkland Frozen Chicken Breasts", "Fresh Eggs", "Kirkland Frozen Broccoli Florets", "Kirkland Frozen Salmon Fillets", "Kirkland Hand-Pulled Rotisserie Meat", "Kirkland Frozen Stir-Fry Veg Blend"],
        "Target Scale/Size": ["3-Pack", "1 Bulk Bag", "5-Dozen Crate", "1 Bulk Bag", "1 Bulk Bag", "1.2 kg Pack", "1 Bulk Bag"],
        "Meal Prep Target Assignment": ["Lunch W1-2", "Dinner W1&3", "Lunch W1-2", "Dinner Side", "Dinner W2", "Lunch W3-4", "Dinner Side"]
    }
    df_raw = pd.DataFrame(fallback_data)

# Normalize string configurations
df_raw["Phase/Trip"] = df_raw["Phase/Trip"].astype(str)
df_raw["Department"] = df_raw["Department"].astype(str)

# Map the radio choice selection back to raw sheet filtering syntax
sheet_trip_filter = "Trip 1 (Day 1)" if "Trip 1" in selected_trip else "Trip 2 (Day 15)"
df_filtered = df_raw[df_raw["Phase/Trip"].str.contains(sheet_trip_filter, na=False, case=False)]

# --- WORKSPACE TAB LAYOUT ---
tab_shopping, tab_blueprint = st.tabs(["🛒 Costco Checklist", "🗓️ Weekly Menu Blueprint"])

with tab_shopping:
    st.subheader(f"📋 Items for {selected_trip}")
    
    if df_filtered.empty:
        st.info("No items mapped to this trip execution window in your sheet database.")
    else:
        # Group items cleanly by department to optimize the walking route through Costco
        departments = df_filtered["Department"].unique()
        
        for dept in departments:
            st.markdown(f'<div class="dept-header">{dept}</div>', unsafe_allow_html=True)
            df_dept = df_filtered[df_filtered["Department"] == dept]
            
            for _, row in df_dept.iterrows():
                item_label = f"**{row['Item Name']}** ({row['Target Scale/Size']}) — *{row['Meal Prep Target Assignment']}*"
                # Uses temporary session state tags keyed uniquely so checkboxes don't persist across separate store runs
                st.checkbox(item_label, key=f"shop_{row['Item Name']}_{sheet_trip_filter}")

with tab_blueprint:
    # Explicit status banner detailing whether the system is on auto-pilot or preview mode
    if current_year == 2026 and current_month == 7:
        st.success(f"🗓️ System active. Automatically serving **Week {active_week}** of your July 2026 deployment blueprint.")
    else:
        st.info(f"🔄 Showing structural preview layout for **Week {active_week}** (Official automated tracking kicks off July 1, 2026).")
        
    st.write(" ")
    
    # --- DYNAMIC ROTATION DATA ENGINE MAP ---
    smoothie_fruit = "Frozen Mango Chunks" if active_week in [1, 3] else "Frozen Three Berry Blend"
    lunch_title = "Beef, Egg, & Fresh Spinach Burritos" if active_week in [1, 2] else "Zero-Prep Pulled Chicken & Spinach Wraps"
    lunch_guide = (
        "Warm up pre-browned seasoned ground beef and scramble fresh eggs. Roll tightly into 2 high-protein flatbread wraps "
        "packed with a massive raw handful of organic fresh spinach. High-volume, clean macro execution."
        if active_week in [1, 2] else
        "Lay out 2 high-protein flatbread wraps, layer with cold fresh spinach, and stuff with cold Kirkland hand-pulled "
        "rotisserie chicken meat straight from the fridge pack. Add a splash of hot sauce, wrap, and store."
    )
    
    if active_week == 1:
        dinner_prot, dinner_veg = "Seasoned Chicken Breasts", "Frozen Broccoli Florets & Organic Corn"
    elif active_week == 2:
        dinner_prot, dinner_veg = "Kirkland Frozen Salmon Fillets", "Frozen Broccoli Florets & Organic Corn"
    elif active_week == 3:
        dinner_prot, dinner_veg = "Seasoned Chicken Breasts", "Kirkland Frozen Stir-Fry Vegetable Blend"
    else:
        dinner_prot, dinner_veg = "Thawed Tail-Off Shrimp", "Kirkland Frozen Stir-Fry Vegetable Blend"
        
    dinner_time = "6 minutes" if active_week == 4 else "15-18 minutes"
    
    # --- RENDER WEEKLY TARGET CARDS ---
    st.markdown(f"### 🍴 Target Agenda: Rotation Week {active_week}")
    
    # 1. Breakfast Layout
    st.markdown('<div class="meal-box"><div class="meal-title">🌅 Daily Breakfast Launch (Blender Action)</div>', unsafe_allow_html=True)
    st.markdown(f'<div class="meal-desc">High-Protein Fruit Smoothie</div>', unsafe_allow_html=True)
    st.markdown(f'<div class="meal-instructions"><b>Ingredients:</b> 1.5 cups Fairlife 2% Milk, 1 cup Vanilla Greek Yogurt, 1 cup <b>{smoothie_fruit}</b>, 1 tbsp Chia Seeds, 3 tbsp Manitoba Harvest Hemp Hearts.</div>', unsafe_allow_html=True)
    st.markdown('</div>', unsafe_allow_html=True)
    
    # 2. Lunch Layout
    st.markdown('<div class="meal-box"><div class="meal-title">☀️ Daily Mid-Day Fuel (2 Wraps)</div>', unsafe_allow_html=True)
    st.markdown(f'<div class="meal-desc">{lunch_title}</div>', unsafe_allow_html=True)
    st.markdown(f'<div class="meal-instructions"><b>Workflow:</b> {lunch_guide}</div>', unsafe_allow_html=True)
    st.markdown('</div>', unsafe_allow_html=True)
    
    # 3. Dinner Layout (11 Days per 2-Week Block)
    st.markdown('<div class="meal-box"><div class="meal-title">🌙 Hands-Off Performance Dinner (Air Fryer + Microwave Core)</div>', unsafe_allow_html=True)
    st.markdown(f'<div class="meal-desc">{dinner_prot} on Starch Grid</div>', unsafe_allow_html=True)
    st.markdown(f'<div class="meal-instructions"><b>Starch Core:</b> Cook a 50/50 blend of Jasmine Rice and Organic Quinoa in the rice cooker completely unattended.</div>', unsafe_allow_html=True)
    st.markdown(f'<div class="meal-instructions"><b>Protein Execution:</b> Air-fry your seasoned protein for <b>{dinner_time}</b> at 400°F until internal temperature target is hit. No monitoring needed.</div>', unsafe_allow_html=True)
    st.markdown(f'<div class="meal-instructions"><b>Vegetable Prep:</b> Pack <b>{dinner_veg}</b> completely raw into your batch prep boxes directly on top of the cooked rice and protein. They will perfectly steam live when the entire container is microwaved for 2.5 minutes at dinner time.</div>', unsafe_allow_html=True)
    st.markdown('</div>', unsafe_allow_html=True)