from datetime import date, datetime, timedelta
import io
import math
import os
from typing import Any, Dict, List, Optional, Tuple

import bcrypt
import jwt
import numpy as np
import pandas as pd
from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
import sqlite3

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("DATA_DIR", os.path.join(BASE_DIR, "data"))
DB_PATH = os.path.join(DATA_DIR, "attendai.db")
USERS_PATH = os.path.join(DATA_DIR, "raw", "users.xlsx")
OVERRIDES_PATH = os.path.join(DATA_DIR, "raw", "timetable_overrides.xlsx")
SETTINGS_PATH = os.path.join(DATA_DIR, "raw", "settings.xlsx")

SECRET_KEY = os.environ.get(
    "SECRET_KEY", "attendai_institutional_security_key_2026"
)
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24

security = HTTPBearer()

app = FastAPI(title="AI Prediction RBAC & Timetable Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def clean_reg_str(val: Any) -> str:
  if val is None or pd.isna(val):
    return ""
  try:
    return str(int(float(str(val).strip())))
  except Exception:
    return str(val).strip()


def hash_pw(plain: str) -> str:
  return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
  try:
    return bcrypt.checkpw(
        plain_password.encode("utf-8"), hashed_password.encode("utf-8")
    )
  except Exception:
    return False


def get_db_connection():
  os.makedirs(DATA_DIR, exist_ok=True)
  conn = sqlite3.connect(DB_PATH)
  conn.row_factory = sqlite3.Row
  return conn


def load_from_sqlite():
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = [row[0] for row in cursor.fetchall()]
        
        required_tables = {"students", "attendance_logs", "timetable", "calendar"}
        if not required_tables.issubset(set(tables)):
            raise Exception("Missing required tables in SQLite database.")

        active_students = pd.read_sql("SELECT * FROM students", conn)
        df_att = pd.read_sql("SELECT * FROM attendance_logs", conn)
        tt = pd.read_sql("SELECT * FROM timetable", conn)
        cal = pd.read_sql("SELECT * FROM calendar", conn)
    except Exception:
        raw_dir = os.path.join(DATA_DIR, "raw")
        active_students = pd.read_excel(os.path.join(raw_dir, "student_master.xlsx"))
        df_att = pd.read_excel(os.path.join(raw_dir, "attendance_logs.xlsx"))
        tt = pd.read_excel(os.path.join(raw_dir, "timetable.xlsx"))
        cal = pd.read_excel(os.path.join(raw_dir, "academic_calendar.xlsx"))
        
        active_students.to_sql("students", conn, if_exists="replace", index=False)
        df_att.to_sql("attendance_logs", conn, if_exists="replace", index=False)
        tt.to_sql("timetable", conn, if_exists="replace", index=False)
        cal.to_sql("calendar", conn, if_exists="replace", index=False)
        conn.commit()
    finally:
        conn.close()

    active_students["Reg No Str"] = active_students["Reg No"].apply(clean_reg_str)
    df_att["Reg No Str"] = df_att["Reg No"].apply(clean_reg_str)
    df_att["Date"] = pd.to_datetime(df_att["Date"], format="mixed")
    
    date_col = cal["Calendar_Date"] if "Calendar_Date" in cal.columns else cal["Date"]
    cal["Calendar_Date"] = pd.to_datetime(date_col, format="mixed", dayfirst=True)

    p_cols = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"]
    df_melted = df_att.melt(
        id_vars=['Date', 'Day', 'Reg No', 'Student Name', 'Gender', 'Status', 'Reg No Str'],
        value_vars=p_cols,
        var_name='Period_Name',
        value_name='Attendance_Val'
    )
    df_melted['Period'] = df_melted['Period_Name'].str.extract(r'(\d+)').astype(int)
    df_melted['Is_Present'] = (df_melted['Attendance_Val'] == 'P').astype(int)

    tt['Period'] = tt['Period'].astype(int)
    merged_tt = pd.merge(df_melted, tt, on=['Day', 'Period'], how='inner')

    cal['Date_DT'] = pd.to_datetime(cal['Calendar_Date'])
    merged = pd.merge(
        merged_tt,
        cal,
        left_on="Date",
        right_on="Date_DT",
        how="inner",
        suffixes=("", "_cal"),
    )
    
    return active_students, df_att, tt, cal, merged


def load_and_preprocess():
  return load_from_sqlite()


def ensure_users_db():
  os.makedirs(os.path.join(DATA_DIR, "raw"), exist_ok=True)
  existing_users = set()
  if os.path.exists(USERS_PATH):
    try:
      df_exist = pd.read_excel(USERS_PATH)
      existing_users = set(
          clean_reg_str(u) for u in df_exist["username"].dropna()
      )
    except Exception:
      existing_users = set()

  users_list = []
  if "hod_cse" not in existing_users:
    users_list.append({
        "username": "hod_cse",
        "password_hash": hash_pw("hod123"),
        "role": "hod",
        "reg_no": None,
        "name": "Head of Department (CSE)",
    })

  if "faculty" not in existing_users:
    users_list.append({
        "username": "faculty",
        "password_hash": hash_pw("faculty123"),
        "role": "faculty",
        "reg_no": None,
        "name": "Class Advisor (CSE)",
    })

  tt_path = os.path.join(DATA_DIR, "raw", "timetable.xlsx")
  if os.path.exists(tt_path):
    tt_df = pd.read_excel(tt_path)
    faculties = sorted(
        [f for f in tt_df["Faculty"].dropna().unique() if str(f).strip()]
    )
    for f in faculties:
      uname = str(f).lower().replace(" ", "_").replace(".", "")
      if uname not in existing_users and uname not in [
          u["username"] for u in users_list
      ]:
        users_list.append({
            "username": uname,
            "password_hash": hash_pw("faculty123"),
            "role": "faculty",
            "reg_no": None,
            "name": str(f),
        })

  stu_path = os.path.join(DATA_DIR, "raw", "student_master.xlsx")
  if os.path.exists(stu_path):
    stu_df = pd.read_excel(stu_path)
    active_stus = stu_df[stu_df["Status"] == "Active"]
    for _, r in active_stus.iterrows():
      reg_clean = clean_reg_str(r["Reg No"])
      if (
          reg_clean
          and reg_clean not in existing_users
          and reg_clean not in [u["username"] for u in users_list]
      ):
        last4 = reg_clean[-4:] if len(reg_clean) >= 4 else reg_clean
        users_list.append({
            "username": reg_clean,
            "password_hash": hash_pw(f"stu@{last4}"),
            "role": "student",
            "reg_no": reg_clean,
            "name": str(r["Student Name"]).strip(),
        })

  if users_list:
    if os.path.exists(USERS_PATH):
      df_curr = pd.read_excel(USERS_PATH)
      df_curr["username"] = df_curr["username"].apply(clean_reg_str)
      df_curr["reg_no"] = df_curr["reg_no"].apply(
          lambda x: clean_reg_str(x) if pd.notna(x) else None
      )
      df_updated = pd.concat(
          [df_curr, pd.DataFrame(users_list)], ignore_index=True
      )
    else:
      df_updated = pd.DataFrame(users_list)
    df_updated.to_excel(USERS_PATH, index=False)


ensure_users_db()


def create_access_token(
    data: dict, expires_delta: Optional[timedelta] = None
) -> str:
  to_encode = data.copy()
  expire = datetime.utcnow() + (
      expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
  )
  to_encode.update({"exp": expire})
  return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> Dict[str, Any]:
  token = credentials.credentials
  try:
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    username: str = payload.get("sub")
    role: str = payload.get("role")
    reg_no: Optional[str] = (
        clean_reg_str(payload.get("reg_no"))
        if payload.get("reg_no")
        else None
    )
    name: str = payload.get("name", username)
    if username is None or role is None:
      raise HTTPException(
          status_code=status.HTTP_401_UNAUTHORIZED,
          detail="Invalid token claims",
      )
    return {"username": username, "role": role, "reg_no": reg_no, "name": name}
  except jwt.PyJWTError:
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token has expired or is invalid",
    )


