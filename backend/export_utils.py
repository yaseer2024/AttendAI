import sqlite3
import pandas as pd
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("DATA_DIR", os.path.join(BASE_DIR, "data"))
DB_PATH = os.path.join(DATA_DIR, "attendai.db")

def export_sqlite_to_excel(output_path=None):
    if not output_path:
        output_path = os.path.join(DATA_DIR, "raw", "compliance_export.xlsx")
        
    conn = sqlite3.connect(DB_PATH)
    
    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        pd.read_sql("SELECT * FROM students", conn).to_excel(writer, sheet_name="Students", index=False)
        pd.read_sql("SELECT * FROM attendance_logs", conn).to_excel(writer, sheet_name="Attendance", index=False)
        pd.read_sql("SELECT * FROM timetable", conn).to_excel(writer, sheet_name="Timetable", index=False)
        
    conn.close()
    print(f"Compliance workbook successfully generated at {output_path}")

if __name__ == "__main__":
    export_sqlite_to_excel()