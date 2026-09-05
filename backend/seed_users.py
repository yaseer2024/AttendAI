import os
import bcrypt
import pandas as pd

RAW_PATH = os.path.join("data", "raw")
STU_PATH = os.path.join(RAW_PATH, "student_master.xlsx")
TT_PATH = os.path.join(RAW_PATH, "timetable.xlsx")
OUT_PATH = os.path.join(RAW_PATH, "users.xlsx")

def hash_pw(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

users = []

# 1. Head of Department
users.append({
    "username": "hod_cse",
    "password_hash": hash_pw("hod123"),
    "role": "hod",
    "reg_no": None,
    "name": "Head of Department (CSE)"
})

# 2. Faculty Accounts (from timetable.xlsx)
if os.path.exists(TT_PATH):
    tt_df = pd.read_excel(TT_PATH)
    faculties = sorted([f for f in tt_df["Faculty"].dropna().unique() if str(f).strip()])
    for f in faculties:
        uname = str(f).lower().replace(" ", "_").replace(".", "")
        users.append({
            "username": uname,
            "password_hash": hash_pw("faculty123"),
            "role": "faculty",
            "reg_no": None,
            "name": str(f)
        })

# Default fallback faculty account
users.append({
    "username": "faculty",
    "password_hash": hash_pw("faculty123"),
    "role": "faculty",
    "reg_no": None,
    "name": "Class Advisor (CSE)"
})

# 3. All Active Students (from student_master.xlsx)
if os.path.exists(STU_PATH):
    stu_df = pd.read_excel(STU_PATH)
    active_stus = stu_df[stu_df["Status"] == "Active"]
    for _, r in active_stus.iterrows():
        reg_str = str(r["Reg No"]).strip()
        last4 = reg_str[-4:] if len(reg_str) >= 4 else reg_str
        users.append({
            "username": reg_str,
            "password_hash": hash_pw(f"stu@{last4}"),
            "role": "student",
            "reg_no": reg_str,
            "name": str(r["Student Name"]).strip()
        })

df_out = pd.DataFrame(users)
df_out.to_excel(OUT_PATH, index=False)
print(f"Successfully generated {len(df_out)} user accounts in {OUT_PATH}!")