def require_roles(allowed_roles: List[str]):
  def role_checker(
      current_user: Dict[str, Any] = Depends(get_current_user),
  ) -> Dict[str, Any]:
    if current_user["role"] not in allowed_roles:
      raise HTTPException(
          status_code=status.HTTP_403_FORBIDDEN,
          detail=(
              f"Access denied: Role '{current_user['role']}' is not authorized."
          ),
      )
    return current_user

  return role_checker


def sanitize_json(obj: Any) -> Any:
  if isinstance(obj, dict):
    return {str(k): sanitize_json(v) for k, v in obj.items()}
  elif isinstance(obj, (list, tuple)):
    return [sanitize_json(v) for v in obj]
  elif isinstance(obj, (np.bool_, bool)):
    return bool(obj)
  elif isinstance(obj, (np.integer, int)):
    return int(obj)
  elif isinstance(obj, (np.floating, float)):
    return 0.0 if (np.isnan(obj) or np.isinf(obj)) else float(obj)
  elif pd.isna(obj):
    return None
  return obj


def parse_date_safe(d_input: Any) -> date:
  if not d_input:
    return date(2026, 11, 28)
  d_str = str(d_input).strip()
  for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%Y/%m/%d", "%d/%m/%Y"):
    try:
      return datetime.strptime(d_str, fmt).date()
    except ValueError:
      continue
  try:
    return pd.to_datetime(d_str).date()
  except Exception:
    return date(2026, 11, 28)


def calc_safe_skips(conducted: int, attended: int, thresh: float) -> int:
  if conducted == 0:
    return 0
  return max(0, math.floor((attended - thresh * conducted) / thresh))


def calc_recovery_needed(conducted: int, attended: int, thresh: float) -> int:
  if conducted == 0 or (attended / conducted) >= thresh:
    return 0
  return max(0, math.ceil((thresh * conducted - attended) / (1.0 - thresh)))


