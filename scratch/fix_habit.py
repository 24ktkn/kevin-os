import os

pages_dir = 'c:/Users/Kevin/Desktop/kevin-os/pages'
for f in os.listdir(pages_dir):
    if 'Habit' in f:
        path = os.path.join(pages_dir, f)
        with open(path, 'r', encoding='utf-8') as file:
            content = file.read()
        
        target1 = """    if df is None or df.empty or "Date" not in df.columns:
        df = pd.DataFrame(columns=["Date"] + HABITS_LIST)
except Exception:
    df = pd.DataFrame(columns=["Date"] + HABITS_LIST)"""
        
        replacement1 = """    if df is None or df.empty or "Date" not in df.columns:
        st.error("⚠️ Critical Error: The 'Habits' sheet is empty or missing the 'Date' header. To prevent data loss, automatic syncing has been paused. Please check Google Sheets.")
        st.stop()
except Exception as e:
    st.error(f"⚠️ Critical Error loading Habits sheet: {e}")
    st.stop()"""
        
        if target1 in content:
            new_content = content.replace(target1, replacement1)
            with open(path, 'w', encoding='utf-8') as file:
                file.write(new_content)
            print(f"Successfully fixed {f.encode('utf-8')}")
        else:
            print(f"Target not found in {f.encode('utf-8')}")
