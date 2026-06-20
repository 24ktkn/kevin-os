import streamlit as st
import pandas as pd
from streamlit_gsheets import GSheetsConnection

# Initialize Connection
conn = st.connection("gsheets", type=GSheetsConnection)

# Formulate clean individual row tuples
rows = [
    ("Trip 1 (Day 1)", "Meat & Deli", "Kirkland Lean Ground Beef", "3-Pack", "Lunch (Weeks 1-2)"),
    ("Trip 1 (Day 1)", "Meat & Deli", "Kirkland Frozen Chicken Breasts", "1 Bulk Bag", "Dinner (Weeks 1 & 3)"),
    ("Trip 1 (Day 1)", "Dairy & Eggs", "Fresh Eggs", "5-Dozen Crate", "Lunch (Weeks 1-2)"),
    ("Trip 1 (Day 1)", "Dairy & Eggs", "Fairlife 2% Milk", "3-Pack", "Breakfast Smoothie (Daily)"),
    ("Trip 1 (Day 1)", "Dairy & Eggs", "Kirkland Vanilla Greek Yogurt", "2-Pack", "Breakfast Smoothie (Daily)"),
    ("Trip 1 (Day 1)", "Produce & Frozen", "Organic Fresh Spinach", "1 Large Tub", "Lunch Greens (Weeks 1-2)"),
    ("Trip 1 (Day 1)", "Produce & Frozen", "Kirkland Frozen Broccoli Florets", "1 Bulk Bag", "Dinner Veg (Weeks 1-2)"),
    ("Trip 1 (Day 1)", "Produce & Frozen", "Kirkland Frozen Organic Corn", "1 Bulk Bag", "Dinner Carb Add (Weeks 1-2)"),
    ("Trip 1 (Day 1)", "Produce & Frozen", "Kirkland Frozen Mango Chunks", "1 Bulk Bag", "Smoothie Fruit (Weeks 1 & 3)"),
    ("Trip 1 (Day 1)", "Produce & Frozen", "Kirkland Frozen Salmon Fillets", "1 Bulk Bag", "Dinner (Week 2)"),  # Salmon Fixed!
    ("Trip 1 (Day 1)", "Pantry & Grains", "Jasmine/Basmati Rice", "1 Bulk Bag", "Dinner Base Starch"),
    ("Trip 1 (Day 1)", "Pantry & Grains", "Kirkland Organic Quinoa", "1 Bag", "Dinner Base Boost"),
    ("Trip 1 (Day 1)", "Pantry & Grains", "High-Protein Flatbread Wraps", "Multi-Pack", "Lunch Encasement"),
    ("Trip 1 (Day 1)", "Pantry & Grains", "Whole Chia Seeds", "1 Bag", "Smoothie Superfood"),
    ("Trip 1 (Day 1)", "Pantry & Grains", "Manitoba Harvest Hemp Hearts", "1 Bag", "Smoothie Omega Boost"),
    ("Trip 2 (Day 15)", "Meat & Deli", "Kirkland Frozen Tail-Off Shrimp", "1 Bulk Bag", "Dinner (Week 4)"),
    ("Trip 2 (Day 15)", "Meat & Deli", "Kirkland Hand-Pulled Rotisserie Meat", "1.2 kg Vacuum Pack", "Lunch (Weeks 3-4)"),
    ("Trip 2 (Day 15)", "Dairy & Eggs", "Fairlife 2% Milk (Refresh)", "3-Pack", "Breakfast Smoothie (Daily)"),
    ("Trip 2 (Day 15)", "Dairy & Eggs", "Kirkland Vanilla Greek Yogurt (Refresh)", "2-Pack", "Breakfast Smoothie (Daily)"),
    ("Trip 2 (Day 15)", "Produce & Frozen", "Organic Fresh Spinach (Refresh)", "1 Large Tub", "Lunch Greens (Weeks 3-4)"),
    ("Trip 2 (Day 15)", "Produce & Frozen", "Kirkland Frozen Stir-Fry Veg Blend", "1 Bulk Bag", "Dinner Veg (Weeks 3-4)"),
    ("Trip 2 (Day 15)", "Produce & Frozen", "Kirkland Frozen Three Berry Blend", "1 Bulk Bag", "Smoothie Fruit (Weeks 2 & 4)")
]

columns = ["Phase/Trip", "Department", "Item Name", "Target Scale/Size", "Meal Prep Target Assignment"]
df_grocery_sheet = pd.DataFrame(rows, columns=columns)

# Convert all text formats cleanly
for col in df_grocery_sheet.columns:
    df_grocery_sheet[col] = df_grocery_sheet[col].astype(str)

try:
    # Ship data up to your cloud sheet tab
    conn.update(data=df_grocery_sheet, spreadsheet=st.secrets.connections.gsheets.mission_control_sheet, worksheet="Costco_MealPlan")
    print("🚀 Success! 'Costco_MealPlan' worksheet tab has been successfully initialized and populated.")
except Exception as e:
    print(f"❌ Error during step injection execution: {e}")