def get_day_schedule_fast(
    target_date_str: str, tt: pd.DataFrame
) -> List[Dict[str, Any]]:
  target_dt = pd.to_datetime(parse_date_safe(target_date_str))
  day_name = target_dt.strftime("%A")

  tt_subjs = tt[tt["Day"] == day_name].copy()
  schedule_map = {}
  for _, r in tt_subjs.iterrows():
    p = int(r["Period"])
    schedule_map[p] = {
        "period": p,
        "code": str(r["Subject_Code"]),
        "name": str(r["Subject_Name"]),
        "faculty": (
            str(r["Faculty"])
            if pd.notna(r["Faculty"])
            else "Department Faculty"
        ),
        "type": str(r["Type"]),
        "is_swapped": False,
        "action_type": "Default",
        "original_period": p,
    }

  if os.path.exists(OVERRIDES_PATH):
    try:
      df_ov = pd.read_excel(OVERRIDES_PATH)
      date_ovs = df_ov[df_ov["Date"].astype(str) == target_date_str]
      for _, ov in date_ovs.iterrows():
        p = int(ov["Period"])
        if p in schedule_map:
          schedule_map[p]["code"] = str(ov["Subject_Code"])
          schedule_map[p]["name"] = str(ov["Subject_Name"])
          schedule_map[p]["faculty"] = str(ov["Faculty"])
          schedule_map[p]["type"] = str(ov["Type"])
          schedule_map[p]["is_swapped"] = True
          schedule_map[p]["action_type"] = str(
              ov.get("Action", "Custom Adjustment")
          )
          schedule_map[p]["override_id"] = str(ov["Override_ID"])
    except Exception as e:
      print("Error loading overrides:", e)

  return sorted(list(schedule_map.values()), key=lambda x: x["period"])


def compute_student_day_probability(
    reg_no_str: str,
    target_dt: pd.Timestamp,
    s_logs: pd.DataFrame,
    cal_match: pd.DataFrame,
    tt_subjs_list: List[Dict[str, Any]],
) -> Tuple[float, List[str]]:
  day_name = target_dt.strftime("%A")
  total_cond = len(s_logs)
  if total_cond == 0:
    return 5.0, ["Insufficient historical attendance records"]

  base_abs_rate = 1.0 - (s_logs["Is_Present"].sum() / total_cond)
  is_post = (
      int(cal_match.iloc[0]["Is_After_Holiday"])
      if len(cal_match) > 0 and pd.notna(cal_match.iloc[0]["Is_After_Holiday"])
      else 0
  )
  is_pre = (
      int(cal_match.iloc[0]["Is_Before_Holiday"])
      if len(cal_match) > 0 and pd.notna(cal_match.iloc[0]["Is_Before_Holiday"])
      else 0
  )

  sub_codes = [s["code"] for s in tt_subjs_list]
  has_lab = any(s["type"] == "Lab" for s in tt_subjs_list)

  dow_logs = s_logs[s_logs["Day"] == day_name]
  dow_abs = (
      (1.0 - (dow_logs["Is_Present"].sum() / len(dow_logs)))
      if len(dow_logs) > 0
      else base_abs_rate
  )

  subj_logs = s_logs[s_logs["Subject_Code"].isin(sub_codes)]
  subj_abs = (
      (1.0 - (subj_logs["Is_Present"].sum() / len(subj_logs)))
      if len(subj_logs) > 0
      else base_abs_rate
  )

  p = (0.25 * base_abs_rate) + (0.25 * dow_abs) + (0.35 * subj_abs) + (0.07 * is_post) + (0.08 * is_pre)
  reasons = []

  if is_post == 1:
    reasons.append("Post-holiday resumption absence tendency")

  if is_pre == 1:
    reasons.append("Pre-holiday early departure tendency")

  if dow_abs > base_abs_rate + 0.05:
    reasons.append(f"Recurring absence pattern on {day_name}s")

  if subj_abs > base_abs_rate + 0.05:
    reasons.append("Historical absenteeism in scheduled courses")

  if has_lab:
    reasons.append("Multi-period practical laboratory block scheduled")

  p = max(0.02, min(0.95, p))
  if not reasons:
    reasons.append("Consistent with baseline historical attendance trajectory")

  return round(float(p * 100.0), 1), reasons


class LoginRequest(BaseModel):
  username: str
  password: str


@app.post("/api/auth/login")
@app.post("/auth/login")
def login(payload: LoginRequest):
  ensure_users_db()
  df_users = pd.read_excel(USERS_PATH)
  clean_target = clean_reg_str(payload.username)
  user_row = df_users[df_users["username"].apply(clean_reg_str) == clean_target]

  if user_row.empty:
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid username or password",
    )

  user_data = user_row.iloc[0]
  stored_hash = str(user_data["password_hash"])

  if not verify_password(payload.password, stored_hash):
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid username or password",
    )

  reg_val = (
      clean_reg_str(user_data["reg_no"])
      if pd.notna(user_data["reg_no"])
      else None
  )
  token_claims = {
      "sub": str(user_data["username"]),
      "role": str(user_data["role"]),
      "reg_no": reg_val,
      "name": str(user_data["name"]),
  }

  token = create_access_token(token_claims)
  return sanitize_json(
      {"access_token": token, "token_type": "bearer", "user": token_claims}
  )


