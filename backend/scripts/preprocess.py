import os
import pandas as pd
import numpy as np

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_PATH = os.path.join(BASE_DIR, "data", "raw")

def load_and_preprocess():
    stu = pd.read_excel(os.path.join(RAW_PATH, "student_master.xlsx"))
    att = pd.read_excel(os.path.join(RAW_PATH, "attendance_logs.xlsx"))
    tt = pd.read_excel(os.path.join(RAW_PATH, "timetable.xlsx"))
    cal = pd.read_excel(os.path.join(RAW_PATH, "academic_calendar.xlsx"))

    att["Date"] = pd.to_datetime(att["Date"])
    cal["Calendar_Date"] = pd.to_datetime(cal["Date"], format="%d-%m-%Y", errors="coerce")

    # Filter out inactive students for modeling
    active_stu = stu[stu["Status"] == "Active"].copy()
    active_regs = set(active_stu["Reg No"])
    att_active = att[att["Reg No"].isin(active_regs)].copy()

    # Melt period columns P1 through P7
    melted = att_active.melt(
        id_vars=["Date", "Day", "Reg No", "Student Name"],
        value_vars=["P1", "P2", "P3", "P4", "P5", "P6", "P7"],
        var_name="Period_Str",
        value_name="Period_Status"
    )
    melted["Period"] = melted["Period_Str"].apply(lambda x: int(x[1]))
    melted["Is_Present"] = (melted["Period_Status"] == "P").astype(int)

    # Join timetable & calendar
    merged = melted.merge(tt, on=["Day", "Period"], how="left")
    merged = merged.merge(
        cal[["Calendar_Date", "Is_Holiday", "Is_Working_Day", "Is_Before_Holiday", "Is_After_Holiday", "Holiday_Name"]],
        left_on="Date",
        right_on="Calendar_Date",
        how="left"
    )

    merged = merged.sort_values(["Date", "Period", "Reg No"]).reset_index(drop=True)
    return active_stu, att, tt, cal, merged

def build_features(merged):
    dfs = []
    for reg, grp in merged.groupby("Reg No"):
        grp = grp.sort_values(["Date", "Period"]).reset_index(drop=True)
        
        # Expanding lag-1 features (No leakage: prediction at row t uses strictly rows < t)
        grp["Hist_Conducted"] = grp.index
        grp["Hist_Attended"] = grp["Is_Present"].shift(1).fillna(1).cumsum()
        grp["Hist_Rate"] = np.where(grp["Hist_Conducted"] > 0, (grp["Hist_Attended"] / grp["Hist_Conducted"]) * 100.0, 100.0)

        # Day-of-week absence tendency
        grp["DOW_Lag"] = grp.groupby("Day")["Is_Present"].shift(1)
        grp["DOW_Rate"] = grp.groupby("Day")["DOW_Lag"].transform(lambda s: s.expanding().mean()).fillna(0.9)

        # Post-holiday absence tendency
        post_hol_lag = grp[grp["Is_After_Holiday"] == 1]["Is_Present"].shift(1)
        grp["Post_Holiday_Rate"] = post_hol_lag.expanding().mean().reindex(grp.index).ffill().fillna(0.9)

        dfs.append(grp)

    return pd.concat(dfs, ignore_index=True)