import os
import sqlite3
import pandas as pd

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("DATA_DIR", os.path.join(BASE_DIR, "data"))
DB_PATH = os.path.join(DATA_DIR, "attendai.db")
RAW_PATH = os.path.join(DATA_DIR, "raw")

def migrate():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    
    mapping = [
        ("students", "student_master.xlsx"),
        ("timetable", "timetable.xlsx"),
        ("calendar", "academic_calendar.xlsx"),
        ("attendance_logs", "attendance_logs.xlsx")
    ]

    for table_name, filename in mapping:
        f_path = os.path.join(RAW_PATH, filename)
        if os.path.exists(f_path):
            df = pd.read_excel(f_path)
            df.to_sql(table_name, conn, if_exists="replace", index=False)
            print(f"Successfully migrated {filename} into SQLite table '{table_name}'.")
        else:
            print(f"Warning: File {filename} not found at {f_path}")

    conn.close()
    print(f"SQLite Database successfully initialized at {DB_PATH}")

if __name__ == "__main__":
    migrate()