# ==================== SETTINGS (LWD SYNCHRONIZATION) ====================
class LwdPayload(BaseModel):
  lwd: str

@app.get("/api/settings/lwd")
def get_lwd():
  os.makedirs(os.path.dirname(SETTINGS_PATH), exist_ok=True)
  if os.path.exists(SETTINGS_PATH):
    try:
      df = pd.read_excel(SETTINGS_PATH)
      if not df.empty and "lwd" in df.columns:
        return {"lwd": str(df.iloc[0]["lwd"])}
    except Exception:
      pass
  return {"lwd": "2026-11-28"}

@app.post("/api/settings/lwd")
def update_lwd(
    payload: LwdPayload,
    current_user: Dict[str, Any] = Depends(require_roles(["hod"])),
):
  os.makedirs(os.path.dirname(SETTINGS_PATH), exist_ok=True)
  df = pd.DataFrame([{"lwd": payload.lwd}])
  df.to_excel(SETTINGS_PATH, index=False)
  return {"status": "success", "lwd": payload.lwd, "updated_by": current_user["username"]}


@app.get("/api/analytics")
def get_analytics(
    last_working_day: str = "2026-11-28", threshold: float = 75.0
):
  active_students, df_att, tt, cal, merged = load_and_preprocess()

  merged["Reg No Str"] = merged["Reg No"].apply(clean_reg_str)
  active_students["Reg No Str"] = active_students["Reg No"].apply(clean_reg_str)
  df_att["Reg No Str"] = df_att["Reg No"].apply(clean_reg_str)

  conn = get_db_connection()
  cursor = conn.cursor()
  cursor.execute("SELECT MAX(Date) FROM attendance_logs")
  db_max_date = cursor.fetchone()[0]
  conn.close()

  latest_log_date = pd.to_datetime(db_max_date).date() if db_max_date else merged["Date"].max().date()
  lwd_date = parse_date_safe(last_working_day)

  future_days = cal[
      (cal["Calendar_Date"].dt.date > latest_log_date)
      & (cal["Calendar_Date"].dt.date <= lwd_date)
      & (cal["Is_Working_Day"] == 1)
  ]
  day_counts = tt.groupby("Day")["Period"].count().to_dict()
  total_future_periods = int(
      future_days["Day"].map(day_counts).fillna(0).sum()
  )

  students_res = []
  for _, stu in active_students.iterrows():
    reg_clean = stu["Reg No Str"]
    s_logs = merged[merged["Reg No Str"] == reg_clean]
    cond = int(len(s_logs))
    att = int(s_logs["Is_Present"].sum())
    curr_pct = round(float(att / cond * 100.0), 1) if cond > 0 else 0.0

    safe_skips = calc_safe_skips(cond, att, T := float(threshold) / 100.0)
    recovery_needed = calc_recovery_needed(cond, att, T)

    base_rate = float(att / cond) if cond > 0 else 0.90
    mon_rate = s_logs[s_logs["Day"] == "Monday"]["Is_Present"].mean()
    mon_rate = base_rate if pd.isna(mon_rate) else float(mon_rate)

    post_hol_logs = s_logs[s_logs["Is_After_Holiday"] == 1]
    post_hol_rate = (
        float(post_hol_logs["Is_Present"].mean())
        if len(post_hol_logs) > 0
        else base_rate
    )

    pre_hol_logs = s_logs[s_logs["Is_Before_Holiday"] == 1]
    pre_hol_rate = (
        float(pre_hol_logs["Is_Present"].mean())
        if len(pre_hol_logs) > 0
        else base_rate
    )

    proj_rate = (
        (0.60 * base_rate) + (0.20 * mon_rate) + (0.20 * post_hol_rate)
    )
    proj_att = att + round(total_future_periods * proj_rate)
    proj_pct = (
        round(float(proj_att / (cond + total_future_periods) * 100.0), 1)
        if (cond + total_future_periods) > 0
        else curr_pct
    )

    theory_logs = s_logs[s_logs["Type"] == "Theory"]
    lab_logs = s_logs[s_logs["Type"] == "Lab"]
    th_cond = int(len(theory_logs))
    th_att = int(theory_logs["Is_Present"].sum())
    th_pct = round(float(th_att / th_cond * 100.0), 1) if th_cond > 0 else 0.0

    lab_cond = int(len(lab_logs))
    lab_att = int(lab_logs["Is_Present"].sum())
    lab_pct = round(float(lab_att / lab_cond * 100.0), 1) if lab_cond > 0 else 0.0

    subj_summary = (
        s_logs.groupby(["Subject_Code", "Subject_Name", "Faculty", "Type"])
        .agg(s_cond=("Is_Present", "count"), s_att=("Is_Present", "sum"))
        .reset_index()
    )

    subject_list = []
    critical_subjects_count = 0
    deficient_subject_names = []
    for _, s_row in subj_summary.iterrows():
      sub_cond = int(s_row["s_cond"])
      sub_att = int(s_row["s_att"])
      sub_pct = (
          round(float(sub_att / sub_cond * 100.0), 1) if sub_cond > 0 else 0.0
      )
      sub_skips = calc_safe_skips(sub_cond, sub_att, T)
      sub_rec = calc_recovery_needed(sub_cond, sub_att, T)

      if sub_pct < threshold:
        critical_subjects_count += 1
        sub_risk = "Deficient (<75%)"
        deficient_subject_names.append(f"{s_row['Subject_Code']} ({sub_pct}%)")
      elif sub_pct < (threshold + 5.0):
        sub_risk = "Borderline"
      else:
        sub_risk = "Compliant"

      subject_list.append({
          "code": str(s_row["Subject_Code"]),
          "name": str(s_row["Subject_Name"]),
          "faculty": (
              str(s_row["Faculty"])
              if pd.notna(s_row["Faculty"])
              else "Department Faculty"
          ),
          "type": str(s_row["Type"]),
          "conducted": sub_cond,
          "attended": sub_att,
          "percentage": sub_pct,
          "safe_skips": int(sub_skips),
          "recovery_needed": int(sub_rec),
          "risk": str(sub_risk),
      })

    if critical_subjects_count > 0:
      risk = "Critical Risk"
    elif proj_pct < threshold:
      risk = "High Risk"
    elif proj_pct < 80.0 or curr_pct < 80.0:
      risk = "Moderate Risk"
    else:
      risk = "Safe"

    students_res.append({
        "reg_no": reg_clean,
        "name": str(stu["Student Name"]),
        "gender": str(stu["Gender"]),
        "conducted": cond,
        "attended": att,
        "current_pct": curr_pct,
        "projected_pct": proj_pct,
        "safe_skips": int(safe_skips),
        "recovery_needed": int(recovery_needed),
        "risk": str(risk),
        "critical_subjects_count": int(critical_subjects_count),
        "deficient_subject_names": (
            ", ".join(deficient_subject_names)
            if deficient_subject_names
            else "None"
        ),
        "theory_pct": th_pct,
        "lab_pct": lab_pct,
        "theory_conducted": th_cond,
        "theory_attended": th_att,
        "lab_conducted": lab_cond,
        "lab_attended": lab_att,
        "monday_absence_pct": round(float(1.0 - mon_rate) * 100.0, 1),
        "post_holiday_absence_pct": round(
            float(1.0 - post_hol_rate) * 100.0, 1
        ),
        "pre_holiday_absence_pct": round(float(1.0 - pre_hol_rate) * 100.0, 1),
        "subjects": subject_list,
    })

  p_cols = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"]
  active_reg_set = set(active_students["Reg No Str"])
  df_att_active = df_att[df_att["Reg No Str"].isin(active_reg_set)].copy()
  df_att_active["Date_Str"] = pd.to_datetime(df_att_active["Date"]).dt.strftime(
      "%Y-%m-%d"
  )
  df_att_active["Absent_Count"] = (df_att_active[p_cols] == "A").sum(axis=1)
  df_att_active["Is_Absent_Day"] = df_att_active["Absent_Count"] > 0

  trend_history = []
  for d_str, day_group in df_att_active.groupby("Date_Str", sort=True):
    total_stus = int(len(day_group))
    absentees = day_group[day_group["Is_Absent_Day"]]
    absent_boys = int((absentees["Gender"] == "M").sum())
    absent_girls = int((absentees["Gender"] == "F").sum())
    total_absent = int(len(absentees))

    total_periods_conducted = total_stus * 7
    total_periods_attended = int((day_group[p_cols] == "P").sum().sum())
    pct = (
        round(
            float(total_periods_attended / total_periods_conducted * 100.0), 1
        )
        if total_periods_conducted > 0
        else 0.0
    )

    absentee_list = [
        {
            "reg_no": clean_reg_str(r["Reg No"]),
            "name": str(r["Student Name"]),
            "gender": str(r["Gender"]),
            "missed_periods": int(r["Absent_Count"]),
        }
        for _, r in absentees.iterrows()
    ]

    day_name = pd.to_datetime(d_str).strftime("%A")
    trend_history.append({
        "full_date": str(d_str),
        "display_date": pd.to_datetime(d_str).strftime("%d %b"),
        "day": str(day_name),
        "pct": pct,
        "total_students": total_stus,
        "total_absent": total_absent,
        "absent_boys": absent_boys,
        "absent_girls": absent_girls,
        "absentees": absentee_list,
    })

  raw_response = {
      "latest_log_date": str(latest_log_date),
      "total_future_periods": int(total_future_periods),
      "class_avg": (
          round(
              float(
                  sum(s["current_pct"] for s in students_res)
                  / len(students_res)
              ),
              1,
          )
          if students_res
          else 0.0
      ),
      "below_threshold_count": int(
          sum(1 for s in students_res if s["current_pct"] < threshold)
      ),
      "critical_risk_count": int(
          sum(1 for s in students_res if s["risk"] in ["Critical Risk", "High Risk"])
      ),
      "trend_history": trend_history,
      "students": students_res,
  }
  return sanitize_json(raw_response)


@app.get("/api/student/me")
def get_student_profile(
    last_working_day: str = "2026-11-28",
    threshold: float = 75.0,
    current_user: Dict[str, Any] = Depends(
        require_roles(["student", "hod", "faculty"])
    ),
):
  clean_target = clean_reg_str(
      current_user.get("reg_no") or current_user.get("username")
  )
  analytics = get_analytics(
      last_working_day=last_working_day, threshold=threshold
  )
  student_obj = next(
      (
          s
          for s in analytics["students"]
          if clean_reg_str(s["reg_no"]) == clean_target
      ),
      None,
  )

  if not student_obj:
    raise HTTPException(
        status_code=404,
        detail=(
            f"Student record '{clean_target}' not found in active database."
        ),
    )

  return sanitize_json({
      "student": student_obj,
      "latest_log_date": analytics["latest_log_date"],
      "total_future_periods": analytics["total_future_periods"],
  })


@app.get("/api/analytics/export-excel")
def export_analytics_excel(
    last_working_day: str = "2026-11-28",
    threshold: float = 75.0,
    current_user: Dict[str, Any] = Depends(require_roles(["hod", "faculty"])),
):
  analytics = get_analytics(
      last_working_day=last_working_day, threshold=threshold
  )

  cohort_rows = []
  for s in analytics["students"]:
    cohort_rows.append({
        "Register No": s["reg_no"],
        "Student Name": s["name"],
        "Gender": s["gender"],
        "Total Conducted": s["conducted"],
        "Total Attended": s["attended"],
        "Overall Attendance %": s["current_pct"],
        "Theory %": s["theory_pct"],
        "Lab %": s["lab_pct"],
        "Safe Skips": s["safe_skips"],
        "Recovery Needed": s["recovery_needed"],
        "Deficient Subjects Count": s["critical_subjects_count"],
        "Deficient Courses": s["deficient_subject_names"],
        "Risk Tier": s["risk"],
        "Projected % (to LWD)": s["projected_pct"],
    })
  df_cohort = pd.DataFrame(cohort_rows)

  timeline_rows = []
  for t in analytics["trend_history"]:
    timeline_rows.append({
        "Date": t["full_date"],
        "Day": t["day"],
        "Attendance %": t["pct"],
        "Total Absentees": t["total_absent"],
        "Absent Boys": t["absent_boys"],
        "Absent Girls": t["absent_girls"],
    })
  df_timeline = pd.DataFrame(timeline_rows)

  output = io.BytesIO()
  with pd.ExcelWriter(output, engine="openpyxl") as writer:
    df_cohort.to_excel(
        writer, sheet_name="Cohort Compliance Audit", index=False
    )
    df_timeline.to_excel(writer, sheet_name="Daily Session Trends", index=False)

  output.seek(0)
  filename = f"AAMEC_CSE_Attendance_Audit_{last_working_day}.xlsx"

  return StreamingResponse(
      output,
      media_type=(
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      ),
      headers={"Content-Disposition": f"attachment; filename={filename}"},
  )


@app.get("/api/timetable/inspect-day")
def inspect_day(date: str = Query(...)):
  _, _, tt, _, _ = load_and_preprocess()
  return sanitize_json(get_day_schedule_fast(date, tt))


class ExecuteSwapPayload(BaseModel):
  date: str
  period_a: int
  period_b: int
  mode: str = "swap"


@app.post("/api/timetable/execute-swap")
def execute_swap(
    payload: ExecuteSwapPayload,
    current_user: Dict[str, Any] = Depends(require_roles(["hod", "faculty"])),
):
  date_clean = parse_date_safe(payload.date).strftime("%Y-%m-%d")
  _, _, tt, _, _ = load_and_preprocess()
  current_sched = {
      s["period"]: s for s in get_day_schedule_fast(date_clean, tt)
  }

  if (
      payload.period_a not in current_sched
      or payload.period_b not in current_sched
  ):
    raise HTTPException(
        status_code=400, detail="Invalid period slot selected"
    )

  slot_a = current_sched[payload.period_a]
  slot_b = current_sched[payload.period_b]

  op_id = f"TT-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"

  if payload.mode == "takeover":
    override_rows = [{
        "Override_ID": op_id,
        "Date": date_clean,
        "Period": payload.period_b,
        "Subject_Code": slot_a["code"],
        "Subject_Name": slot_a["name"],
        "Faculty": slot_a["faculty"],
        "Type": slot_a["type"],
        "Action": f"Taken over by {slot_a['faculty']}",
        "Created_By": current_user["username"],
    }]
    msg = (
        f"{slot_a['faculty']} successfully took over Period {payload.period_b}"
        f" on {date_clean}."
    )
  else:
    override_rows = [
        {
            "Override_ID": op_id,
            "Date": date_clean,
            "Period": payload.period_a,
            "Subject_Code": slot_b["code"],
            "Subject_Name": slot_b["name"],
            "Faculty": slot_b["faculty"],
            "Type": slot_b["type"],
            "Action": "Period Exchange",
            "Created_By": current_user["username"],
        },
        {
            "Override_ID": op_id,
            "Date": date_clean,
            "Period": payload.period_b,
            "Subject_Code": slot_a["code"],
            "Subject_Name": slot_a["name"],
            "Faculty": slot_a["faculty"],
            "Type": slot_a["type"],
            "Action": "Period Exchange",
            "Created_By": current_user["username"],
        },
    ]
    msg = (
        f"Period {payload.period_a} and Period {payload.period_b} successfully"
        f" exchanged on {date_clean}."
    )

  os.makedirs(os.path.dirname(OVERRIDES_PATH), exist_ok=True)
  if os.path.exists(OVERRIDES_PATH):
    df_ov = pd.read_excel(OVERRIDES_PATH)
    affected_periods = (
        [payload.period_b]
        if payload.mode == "takeover"
        else [payload.period_a, payload.period_b]
    )
    df_ov = df_ov[
        ~(
            (df_ov["Date"].astype(str) == date_clean)
            & (df_ov["Period"].isin(affected_periods))
        )
    ]
    df_ov = pd.concat([df_ov, pd.DataFrame(override_rows)], ignore_index=True)
  else:
    df_ov = pd.DataFrame(override_rows)

  df_ov.to_excel(OVERRIDES_PATH, index=False)
  return sanitize_json({"status": "success", "message": msg})


@app.post("/api/timetable/revert-swap")
def revert_swap(
    date: str = Query(...),
    period: Optional[int] = None,
    current_user: Dict[str, Any] = Depends(require_roles(["hod", "faculty"])),
):
  date_clean = parse_date_safe(date).strftime("%Y-%m-%d")
  if not os.path.exists(OVERRIDES_PATH):
    raise HTTPException(status_code=404, detail="No active overrides found")

  df_ov = pd.read_excel(OVERRIDES_PATH)
  if period is not None:
    df_ov = df_ov[
        ~(
            (df_ov["Date"].astype(str) == date_clean)
            & (df_ov["Period"] == int(period))
        )
    ]
  else:
    df_ov = df_ov[df_ov["Date"].astype(str) != date_clean]

  df_ov.to_excel(OVERRIDES_PATH, index=False)
  return sanitize_json({
      "status": "success",
      "message": (
          f"Overrides for {date_clean} reverted to default timetable."
      ),
  })


@app.get("/api/predict/student-upcoming")
def predict_student_upcoming(reg_no: str, last_working_day: str = "2026-11-28"):
  clean_target = clean_reg_str(reg_no)
  active_students, _, tt, cal, merged = load_and_preprocess()

  merged["Reg No Str"] = merged["Reg No"].apply(clean_reg_str)
  s_logs = merged[merged["Reg No Str"] == clean_target]

  latest_date = merged["Date"].max().date()
  lwd_date = parse_date_safe(last_working_day)

  future_working = cal[
      (cal["Calendar_Date"].dt.date > latest_date)
      & (cal["Calendar_Date"].dt.date <= lwd_date)
      & (cal["Is_Working_Day"] == 1)
  ].sort_values("Calendar_Date")

  upcoming_risks = []
  for _, cal_row in future_working.iterrows():
    f_dt = cal_row["Calendar_Date"]
    date_str = f_dt.strftime("%Y-%m-%d")
    f_subjs = get_day_schedule_fast(date_str, tt)
    if not f_subjs:
      continue

    c_match = cal[cal["Calendar_Date"] == f_dt]
    prob, reasons = compute_student_day_probability(
        clean_target, f_dt, s_logs, c_match, f_subjs
    )

    upcoming_risks.append({
        "date": date_str,
        "display_date": f_dt.strftime("%d %b %Y"),
        "day": str(f_dt.strftime("%A")),
        "probability": float(prob),
        "reasons": reasons,
        "scheduled_subjs_count": int(len(f_subjs)),
    })

  upcoming_risks.sort(key=lambda x: x["probability"], reverse=True)
  return sanitize_json(
      {"reg_no": clean_target, "highest_risk_days": upcoming_risks[:6]}
  )


@app.get("/api/predict/class-day")
def predict_class_day(target_date: str = Query(default="2026-09-07")):
  active_students, _, tt, cal, merged = load_and_preprocess()
  merged["Reg No Str"] = merged["Reg No"].apply(clean_reg_str)
  target_dt = pd.to_datetime(parse_date_safe(target_date))
  day_name = target_dt.strftime("%A")
  date_str = target_dt.strftime("%Y-%m-%d")

  cal_match = cal[cal["Calendar_Date"] == target_dt]
  is_holiday = (
      int(cal_match.iloc[0]["Is_Holiday"])
      if len(cal_match) > 0 and pd.notna(cal_match.iloc[0]["Is_Holiday"])
      else 0
  )
  holiday_name = (
      str(cal_match.iloc[0]["Holiday_Name"])
      if (
          len(cal_match) > 0
          and pd.notna(cal_match.iloc[0]["Holiday_Name"])
      )
      else None
  )

  scheduled_courses = get_day_schedule_fast(date_str, tt)

  if is_holiday == 1 or len(scheduled_courses) == 0:
    return sanitize_json({
        "date": date_str,
        "day": day_name,
        "is_working_day": False,
        "holiday_name": holiday_name
        or "Official Holiday / Non-Instructional Day",
        "scheduled_courses": [],
        "expected_attendance_pct": 0.0,
        "expected_absent_count": 0,
        "expected_present_count": 0,
        "student_predictions": [],
    })

  preds = []
  total_abs_prob_sum = 0.0
  for _, stu in active_students.iterrows():
    reg_clean = clean_reg_str(stu["Reg No"])
    s_logs = merged[merged["Reg No Str"] == reg_clean]
    prob, reasons = compute_student_day_probability(
        reg_clean, target_dt, s_logs, cal_match, scheduled_courses
    )
    total_abs_prob_sum += prob / 100.0

    tier = (
        "High Risk"
        if prob >= 20.0
        else ("Moderate Risk" if prob >= 10.0 else "Low Risk")
    )

    preds.append({
        "reg_no": reg_clean,
        "name": str(stu["Student Name"]),
        "gender": str(stu["Gender"]),
        "probability": float(prob),
        "tier": str(tier),
        "reasons": reasons,
    })

  preds.sort(key=lambda x: x["probability"], reverse=True)
  exp_absent = int(round(total_abs_prob_sum))
  total_stus = int(len(active_students))
  exp_present = int(total_stus - exp_absent)
  exp_att_pct = (
      round(float(exp_present / total_stus * 100.0), 1)
      if total_stus > 0
      else 0.0
  )

  return sanitize_json({
      "date": date_str,
      "day": day_name,
      "is_working_day": True,
      "holiday_name": None,
      "scheduled_courses": scheduled_courses,
      "expected_attendance_pct": exp_att_pct,
      "expected_absent_count": exp_absent,
      "expected_present_count": exp_present,
      "student_predictions": preds,
  })


class AttendancePayload(BaseModel):
  date: str
  records: Dict[str, Dict[str, str]]


@app.post("/api/attendance/manual-entry")
def manual_entry(
    payload: AttendancePayload,
    current_user: Dict[str, Any] = Depends(require_roles(["hod", "faculty"])),
):
  conn = get_db_connection()
  entry_ts = parse_date_safe(payload.date).strftime("%Y-%m-%d")
  day_name = pd.to_datetime(entry_ts).day_name()

  try:
    df_stu = pd.read_sql("SELECT * FROM students", conn)

    conn.execute(
        "DELETE FROM attendance_logs WHERE date(Date) = date(?)", (entry_ts,)
    )
    conn.commit()

    new_rows = []
    for _, stu in df_stu.iterrows():
      reg_str = clean_reg_str(stu["Reg No"])
      status = stu["Status"]
      entry = payload.records.get(
          reg_str, {f"P{i}": "P" for i in range(1, 8)}
      )

      new_rows.append({
          "Date": entry_ts,
          "Day": day_name,
          "Reg No": stu["Reg No"],
          "Student Name": stu["Student Name"],
          "Gender": stu["Gender"],
          "Status": status,
          **{
              f"P{i}": (
                  None
                  if status == "Inactive"
                  else entry.get(f"P{i}", "P")
              )
              for i in range(1, 8)
          },
      })

    df_new = pd.DataFrame(new_rows)
    df_new.to_sql("attendance_logs", conn, if_exists="append", index=False)
    conn.commit()
  finally:
    conn.close()

  return sanitize_json({
      "status": "success",
      "written": len(new_rows),
      "recorded_by": current_user["username"],
  })


@app.delete("/api/attendance/delete-date")
def delete_attendance_date(
    target_date: str = Query(..., description="Target date to delete"),
    current_user: Dict[str, Any] = Depends(require_roles(["hod"])),
):
  target_clean = parse_date_safe(target_date).strftime("%Y-%m-%d")
  conn = get_db_connection()
  try:
    cursor = conn.cursor()
    cursor.execute(
        "SELECT COUNT(*) FROM attendance_logs WHERE date(Date) = date(?)",
        (target_clean,),
    )
    count = cursor.fetchone()[0]

    if count == 0:
      raise HTTPException(
          status_code=404,
          detail=f"No attendance records found for date {target_clean}",
      )

    cursor.execute(
        "DELETE FROM attendance_logs WHERE date(Date) = date(?)", (target_clean,)
    )
    conn.commit()

    cursor.execute("SELECT MAX(Date) FROM attendance_logs")
    res = cursor.fetchone()[0]
    new_latest = str(res).split(" ")[0] if res else target_clean
  finally:
    conn.close()

  return sanitize_json({
      "status": "success",
      "deleted_records": int(count),
      "target_date_removed": str(target_clean),
      "new_latest_date": str(new_latest),
      "authorized_by": current_user["username"],
  })