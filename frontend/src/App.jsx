import React, { useState, useEffect } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { 
  BarChart3, 
  UserCheck, 
  CalendarDays, 
  ClipboardCheck, 
  Search, 
  SlidersHorizontal, 
  RefreshCw, 
  FileDown, 
  Sparkles, 
  Trash2, 
  Clock, 
  LogIn, 
  LogOut, 
  Shield, 
  User, 
  KeyRound, 
  Database,
  ArrowUpDown,
  Calendar,
  X,
  ShieldAlert,
  Menu
} from "lucide-react";

const API = "/api";

const cleanStr = (val) => {
  if (val === null || val === undefined) return "";
  const s = String(val).trim();
  return s.endsWith(".0") ? s.slice(0, -2) : s;
};

export default function App() {
  const [authToken, setAuthToken] = useState(() => localStorage.getItem("attendai_token") || null);
  const [currentUser, setCurrentUser] = useState(() => {
    const saved = localStorage.getItem("attendai_user");
    return saved ? JSON.parse(saved) : null;
  });
  
  const [activeRoleTab, setActiveRoleTab] = useState("student");
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  const [tab, setTab] = useState("overview");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [data, setData] = useState(null);
  const [studentSelfData, setStudentSelfData] = useState(null);
  const [studentLatestLogDate, setStudentLatestLogDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [studentDrillSearch, setStudentDrillSearch] = useState("");
  const [lwd, setLwd] = useState("2026-11-28");
  const [threshold, setThreshold] = useState(75);
  const [selectedStudent, setSelectedStudent] = useState(null);

  const [dayFilter, setDayFilter] = useState("all");
  const [hoveredBarData, setHoveredBarData] = useState(null);

  const [targetPredictDate, setTargetPredictDate] = useState("2026-09-07");
  const [classPrediction, setClassPrediction] = useState(null);
  const [loadingPrediction, setLoadingPrediction] = useState(false);

  const [studentUpcomingDays, setStudentUpcomingDays] = useState([]);
  const [loadingForecast, setLoadingForecast] = useState(false);

  const [entryDate, setEntryDate] = useState("2026-09-04");
  const [rollCall, setRollCall] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [simMiss, setSimMiss] = useState(2);
  const [simAttend, setSimAttend] = useState(5);

  const [showSwapModal, setShowSwapModal] = useState(false);
  const [swapDate, setSwapDate] = useState("2026-09-07");
  const [swapMode, setSwapMode] = useState("swap");
  const [daySchedule, setDaySchedule] = useState([]);
  const [selectedPeriodA, setSelectedPeriodA] = useState(null);
  const [selectedPeriodB, setSelectedPeriodB] = useState(null);
  const [swapPreview, setSwapPreview] = useState(null);
  const [confirmingSwap, setConfirmingSwap] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);

  const authHeaders = () => {
    const headers = { "Content-Type": "application/json" };
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
    return headers;
  };

  const fetchLwd = async () => {
    try {
      const res = await fetch(`${API}/settings/lwd`, { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        if (json.lwd) setLwd(json.lwd);
      }
    } catch (e) {
      console.error("Failed to fetch synchronized LWD:", e);
    }
  };

  const updateServerLwd = async (newLwd) => {
    setLwd(newLwd);
    if (currentUser?.role !== "hod") return;
    try {
      await fetch(`${API}/settings/lwd`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ lwd: newLwd })
      });
      fetchAnalytics();
    } catch (e) {
      console.error("Failed to update LWD on server:", e);
    }
  };

  useEffect(() => {
    if (authToken) {
      fetchLwd();
      const interval = setInterval(fetchLwd, 5000);
      return () => clearInterval(interval);
    }
  }, [authToken]);

  const handleLogin = async (e) => {
    if (e) e.preventDefault();
    setLoggingIn(true);
    setLoginError("");

    try {
      const res = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: cleanStr(loginUsername), password: loginPassword.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.detail || "Invalid login credentials");
      }

      setAuthToken(json.access_token);
      setCurrentUser(json.user);
      localStorage.setItem("attendai_token", json.access_token);
      localStorage.setItem("attendai_user", JSON.stringify(json.user));

      if (json.user.role === "student") {
        setTab("student");
      } else {
        setTab("overview");
      }
      fetchLwd();
    } catch (err) {
      setLoginError(err.message);
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = () => {
    setAuthToken(null);
    setCurrentUser(null);
    setStudentSelfData(null);
    setSelectedStudent(null);
    setStudentLatestLogDate("");
    localStorage.removeItem("attendai_token");
    localStorage.removeItem("attendai_user");
    setLoginUsername("");
    setLoginPassword("");
    setLoginError("");
  };

  const fetchAnalytics = async () => {
    if (!authToken || currentUser?.role === "student") return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/analytics?last_working_day=${lwd}&threshold=${threshold}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error("Analytics response error");
      const json = await res.json();
      setData(json);

      if (json?.students?.length > 0) {
        if (!selectedStudent) {
          setSelectedStudent(json.students[0]);
        } else {
          const fresh = json.students.find((s) => cleanStr(s.reg_no) === cleanStr(selectedStudent.reg_no));
          setSelectedStudent(fresh || json.students[0]);
        }
      }

      const initialRoll = {};
      json?.students?.forEach((s) => {
        initialRoll[cleanStr(s.reg_no)] = { P1: "P", P2: "P", P3: "P", P4: "P", P5: "P", P6: "P", P7: "P" };
      });
      setRollCall(initialRoll);
    } catch (e) {
      console.error("Fetch analytics error:", e);
    } finally {
      setLoading(false);
    }
  };

  const fetchStudentSelf = async () => {
    if (!authToken || currentUser?.role !== "student") return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/student/me?last_working_day=${lwd}&threshold=${threshold}`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err?.detail || "Student record not found");
      }
      const json = await res.json();
      setStudentSelfData(json.student);
      setStudentLatestLogDate(json.latest_log_date);
      setSelectedStudent(json.student);
    } catch (e) {
      console.error("Student self fetch error:", e);
    } finally {
      setLoading(false);
    }
  };

  const fetchClassPrediction = async (dateStr) => {
    if (!authToken || currentUser?.role === "student") return;
    setLoadingPrediction(true);
    try {
      const res = await fetch(`${API}/predict/class-day?target_date=${dateStr}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error("Prediction response error");
      const json = await res.json();
      setClassPrediction(json);
    } catch (e) {
      console.error("Prediction response error:", e);
    } finally {
      setLoadingPrediction(false);
    }
  };

  const fetchStudentUpcoming = async (regNo) => {
    const cleanReg = cleanStr(regNo);
    if (!authToken || !cleanReg) return;
    setLoadingForecast(true);
    try {
      const res = await fetch(`${API}/predict/student-upcoming?reg_no=${cleanReg}&last_working_day=${lwd}`, {
        headers: authHeaders(),
      });
      if (!res.ok) return;
      const json = await res.json();
      setStudentUpcomingDays(json?.highest_risk_days || []);
    } catch (e) {
      console.error("Upcoming risks error:", e);
    } finally {
      setLoadingForecast(false);
    }
  };

  const fetchDaySchedule = async (dStr) => {
    try {
      const res = await fetch(`${API}/timetable/inspect-day?date=${dStr}`, { headers: authHeaders() });
      if (res.ok) {
        const json = await res.json();
        setDaySchedule(json);
        setSelectedPeriodA(null);
        setSelectedPeriodB(null);
        setSwapPreview(null);
      }
    } catch (e) {
      console.error("Schedule inspection error:", e);
    }
  };

  useEffect(() => {
    if (authToken) {
      if (currentUser?.role === "student") {
        fetchStudentSelf();
      } else {
        fetchAnalytics();
      }
    }
  }, [lwd, threshold, authToken, currentUser]);

  useEffect(() => {
    if (authToken && currentUser?.role !== "student" && tab === "future_predict") {
      fetchClassPrediction(targetPredictDate);
    }
  }, [tab, targetPredictDate, authToken, currentUser]);

  useEffect(() => {
    if (!authToken) return;
    const targetReg = currentUser?.role === "student" ? currentUser?.reg_no : selectedStudent?.reg_no;
    if (targetReg) {
      fetchStudentUpcoming(targetReg);
    }
  }, [selectedStudent, currentUser, authToken, lwd]);

  useEffect(() => {
    if (showSwapModal) {
      fetchDaySchedule(swapDate);
    }
  }, [showSwapModal, swapDate]);

  const togglePeriod = (reg, p) => {
    const rKey = cleanStr(reg);
    setRollCall((prev) => ({
      ...prev,
      [rKey]: {
        ...prev[rKey],
        [p]: prev[rKey]?.[p] === "P" ? "A" : "P",
      },
    }));
  };

  const setAllStatus = (status) => {
    const updated = {};
    data?.students?.forEach((s) => {
      updated[cleanStr(s.reg_no)] = { P1: status, P2: status, P3: status, P4: status, P5: status, P6: status, P7: status };
    });
    setRollCall(updated);
  };

  const handleSaveAttendance = async () => {
    if (currentUser?.role === "student") {
      alert("Access Denied: Students are not authorized to mark attendance.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API}/attendance/manual-entry`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ date: entryDate, records: rollCall }),
      });
      if (res.ok) {
        alert(`Attendance records committed successfully for ${entryDate}.`);
        fetchAnalytics();
        setTab("overview");
      } else {
        const err = await res.json();
        alert(err?.detail || "Authorization error occurred.");
      }
    } catch (err) {
      alert("Failed to commit attendance records.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDate = async () => {
    if (currentUser?.role !== "hod") {
      alert("Access Denied: Only the Head of Department (HOD) can delete attendance records.");
      return;
    }

    const confirmed = window.confirm(
      `Confirm Action: Permanently erase all attendance logs for ${entryDate} from attendance_logs.xlsx?`
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      const res = await fetch(`${API}/attendance/delete-date?target_date=${entryDate}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const json = await res.json();
      if (res.ok) {
        alert(`Deleted ${json.deleted_records} records for ${json.target_date_removed}. Latest date: ${json.new_latest_date}`);
        fetchAnalytics();
        setTab("overview");
      } else {
        alert(json?.detail || "No records found on this date to delete.");
      }
    } catch (err) {
      alert("Network error: Failed to delete date records.");
    } finally {
      setDeleting(false);
    }
  };

  const handleStageSwap = (periodNum) => {
    if (!selectedPeriodA) {
      setSelectedPeriodA(periodNum);
    } else if (selectedPeriodA === periodNum) {
      setSelectedPeriodA(null);
      setSelectedPeriodB(null);
      setSwapPreview(null);
    } else if (!selectedPeriodB) {
      setSelectedPeriodB(periodNum);
      const slotA = daySchedule.find((s) => s.period === selectedPeriodA);
      const slotB = daySchedule.find((s) => s.period === periodNum);
      setSwapPreview({ slotA, slotB });
    } else {
      setSelectedPeriodA(periodNum);
      setSelectedPeriodB(null);
      setSwapPreview(null);
    }
  };

  const handleCommitSwap = async () => {
    if (!selectedPeriodA || !selectedPeriodB) return;
    setConfirmingSwap(true);
    try {
      const res = await fetch(`${API}/timetable/execute-swap`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          date: swapDate,
          period_a: selectedPeriodA,
          period_b: selectedPeriodB,
          mode: swapMode
        })
      });
      const json = await res.json();
      if (res.ok) {
        alert(json.message);
        fetchDaySchedule(swapDate);
        fetchAnalytics();
      } else {
        alert(json?.detail || "Failed to execute timetable adjustment");
      }
    } catch (err) {
      alert("Network error: Failed to commit change.");
    } finally {
      setConfirmingSwap(false);
    }
  };

  const handleRevertSwap = async (periodNum = null) => {
    try {
      const url = periodNum 
        ? `${API}/timetable/revert-swap?date=${swapDate}&period=${periodNum}`
        : `${API}/timetable/revert-swap?date=${swapDate}`;
      const res = await fetch(url, {
        method: "POST",
        headers: authHeaders()
      });
      const json = await res.json();
      if (res.ok) {
        alert(json.message);
        fetchDaySchedule(swapDate);
        fetchAnalytics();
      }
    } catch (err) {
      alert("Failed to revert timetable.");
    }
  };

  const handleExportExcel = async () => {
    setExportingExcel(true);
    try {
      const res = await fetch(`${API}/analytics/export-excel?last_working_day=${lwd}&threshold=${threshold}`, {
        headers: { "Authorization": `Bearer ${authToken}` }
      });
      if (!res.ok) {
        throw new Error("Failed to generate Excel report");
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `AAMEC_CSE_Attendance_Audit_${lwd}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message || "Export failed");
    } finally {
      setExportingExcel(false);
    }
  };

  const exportDefaulterPDF = () => {
    if (!data?.students) return;
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const defaulters = data.students.filter(
      (s) => s.current_pct < threshold || s.critical_subjects_count > 0
    );

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 595.28, 75, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(255, 255, 255);
    doc.text("ANJALAI AMMAL MAHALINGAM ENGINEERING COLLEGE (AAMEC)", 40, 28);

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(148, 163, 184);
    doc.text("DEPARTMENT OF COMPUTER SCIENCE AND ENGINEERING | OFFICIAL ATTENDANCE DEFAULTER AUDIT", 40, 44);
    doc.text(`Regulation Cut-Off Rule: ${threshold}% | Target Last Working Day: ${lwd}`, 40, 58);

    doc.setTextColor(30, 41, 59);
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.text(`Generated Date: ${new Date().toLocaleDateString("en-GB")}`, 40, 95);
    doc.text(`Cohort: Semester III (CSE Section B)`, 240, 95);
    doc.text(`Total Defaulters: ${defaulters.length}`, 440, 95);

    const tableBody = defaulters.map((s, idx) => [
      idx + 1,
      cleanStr(s.reg_no),
      s.name,
      `${s.current_pct}%`,
      `${s.theory_pct}%`,
      `${s.lab_pct}%`,
      s.deficient_subject_names === "None" ? "Overall Deficit" : s.deficient_subject_names,
      `${s.recovery_needed}`,
      s.risk
    ]);

    autoTable(doc, {
      startY: 110,
      head: [
        ["#", "Register No", "Student Name", "Overall %", "Theory %", "Lab %", "Deficient Courses", "Recovery", "Risk Tier"]
      ],
      body: tableBody,
      theme: "grid",
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 8,
        halign: "center"
      },
      bodyStyles: {
        fontSize: 7.5,
        textColor: [15, 23, 42]
      },
      columnStyles: {
        0: { halign: "center", cellWidth: 20 },
        1: { halign: "center", cellWidth: 70 },
        2: { cellWidth: 100 },
        3: { halign: "center", fontStyle: "bold", cellWidth: 50 },
        4: { halign: "center", cellWidth: 45 },
        5: { halign: "center", cellWidth: 40 },
        6: { cellWidth: 105 },
        7: { halign: "center", cellWidth: 50 },
        8: { halign: "center", fontStyle: "bold", cellWidth: 55 }
      }
    });

    const finalY = doc.lastAutoTable.finalY + 50;
    if (finalY < 760) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text("____________________________", 60, finalY);
      doc.text("Faculty Advisor", 95, finalY + 14);

      doc.text("____________________________", 400, finalY);
      doc.text("Head of Department (CSE)", 415, finalY + 14);
    }

    doc.save(`AAMEC_CSE_Defaulter_Notice_${lwd}.pdf`);
  };

  // ==================== 1. FULL-SCREEN LOGIN SCREEN ====================
  if (!authToken || !currentUser) {
    return (
      <div className="min-h-screen bg-[#141210] flex flex-col items-center justify-center p-4 sm:p-6 text-stone-200 antialiased font-sans">
        <div className="w-full max-w-md bg-[#1c1a17] border border-stone-800 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-1 bg-gradient-to-r from-transparent via-[#2bab98] to-transparent"></div>

          <div className="flex flex-col items-center text-center space-y-3">
            <div className="relative">
              <div className="absolute inset-0 -m-3 rounded-full bg-[#e8b84b]/20 blur-xl"></div>
              <div className="h-16 w-16 bg-white/95 rounded-2xl p-1.5 shadow-xl border border-stone-700/60 flex items-center justify-center relative">
                <img 
                  src="/logo.png" 
                  alt="AAMEC Emblem" 
                  className="h-full w-full object-contain"
                  onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.parentElement.innerHTML = '<span class="font-bold text-stone-900 text-sm">AAMEC</span>';
                  }}
                />
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-['Fraunces'] font-medium tracking-tight text-white flex items-center justify-center gap-2">
                AI Prediction
                <span className="h-1.5 w-1.5 rounded-full bg-[#e8b84b] mb-1"></span>
              </h1>
              <p className="text-xs text-stone-400 mt-1">
                Anjalai Ammal Mahalingam Engineering College
              </p>
              <p className="text-[11px] text-stone-600">CSE Department, Attendance Portal</p>
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-[11px] text-stone-500 block text-center">
              Select portal role
            </span>
            <div className="grid grid-cols-3 gap-2 p-1 bg-stone-900/80 border border-stone-800 rounded-2xl">
              <button
                type="button"
                onClick={() => {
                  setActiveRoleTab("student");
                  setLoginUsername("");
                  setLoginPassword("");
                  setLoginError("");
                }}
                className={`py-2 rounded-xl text-xs font-semibold transition ${
                  activeRoleTab === "student"
                    ? "bg-[#1c8f7f] text-white shadow-sm"
                    : "text-stone-400 hover:text-white"
                }`}
              >
                Student
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveRoleTab("faculty");
                  setLoginUsername("");
                  setLoginPassword("");
                  setLoginError("");
                }}
                className={`py-2 rounded-xl text-xs font-semibold transition ${
                  activeRoleTab === "faculty"
                    ? "bg-[#1c8f7f] text-white shadow-sm"
                    : "text-stone-400 hover:text-white"
                }`}
              >
                Faculty
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveRoleTab("hod");
                  setLoginUsername("hod_cse");
                  setLoginPassword("hod123");
                  setLoginError("");
                }}
                className={`py-2 rounded-xl text-xs font-semibold transition ${
                  activeRoleTab === "hod"
                    ? "bg-[#1c8f7f] text-white shadow-sm"
                    : "text-stone-400 hover:text-white"
                }`}
              >
                HOD
              </button>
            </div>
          </div>

          <div className="bg-stone-900/40 border border-stone-800/80 rounded-2xl p-3.5 text-[11px] text-stone-400 space-y-1">
            {activeRoleTab === "student" && (
              <>
                <p className="text-emerald-300 font-semibold flex items-center gap-1.5">
                  <User size={13} /> Student authentication
                </p>
                <p>Username: Any 12-digit Register No (e.g. <span className="font-mono text-stone-200">820424104048</span>)</p>
                <p>Default Password: <span className="font-mono text-emerald-400">stu@&lt;last4digits&gt;</span> (e.g. <span className="font-mono text-emerald-400">stu@4048</span>)</p>
              </>
            )}
            {activeRoleTab === "faculty" && (
              <>
                <p className="text-sky-300 font-semibold flex items-center gap-1.5">
                  <User size={13} /> Department Faculty
                </p>
                <p>Username: <span className="font-mono text-stone-200">faculty</span> or name handle</p>
                <p>Default Password: <span className="font-mono text-sky-400">faculty123</span></p>
              </>
            )}
            {activeRoleTab === "hod" && (
              <>
                <p className="text-purple-300 font-semibold flex items-center gap-1.5">
                  <Shield size={13} /> Head of Department
                </p>
                <p>Username: <span className="font-mono text-stone-200">hod_cse</span></p>
                <p>Default Password: <span className="font-mono text-purple-400">hod123</span></p>
              </>
            )}
          </div>

          <form onSubmit={handleLogin} className="space-y-4 pt-1">
            <div>
              <label className="text-xs font-medium text-stone-300 block mb-1.5 flex items-center gap-1.5">
                <User size={13} className="text-[#4fd8c4]" />
                {activeRoleTab === "student" ? "Register Number" : "Username"}
              </label>
              <input
                type="text"
                required
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                placeholder={activeRoleTab === "student" ? "Enter 12-digit register number..." : "Enter username..."}
                className="w-full bg-[#141210] border border-stone-800 rounded-xl px-3.5 py-2.5 text-xs font-mono text-stone-200 placeholder-stone-600 outline-none focus:border-[#2bab98] transition"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-stone-300 block mb-1.5 flex items-center gap-1.5">
                <KeyRound size={13} className="text-[#4fd8c4]" /> Password
              </label>
              <input
                type="password"
                required
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Enter password..."
                className="w-full bg-[#141210] border border-stone-800 rounded-xl px-3.5 py-2.5 text-xs font-mono text-stone-200 placeholder-stone-600 outline-none focus:border-[#2bab98] transition"
              />
            </div>

            {loginError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-medium flex items-center gap-2">
                <ShieldAlert size={15} className="shrink-0" />
                <span>{loginError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loggingIn}
              className="w-full bg-[#1c8f7f] hover:bg-[#22a894] text-white py-3 rounded-xl text-xs font-semibold transition shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loggingIn ? (
                <>
                  <RefreshCw className="animate-spin" size={14} /> Authenticating...
                </>
              ) : (
                <>
                  <LogIn size={14} /> Enter Academic Portal
                </>
              )}
            </button>
          </form>

          <p className="text-[10px] text-stone-500 text-center">
            Encrypted with JWT &amp; bcrypt institutional tokens
          </p>
        </div>
      </div>
    );
  }

  // ==================== 2. MAIN APPLICATION (AUTHENTICATED) ====================

  const isStudent = currentUser?.role === "student";
  const isHOD = currentUser?.role === "hod";
  const isFaculty = currentUser?.role === "faculty";

  const activeStudent = isStudent 
    ? (studentSelfData || data?.students?.find((s) => cleanStr(s.reg_no) === cleanStr(currentUser?.reg_no)) || selectedStudent)
    : (selectedStudent || data?.students?.[0]);

  const displayedTimeline = (data?.trend_history || []).filter((pt) => {
    if (dayFilter === "below75") return pt.pct < threshold;
    if (dayFilter === "below85") return pt.pct < 85;
    return true;
  });

  const synchronizedDate = isStudent 
    ? (studentLatestLogDate || "2026-09-03") 
    : (data?.latest_log_date || "2026-09-03");

  const filteredCohort = (data?.students || []).filter((s) => {
    if (!studentDrillSearch.trim()) return true;
    const q = studentDrillSearch.toLowerCase();
    return cleanStr(s.reg_no).includes(q) || s.name.toLowerCase().includes(q);
  });

  return (
    <div className="relative flex flex-col lg:flex-row h-screen overflow-hidden bg-[#141210] text-stone-200 font-sans antialiased">
      <div className="pointer-events-none absolute -top-32 -right-32 w-[32rem] h-[32rem] rounded-full bg-[#1c8f7f]/[0.07] blur-[120px] z-0"></div>
      <div className="pointer-events-none absolute bottom-0 left-1/3 w-[26rem] h-[26rem] rounded-full bg-[#e8b84b]/[0.04] blur-[120px] z-0"></div>

      {/* MOBILE HEADER BAR */}
      <div className="relative z-10 lg:hidden flex items-center justify-between bg-[#1c1a17] border-b border-stone-800 p-4 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 bg-white/95 rounded-xl p-0.5 flex items-center justify-center shadow border border-stone-700/60">
            <img src="/logo.png" alt="AAMEC" className="h-full w-full object-contain" />
          </div>
          <span className="font-semibold text-xs text-white">AI Prediction</span>
        </div>
        <button 
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 rounded-xl bg-stone-800 text-stone-200"
        >
          {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* RESPONSIVE SIDEBAR / DRAWER */}
      <aside className={`absolute lg:relative z-40 inset-y-0 left-0 w-64 bg-[#1c1a17] border-r border-stone-800/60 flex flex-col justify-between p-4 transition-transform duration-200 select-none ${
        mobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      }`}>
        <div className="space-y-6">
          <div className="hidden lg:flex items-center gap-3 px-2 py-1.5 rounded-xl">
            <div className="h-10 w-10 bg-white/95 rounded-xl p-0.5 flex items-center justify-center shadow-md shadow-black/40 border border-stone-700/60 overflow-hidden shrink-0">
              <img 
                src="/logo.png" 
                alt="AAMEC Logo" 
                className="h-full w-full object-contain"
                onError={(e) => {
                  e.target.style.display = 'none';
                  e.target.parentElement.innerHTML = '<span class="font-bold text-stone-900 text-xs">AAMEC</span>';
                }}
              />
            </div>
            <div className="leading-tight">
              <h1 className="font-semibold text-sm tracking-tight text-white flex items-center gap-1.5">
                AI Prediction
                <span className="h-1.5 w-1.5 rounded-full bg-[#e8b84b]"></span>
              </h1>
              <p className="text-[10px] text-stone-400">AAMEC, CSE Dept</p>
            </div>
          </div>

          <nav className="space-y-1">
            {!isStudent && (
              <button
                onClick={() => { setTab("overview"); setMobileMenuOpen(false); }}
                className={`w-full flex items-center gap-3 px-3.5 py-3 lg:py-2.5 rounded-xl text-xs font-medium tracking-wide transition-all ${
                  tab === "overview"
                    ? "bg-[#1c8f7f]/15 text-white font-semibold border border-[#1c8f7f]/40 shadow-sm"
                    : "text-stone-400 hover:bg-stone-800/30 hover:text-stone-200"
                }`}
              >
                <BarChart3 size={16} className={tab === "overview" ? "text-[#4fd8c4]" : "text-stone-500"} />
                Class Overview
              </button>
            )}

            <button
              onClick={() => { setTab("student"); setMobileMenuOpen(false); }}
              className={`w-full flex items-center gap-3 px-3.5 py-3 lg:py-2.5 rounded-xl text-xs font-medium tracking-wide transition-all ${
                tab === "student"
                  ? "bg-[#1c8f7f]/15 text-white font-semibold border border-[#1c8f7f]/40 shadow-sm"
                  : "text-stone-400 hover:bg-stone-800/30 hover:text-stone-200"
              }`}
            >
              <UserCheck size={16} className={tab === "student" ? "text-[#4fd8c4]" : "text-stone-500"} />
              {isStudent ? "My Attendance & Compliance" : "Student Analytics"}
            </button>

            {!isStudent && (
              <button
                onClick={() => { setTab("future_predict"); setMobileMenuOpen(false); }}
                className={`w-full flex items-center gap-3 px-3.5 py-3 lg:py-2.5 rounded-xl text-xs font-medium tracking-wide transition-all ${
                  tab === "future_predict"
                    ? "bg-[#1c8f7f]/15 text-white font-semibold border border-[#1c8f7f]/40 shadow-sm"
                    : "text-stone-400 hover:bg-stone-800/30 hover:text-stone-200"
                }`}
              >
                <Sparkles size={16} className={tab === "future_predict" ? "text-[#4fd8c4]" : "text-stone-500"} />
                Risk Forecaster
              </button>
            )}

            {!isStudent && (
              <button
                onClick={() => { setTab("entry"); setMobileMenuOpen(false); }}
                className={`w-full flex items-center gap-3 px-3.5 py-3 lg:py-2.5 rounded-xl text-xs font-medium tracking-wide transition-all ${
                  tab === "entry"
                    ? "bg-[#1c8f7f]/15 text-white font-semibold border border-[#1c8f7f]/40 shadow-sm"
                    : "text-stone-400 hover:bg-stone-800/30 hover:text-stone-200"
                }`}
              >
                <ClipboardCheck size={16} className={tab === "entry" ? "text-[#4fd8c4]" : "text-stone-500"} />
                Daily Roll Call
              </button>
            )}
          </nav>
        </div>

        <div className="space-y-3 pt-4">
          <div className="bg-[#221f1b] border border-stone-800/80 rounded-2xl p-3.5 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-stone-500">
                Active session
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${
                isHOD 
                  ? "bg-purple-500/10 text-purple-300 border-purple-500/20"
                  : isFaculty 
                  ? "bg-sky-500/10 text-sky-300 border-sky-500/20"
                  : "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
              }`}>
                {currentUser.role === "hod" ? "HOD" : currentUser.role}
              </span>
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-stone-800/60">
              <div className="truncate pr-2">
                <p className="font-semibold text-white truncate text-xs">{currentUser.name}</p>
                <p className="text-[10px] font-mono text-stone-400 truncate">{cleanStr(currentUser.username)}</p>
              </div>
              <button
                onClick={handleLogout}
                title="Sign Out"
                className="p-2 rounded-lg hover:bg-stone-800 text-stone-400 hover:text-rose-400 transition"
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>

          <div className="bg-[#221f1b] border border-stone-800/80 rounded-2xl p-3.5 space-y-3 text-xs">
            {!isStudent && (
              <>
                <div>
                  <label className="text-stone-400 font-medium block mb-1 text-[11px] flex items-center gap-1.5">
                    <CalendarDays size={12} className="text-[#4fd8c4]" /> Last Working Day
                  </label>
                  <input
                    type="date"
                    value={lwd}
                    disabled={!isHOD}
                    onChange={(e) => updateServerLwd(e.target.value)}
                    className="w-full bg-[#141210] border border-stone-800 rounded-lg px-2.5 py-1.5 text-stone-200 font-mono text-xs focus:border-[#2bab98] outline-none disabled:opacity-60"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-stone-400 mb-1 font-medium text-[11px]">
                    <span>Regulation Cutoff</span>
                    <span className="text-[#4fd8c4] font-mono font-bold">{threshold}%</span>
                  </div>
                  <input
                    type="range"
                    min="65"
                    max="85"
                    disabled={!isHOD}
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    className="w-full accent-[#2bab98] cursor-pointer disabled:opacity-60"
                  />
                </div>
              </>
            )}

            <div className={`pt-2 ${!isStudent ? "border-t border-stone-800/80" : ""} text-[10px] text-stone-400 flex items-center justify-between`}>
              <span className="flex items-center gap-1.5 text-stone-400">
                <Database size={12} className="text-[#4fd8c4]" /> Log Synced:
              </span>
              <span className="text-emerald-400 font-semibold font-mono bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                {synchronizedDate}
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT WORKSPACE */}
      <main className="relative z-10 flex-1 overflow-y-auto p-4 sm:p-8 space-y-6">
        
        {/* ==================== VIEW 1: CLASS OVERVIEW ==================== */}
        {tab === "overview" && !isStudent && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-lg sm:text-xl font-semibold tracking-tight text-white">Class Overview & Deficit Diagnostics</h2>
                <p className="text-xs text-stone-400 mt-0.5">
                  Cohort: <span className="text-stone-200 font-mono">{data?.students?.length || 0} enrolled</span> • {data?.total_future_periods || 0} slots remaining through {lwd}
                </p>
              </div>

              <div className="flex items-center gap-2.5 flex-wrap">
                <button
                  onClick={handleExportExcel}
                  disabled={exportingExcel}
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2.5 rounded-xl text-xs font-medium transition shadow-sm border border-emerald-500/30 w-full sm:w-auto justify-center disabled:opacity-50"
                >
                  <Database size={14} /> {exportingExcel ? "Generating..." : "Export Excel Report"}
                </button>

                <button
                  onClick={exportDefaulterPDF}
                  className="flex items-center gap-2 bg-[#1c8f7f] hover:bg-[#22a894] text-white px-4 py-2.5 rounded-xl text-xs font-medium transition shadow-sm border border-[#2bab98]/30 w-full sm:w-auto justify-center"
                >
                  <FileDown size={14} /> Export Defaulters (PDF)
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div className="bg-[#1c1a17] border border-stone-800/80 border-t-2 border-t-[#1c8f7f] rounded-2xl p-4 shadow-lg shadow-black/20">
                <span className="text-xs text-stone-400 font-medium">Class Attendance Mean</span>
                <p className="text-xl sm:text-2xl font-bold font-mono text-white mt-1">{data?.class_avg}%</p>
                <span className="text-[10px] text-stone-500">Cohort-wide sessions</span>
              </div>
              <div className="bg-[#1c1a17] border border-stone-800/80 border-t-2 border-t-rose-500 rounded-2xl p-4 shadow-lg shadow-black/20">
                <span className="text-xs text-stone-400 font-medium">Students Below {threshold}%</span>
                <p className="text-xl sm:text-2xl font-bold font-mono text-rose-400 mt-1">{data?.below_threshold_count}</p>
                <span className="text-[10px] text-stone-500">Regulation shortfall</span>
              </div>
              <div className="bg-[#1c1a17] border border-stone-800/80 border-t-2 border-t-amber-500 rounded-2xl p-4 shadow-lg shadow-black/20">
                <span className="text-xs text-stone-400 font-medium">Flagged Deficit Risks</span>
                <p className="text-xl sm:text-2xl font-bold font-mono text-amber-400 mt-1">{data?.critical_risk_count}</p>
                <span className="text-[10px] text-stone-500">Subject shortfall candidates</span>
              </div>
              <div className="bg-[#1c1a17] border border-stone-800/80 border-t-2 border-t-[#e8b84b] rounded-2xl p-4 shadow-lg shadow-black/20">
                <span className="text-xs text-stone-400 font-medium">Remaining Slots</span>
                <p className="text-xl sm:text-2xl font-bold font-mono text-[#4fd8c4] mt-1">{data?.total_future_periods}</p>
                <span className="text-[10px] text-stone-500">Bound strictly to {lwd}</span>
              </div>
            </div>

            {/* VISUAL SEMESTER TREND ANALYTICS & INTERACTIVE TIMELINE */}
            <div className="bg-[#1c1a17] border border-stone-800/80 rounded-2xl p-4 sm:p-5 space-y-3 relative">
              <div className="flex justify-between items-center flex-wrap gap-2">
                <div>
                  <h3 className="text-[13px] font-semibold text-stone-200">
                    Visual Semester Attendance Trajectory & Holiday Impact Dips
                  </h3>
                  <p className="text-[10px] text-stone-400 mt-0.5">
                    Interactive daily bar graph tracking cohort participation against the {threshold}% regulation line
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-stone-400 bg-stone-800 px-2.5 py-1 rounded-lg border border-stone-700">
                    Total Sessions: {displayedTimeline.length}
                  </span>
                </div>
              </div>
              
              <div className="h-44 sm:h-52 w-full flex items-end gap-0.5 sm:gap-1 pt-4 relative overflow-hidden">
                {displayedTimeline.map((pt) => {
                  const heightPct = Math.max(12, Math.min(100, (pt.pct - 65) * 2.8));
                  const isDeficient = pt.pct < threshold;
                  const isWarning = pt.pct < 85;
                  const isHovered = hoveredBarData?.full_date === pt.full_date;
                  return (
                    <button
                      key={pt.full_date}
                      type="button"
                      onClick={() => setHoveredBarData(pt)}
                      className={`flex-1 rounded-t transition-all duration-150 relative z-20 hover:brightness-110 ${
                        isHovered ? "ring-2 ring-amber-300 scale-105" : ""
                      }`}
                      style={{
                        height: `${heightPct}%`,
                        backgroundImage: isHovered
                          ? "linear-gradient(180deg, #fbbf24, #d97706)"
                          : isDeficient
                          ? "linear-gradient(180deg, #fb7185, #e11d48)"
                          : isWarning
                          ? "linear-gradient(180deg, #fbbf24, #d97706)"
                          : "linear-gradient(180deg, #4fd8c4, #1c8f7f)",
                      }}
                    />
                  );
                })}
              </div>

              {hoveredBarData && (
                <div className="mt-3 p-4 bg-stone-900 border border-stone-700 rounded-2xl shadow-xl flex flex-col gap-3 animate-in fade-in">
                  <div className="flex justify-between items-center border-b border-stone-800 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white text-xs">{hoveredBarData.display_date} ({hoveredBarData.day})</span>
                      <span className="font-mono text-[#4fd8c4] text-xs font-bold">{hoveredBarData.pct}%</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-rose-400 font-semibold font-mono">Absentees: {hoveredBarData.total_absent}</span>
                      <span className="text-stone-400 text-[11px]">({hoveredBarData.absent_boys}B • {hoveredBarData.absent_girls}G)</span>
                      <button onClick={() => setHoveredBarData(null)} className="text-stone-500 hover:text-white p-1">
                        <X size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="max-h-28 overflow-y-auto">
                    {hoveredBarData.absentees.length === 0 ? (
                      <p className="text-emerald-400 text-[11px]">100% Attendance recorded. No absentees on this day.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {hoveredBarData.absentees.map((a) => (
                          <span key={a.reg_no} className="px-2 py-1 rounded-lg bg-stone-800 text-[11px] text-stone-200 border border-stone-700 flex items-center gap-1">
                            <span className="font-medium text-white">{a.name}</span>
                            <span className="text-rose-400 font-mono text-[10px]">({a.missed_periods}p)</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="bg-[#1c1a17] border border-stone-800/80 rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead>
                    <tr className="border-b border-stone-800 bg-stone-900/60 text-stone-400 uppercase font-semibold">
                      <th className="p-3.5">Register No</th>
                      <th className="p-3.5">Student Name</th>
                      <th className="p-3.5">Overall %</th>
                      <th className="p-3.5">Theory %</th>
                      <th className="p-3.5">Lab %</th>
                      <th className="p-3.5">Deficient Courses</th>
                      <th className="p-3.5">Safe Skips</th>
                      <th className="p-3.5">Risk Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-800/60">
                    {(data?.students || []).map((s) => (
                      <tr
                        key={cleanStr(s.reg_no)}
                        onClick={() => {
                          setSelectedStudent(s);
                          setTab("student");
                        }}
                        className="cursor-pointer hover:bg-stone-800/40 transition"
                      >
                        <td className="p-3.5 font-mono text-stone-400">{cleanStr(s.reg_no)}</td>
                        <td className="p-3.5 font-medium text-stone-200">{s.name}</td>
                        <td className="p-3.5 font-semibold font-mono text-white">{s.current_pct}%</td>
                        <td className="p-3.5 font-mono text-stone-300">{s.theory_pct}%</td>
                        <td className="p-3.5 font-mono text-stone-300">{s.lab_pct}%</td>
                        <td className="p-3.5 font-mono">
                          {s.critical_subjects_count > 0 ? (
                            <span className="text-rose-400 font-medium">{s.critical_subjects_count} Deficient</span>
                          ) : (
                            <span className="text-emerald-400">Compliant</span>
                          )}
                        </td>
                        <td className="p-3.5 font-mono text-emerald-400 font-semibold">{s.safe_skips}</td>
                        <td className="p-3.5">
                          <span className={`px-2.5 py-1 rounded text-[10px] font-semibold border ${
                            s.risk === "Safe"
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                              : s.risk === "Moderate Risk"
                              ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                              : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                          }`}>
                            {s.risk}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ==================== VIEW 2: STUDENT DRILLDOWN / MY COMPLIANCE ==================== */}
        {tab === "student" && activeStudent && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-stone-800 pb-4">
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-white">{activeStudent.name}</h2>
                <div className="flex items-center gap-2 mt-1 text-xs text-stone-400 flex-wrap">
                  <span className="font-mono text-[#4fd8c4]">{cleanStr(activeStudent.reg_no)}</span>
                  <span>•</span>
                  <span>{activeStudent.gender === "M" ? "Male Student" : "Female Student"}</span>
                  <span>•</span>
                  <span>CSE Section B • Semester III</span>
                </div>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                {!isStudent && data?.students && (
                  <div className="flex items-center gap-2 bg-[#1c1a17] border border-stone-800 rounded-xl px-2 py-1 shadow-sm w-full sm:w-auto">
                    <Search size={14} className="text-stone-500 ml-1" />
                    <input
                      type="text"
                      placeholder="Filter student..."
                      value={studentDrillSearch}
                      onChange={(e) => setStudentDrillSearch(e.target.value)}
                      className="bg-transparent text-xs text-white placeholder-stone-500 outline-none w-28 font-mono"
                    />
                    <select
                      value={cleanStr(activeStudent.reg_no)}
                      onChange={(e) => {
                        const targetReg = cleanStr(e.target.value);
                        const found = data.students.find((s) => cleanStr(s.reg_no) === targetReg);
                        if (found) setSelectedStudent(found);
                      }}
                      className="bg-[#221f1b] border border-stone-700 text-xs font-mono text-[#8ff0dc] rounded-lg px-2 py-1 outline-none cursor-pointer max-w-[160px]"
                    >
                      {filteredCohort.map((s) => (
                        <option key={cleanStr(s.reg_no)} value={cleanStr(s.reg_no)}>
                          {cleanStr(s.reg_no)} - {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <span className={`px-3.5 py-1 rounded-lg text-xs font-semibold border ${
                  activeStudent.risk === "Safe"
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : activeStudent.risk === "Moderate Risk"
                    ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                    : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                }`}>
                  Evaluation: {activeStudent.risk}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div className="bg-[#1c1a17] border border-stone-800/80 border-t-2 border-t-[#1c8f7f] p-4 rounded-2xl shadow-lg shadow-black/20">
                <span className="text-xs text-stone-400">Overall Attendance</span>
                <p className="text-xl sm:text-2xl font-bold font-mono mt-1 text-white">{activeStudent.current_pct}%</p>
                <span className="text-[10px] text-stone-500 font-mono">
                  {activeStudent.attended} / {activeStudent.conducted} periods
                </span>
              </div>
              <div className="bg-[#1c1a17] border border-stone-800/80 border-t-2 border-t-emerald-500 p-4 rounded-2xl shadow-lg shadow-black/20">
                <span className="text-xs text-stone-400">Safe Allowed Skips</span>
                <p className="text-xl sm:text-2xl font-bold font-mono mt-1 text-emerald-400">{activeStudent.safe_skips}</p>
                <span className="text-[10px] text-stone-500">Before breaching {threshold}%</span>
              </div>
              <div className="bg-[#1c1a17] border border-stone-800/80 border-t-2 border-t-rose-500 p-4 rounded-2xl shadow-lg shadow-black/20">
                <span className="text-xs text-stone-400">Recovery Classes</span>
                <p className="text-xl sm:text-2xl font-bold font-mono mt-1 text-rose-400">{activeStudent.recovery_needed}</p>
                <span className="text-[10px] text-stone-500">Target to restore {threshold}%</span>
              </div>
              <div className="bg-[#1c1a17] border border-stone-800/80 border-t-2 border-t-[#e8b84b] p-4 rounded-2xl shadow-lg shadow-black/20">
                <span className="text-xs text-stone-400">Projected Standing</span>
                <p className="text-xl sm:text-2xl font-bold font-mono mt-1 text-[#4fd8c4]">{activeStudent.projected_pct}%</p>
                <span className="text-[10px] text-stone-500">Forecasted to LWD</span>
              </div>
            </div>

            <div className="bg-[#1c1a17] border border-stone-800/80 rounded-2xl p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock size={16} className="text-[#4fd8c4]" />
                  <h3 className="text-[13px] font-semibold text-stone-200">
                    Highest Risk Absenteeism Dates (through {lwd})
                  </h3>
                </div>
              </div>

              {loadingForecast ? (
                <div className="flex items-center justify-center py-6 text-xs text-[#4fd8c4] font-mono">
                  <RefreshCw className="animate-spin mr-2" size={15} /> Calculating risk matrix...
                </div>
              ) : studentUpcomingDays.length === 0 ? (
                <div className="text-xs text-stone-400 font-medium py-3 text-center">
                  No scheduled instructional days between current date and {lwd}.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {studentUpcomingDays.map((risk) => (
                    <div key={risk.date} className="bg-stone-900/60 border border-stone-800 rounded-xl p-3.5 space-y-1.5">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-white">{risk.display_date}</span>
                        <span className="text-[10px] font-mono text-stone-400">{risk.day}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-stone-400">Absence Probability:</span>
                        <span className={`font-mono font-bold ${
                          risk.probability >= 20 ? "text-rose-400" : (risk.probability >= 10 ? "text-amber-400" : "text-[#8ff0dc]")
                        }`}>
                          {risk.probability}%
                        </span>
                      </div>
                      <div className="text-[10px] text-stone-400 leading-snug border-t border-stone-800 pt-1.5">
                        {risk.reasons.slice(0, 1).map((r, i) => (
                          <span key={i} className="text-stone-300">• {r}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-[#1c1a17] border border-stone-800/80 rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead>
                    <tr className="border-b border-stone-800 bg-stone-900/60 text-stone-400 uppercase font-semibold">
                      <th className="p-3.5">Code</th>
                      <th className="p-3.5">Course Name</th>
                      <th className="p-3.5">Faculty</th>
                      <th className="p-3.5">Type</th>
                      <th className="p-3.5">Conducted</th>
                      <th className="p-3.5">Attended</th>
                      <th className="p-3.5">Attendance %</th>
                      <th className="p-3.5">Safe Skips</th>
                      <th className="p-3.5">Recovery</th>
                      <th className="p-3.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-800/60">
                    {(activeStudent.subjects || []).map((sub) => (
                      <tr key={`${sub.code}-${sub.name}`} className="hover:bg-stone-800/20">
                        <td className="p-3.5 font-mono text-stone-300 font-semibold">{sub.code}</td>
                        <td className="p-3.5 font-medium text-stone-200">{sub.name}</td>
                        <td className="p-3.5 text-stone-400">{sub.faculty}</td>
                        <td className="p-3.5">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${
                            sub.type === "Theory" 
                              ? "bg-stone-800 text-stone-300 border-stone-700" 
                              : "bg-[#123832] text-[#8ff0dc] border-[#1c8f7f]"
                          }`}>
                            {sub.type}
                          </span>
                        </td>
                        <td className="p-3.5 font-mono">{sub.conducted}</td>
                        <td className="p-3.5 font-mono">{sub.attended}</td>
                        <td className="p-3.5 font-mono font-bold">
                          <span className={sub.percentage < threshold ? "text-rose-400" : "text-emerald-400"}>
                            {sub.percentage}%
                          </span>
                        </td>
                        <td className="p-3.5 font-mono text-emerald-400">{sub.safe_skips}</td>
                        <td className="p-3.5 font-mono text-rose-400">{sub.recovery_needed}</td>
                        <td className="p-3.5">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            sub.risk === "Compliant" ? "text-emerald-400 bg-emerald-500/10" : "text-rose-400 bg-rose-500/10"
                          }`}>
                            {sub.risk}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-[#1c1a17] border border-[#123832]/80 rounded-2xl p-4 sm:p-6 space-y-3">
              <div className="flex items-center gap-2 text-[#4fd8c4] font-semibold text-xs">
                <SlidersHorizontal size={15} /> What-If Attendance Planning Simulator
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-1">
                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-stone-400">Simulate Missing Future Periods:</span>
                    <span className="font-mono font-bold text-rose-400">{simMiss}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="20"
                    value={simMiss}
                    onChange={(e) => setSimMiss(Number(e.target.value))}
                    className="w-full accent-rose-500 cursor-pointer h-6"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-stone-400">Simulate Attending Future Periods:</span>
                    <span className="font-mono font-bold text-emerald-400">{simAttend}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="25"
                    value={simAttend}
                    onChange={(e) => setSimAttend(Number(e.target.value))}
                    className="w-full accent-emerald-500 cursor-pointer h-6"
                  />
                </div>
              </div>

              {(() => {
                const sCond = activeStudent.conducted + simMiss + simAttend;
                const sAtt = activeStudent.attended + simAttend;
                const sPct = sCond > 0 ? ((sAtt / sCond) * 100).toFixed(1) : 0;
                const diff = (sPct - activeStudent.current_pct).toFixed(1);
                return (
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 bg-stone-900/80 rounded-xl border border-stone-800 mt-2 text-xs gap-3">
                    <div>
                      <p className="text-stone-400">Projected Attendance after simulation:</p>
                      <p className="text-lg font-bold font-mono mt-0.5 text-white">
                        {sPct}%{" "}
                        <span className={`text-xs font-semibold ${diff >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          ({diff >= 0 ? `+${diff}` : diff}%)
                        </span>
                      </p>
                    </div>
                    <span className={`px-3 py-1.5 rounded-lg font-semibold border ${
                      sPct >= threshold 
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" 
                        : "bg-rose-500/10 text-rose-400 border-rose-500/20"
                    }`}>
                      {sPct >= threshold ? `Compliant with ${threshold}%` : `Deficient (<${threshold}%)`}
                    </span>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* ==================== VIEW 3: FUTURE PREDICTOR ==================== */}
        {tab === "future_predict" && !isStudent && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg sm:text-xl font-semibold text-white">Future Date Attendance & Absentee Predictor</h2>
                <p className="text-xs text-stone-400 mt-0.5">
                  Probabilistic absence forecast based on timetable and student habits
                </p>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <label className="text-stone-400 font-medium">Target Date:</label>
                <input
                  type="date"
                  value={targetPredictDate}
                  onChange={(e) => setTargetPredictDate(e.target.value)}
                  className="bg-[#1c1a17] border border-stone-800 rounded-lg px-3 py-2 font-mono text-stone-200 outline-none focus:border-[#2bab98]"
                />
              </div>
            </div>

            {loadingPrediction ? (
              <div className="h-48 flex items-center justify-center text-xs text-[#4fd8c4] font-mono">
                <RefreshCw className="animate-spin mr-2" size={16} /> Computing behavioral projections...
              </div>
            ) : classPrediction ? (
              classPrediction.is_working_day === false ? (
                <div className="p-6 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-center space-y-1 text-xs">
                  <h3 className="font-semibold text-sm">{classPrediction.date} ({classPrediction.day}) is not an active instructional session.</h3>
                  <p className="text-stone-400">Classification: {classPrediction.holiday_name}</p>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="bg-[#1c1a17] border border-stone-800/80 border-t-2 border-t-[#1c8f7f] rounded-2xl p-4 shadow-lg shadow-black/20">
                      <span className="text-xs text-stone-400 font-medium">Forecasted Attendance</span>
                      <p className="text-xl font-bold font-mono text-[#4fd8c4] mt-1">{classPrediction.expected_attendance_pct}%</p>
                      <span className="text-[10px] text-stone-500">{classPrediction.day} timetable</span>
                    </div>
                    <div className="bg-[#1c1a17] border border-stone-800/80 border-t-2 border-t-rose-500 rounded-2xl p-4 shadow-lg shadow-black/20">
                      <span className="text-xs text-stone-400 font-medium">Predicted Absentees</span>
                      <p className="text-xl font-bold font-mono text-rose-400 mt-1">{classPrediction.expected_absent_count} students</p>
                      <span className="text-[10px] text-stone-500">Estimated non-attendance</span>
                    </div>
                    <div className="bg-[#1c1a17] border border-stone-800/80 border-t-2 border-t-stone-600 rounded-2xl p-4 shadow-lg shadow-black/20">
                      <span className="text-xs text-stone-400 font-medium">Predicted Present</span>
                      <p className="text-xl font-bold font-mono text-white mt-1">{classPrediction.expected_present_count} students</p>
                      <span className="text-[10px] text-stone-500">out of cohort</span>
                    </div>
                    <div className="bg-[#1c1a17] border border-stone-800/80 border-t-2 border-t-[#e8b84b] rounded-2xl p-4 shadow-lg shadow-black/20">
                      <span className="text-xs text-stone-400 font-medium">Scheduled Courses</span>
                      <p className="text-xl font-bold font-mono text-stone-200 mt-1">{classPrediction.scheduled_courses?.length || 0} periods</p>
                      <span className="text-[10px] text-stone-500">Instructional slots</span>
                    </div>
                  </div>

                  <div className="bg-[#1c1a17] border border-stone-800/80 rounded-2xl p-4">
                    <h3 className="text-[13px] font-semibold text-stone-300 mb-3">
                      Scheduled Timetable for {classPrediction.date} ({classPrediction.day})
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                      {(classPrediction.scheduled_courses || []).map((c) => (
                        <div key={c.period} className="bg-stone-900 border border-stone-800 p-2.5 rounded-xl text-center space-y-1">
                          <span className="text-[10px] font-mono text-[#4fd8c4] font-bold">P{c.period} • {c.type}</span>
                          <p className="text-xs font-bold font-mono text-white truncate">{c.code}</p>
                          <p className="text-[10px] text-stone-400 truncate">{c.name}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-[#1c1a17] border border-stone-800/80 rounded-2xl overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs whitespace-nowrap">
                        <thead>
                          <tr className="border-b border-stone-800 bg-stone-900/60 text-stone-400 uppercase font-semibold">
                            <th className="p-3.5">Register No</th>
                            <th className="p-3.5">Student Name</th>
                            <th className="p-3.5">Gender</th>
                            <th className="p-3.5">Absence Probability</th>
                            <th className="p-3.5">Probability Tier</th>
                            <th className="p-3.5">Contributing Factors</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-800/60">
                          {(classPrediction.student_predictions || []).map((p) => (
                            <tr key={cleanStr(p.reg_no)} className="hover:bg-stone-800/30">
                              <td className="p-3.5 font-mono text-stone-400">{cleanStr(p.reg_no)}</td>
                              <td className="p-3.5 font-medium text-stone-200">{p.name}</td>
                              <td className="p-3.5 text-[11px] text-stone-400 font-mono">
                                {p.gender === "M" ? "Male" : "Female"}
                              </td>
                              <td className="p-3.5 font-mono font-bold text-white">{p.probability}%</td>
                              <td className="p-3.5">
                                <span className={`px-2.5 py-1 rounded text-[10px] font-semibold border ${
                                  p.tier === "High Risk"
                                    ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                                    : (p.tier === "Moderate Risk"
                                    ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                    : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20")
                                }`}>
                                  {p.tier}
                                </span>
                              </td>
                              <td className="p-3.5 text-stone-300 text-xs">{p.reasons.join(" • ")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )
            ) : null}
          </div>
        )}

        {/* ==================== VIEW 4: DAILY ROLL CALL ENTRY ==================== */}
        {tab === "entry" && !isStudent && (
          <div className="space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-white">Daily Roll Call Entry</h2>
                <p className="text-xs text-stone-400 mt-0.5">
                  Period-by-period manual attendance logging written directly to Excel storage
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="date"
                  value={entryDate}
                  onChange={(e) => setEntryDate(e.target.value)}
                  className="bg-[#1c1a17] border border-stone-800 rounded-xl px-3 py-2 text-xs font-mono text-stone-200 outline-none"
                />
                
                <button
                  type="button"
                  onClick={() => setShowSwapModal(true)}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-[#123832]/40 hover:bg-[#1a4a42]/60 border border-[#1c8f7f]/60 text-[#8ff0dc] rounded-xl text-xs font-medium transition"
                >
                  <Calendar size={13} /> Timetable Console
                </button>

                <button
                  onClick={() => setAllStatus("P")}
                  className="px-3.5 py-2 bg-stone-800 hover:bg-stone-700 rounded-xl text-xs font-medium text-stone-300 transition"
                >
                  Mark All Present
                </button>
                <button
                  onClick={handleSaveAttendance}
                  disabled={saving || deleting}
                  className="px-4 py-2 bg-[#1c8f7f] hover:bg-[#22a894] rounded-xl text-xs font-medium text-white transition disabled:opacity-50 shadow-sm"
                >
                  {saving ? "Writing..." : "Commit Records"}
                </button>
                {isHOD && (
                  <button
                    onClick={handleDeleteDate}
                    disabled={saving || deleting}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-rose-950/30 hover:bg-rose-900/50 border border-rose-800/60 text-rose-300 rounded-xl text-xs font-medium transition disabled:opacity-50"
                    title="Erase all logged attendance for this date"
                  >
                    <Trash2 size={13} /> {deleting ? "Reverting..." : "Revert Date"}
                  </button>
                )}
              </div>
            </div>

            <div className="bg-[#1c1a17] border border-stone-800/80 rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs whitespace-nowrap">
                  <thead>
                    <tr className="border-b border-stone-800 bg-stone-900/60 text-stone-400 uppercase font-semibold">
                      <th className="p-3.5">Register No</th>
                      <th className="p-3.5">Student Name</th>
                      {["P1", "P2", "P3", "P4", "P5", "P6", "P7"].map((p) => (
                        <th key={p} className="p-3.5 text-center">
                          {p}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-800/60">
                    {(data?.students || []).map((s) => {
                      const rKey = cleanStr(s.reg_no);
                      return (
                        <tr key={rKey} className="hover:bg-stone-800/30 transition">
                          <td className="p-3.5 font-mono text-stone-400">{rKey}</td>
                          <td className="p-3.5 font-medium text-stone-200">{s.name}</td>
                          {["P1", "P2", "P3", "P4", "P5", "P6", "P7"].map((p) => {
                            const val = rollCall[rKey]?.[p] || "P";
                            return (
                              <td key={p} className="p-3.5 text-center">
                                <button
                                  onClick={() => togglePeriod(rKey, p)}
                                  className={`w-9 h-9 rounded-xl text-xs font-mono font-bold transition ${
                                    val === "P"
                                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20"
                                      : "bg-rose-500/10 text-rose-400 border border-rose-500/30 hover:bg-rose-500/20"
                                  }`}
                                >
                                  {val}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ==================== TIMETABLE CONSOLE MODAL ==================== */}
      {showSwapModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 z-50 animate-in fade-in">
          <div className="bg-[#1c1a17] border border-stone-800 rounded-3xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden p-5 sm:p-6 space-y-4">
            
            {/* Modal Header */}
            <div className="flex justify-between items-center border-b border-stone-800 pb-3 shrink-0">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Calendar size={16} className="text-[#4fd8c4]" />
                  Timetable Adjustment Console
                </h3>
                <p className="text-[11px] text-stone-400 mt-0.5">
                  Exchange two periods or assign a one-way substitute teacher takeover
                </p>
              </div>
              <button
                onClick={() => setShowSwapModal(false)}
                className="p-1 rounded-lg hover:bg-stone-800 text-stone-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div className="overflow-y-auto space-y-4 pr-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-stone-900/80 p-3 rounded-2xl border border-stone-800">
                <div>
                  <span className="text-[11px] text-stone-400 font-medium block mb-1">Session date</span>
                  <input
                    type="date"
                    value={swapDate}
                    onChange={(e) => setSwapDate(e.target.value)}
                    className="w-full bg-[#141210] border border-stone-800 rounded-xl px-3 py-2 text-xs font-mono text-white outline-none focus:border-[#2bab98]"
                  />
                </div>
                <div>
                  <span className="text-[11px] text-stone-400 font-medium block mb-1">Action type</span>
                  <div className="grid grid-cols-2 gap-1.5 bg-[#141210] p-1 rounded-xl border border-stone-800">
                    <button
                      type="button"
                      onClick={() => {
                        setSwapMode("swap");
                        setSelectedPeriodA(null);
                        setSelectedPeriodB(null);
                        setSwapPreview(null);
                      }}
                      className={`py-1.5 rounded-lg text-xs font-semibold transition ${
                        swapMode === "swap" ? "bg-[#1c8f7f] text-white" : "text-stone-400 hover:text-white"
                      }`}
                    >
                      Mutual Swap
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSwapMode("takeover");
                        setSelectedPeriodA(null);
                        setSelectedPeriodB(null);
                        setSwapPreview(null);
                      }}
                      className={`py-1.5 rounded-lg text-xs font-semibold transition ${
                        swapMode === "takeover" ? "bg-emerald-600 text-white" : "text-stone-400 hover:text-white"
                      }`}
                    >
                      Takeover
                    </button>
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-stone-400 bg-stone-900/40 p-2.5 rounded-xl border border-stone-800/80">
                {swapMode === "swap" ? (
                  <span><strong>Mutual Swap:</strong> Select Slot 1, then Slot 2 to exchange courses.</span>
                ) : (
                  <span><strong>Takeover:</strong> Select Slot 1 (substitute teacher), then Slot 2 (slot to be replaced).</span>
                )}
              </div>

              <div className="space-y-2">
                <span className="text-[11px] text-stone-500">
                  Scheduled periods ({daySchedule.length} slots)
                </span>
                <div className="grid grid-cols-3 sm:grid-cols-7 gap-2">
                  {daySchedule.map((slot) => {
                    const isA = selectedPeriodA === slot.period;
                    const isB = selectedPeriodB === slot.period;
                    const isSelected = isA || isB;
                    return (
                      <button
                        key={slot.period}
                        type="button"
                        onClick={() => handleStageSwap(slot.period)}
                        className={`p-2.5 rounded-2xl border text-center transition flex flex-col justify-between h-28 relative ${
                          isSelected
                            ? "bg-[#1c8f7f]/30 border-[#4fd8c4] ring-2 ring-[#2bab98] text-white"
                            : slot.is_swapped
                            ? "bg-amber-950/20 border-amber-500/40 text-stone-200"
                            : "bg-stone-900/50 border-stone-800 hover:border-stone-700 text-stone-300"
                        }`}
                      >
                        <div className="flex justify-between items-center w-full">
                          <span className="text-[10px] font-mono font-bold text-[#4fd8c4]">P{slot.period}</span>
                          {slot.is_swapped && (
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="Override Active"></span>
                          )}
                        </div>
                        <div className="my-auto">
                          <p className="font-bold text-xs truncate">{slot.code}</p>
                          <p className="text-[9px] text-stone-400 truncate">{slot.faculty}</p>
                        </div>
                        <span className="text-[9px] text-stone-500">{slot.type}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {swapPreview ? (
                <div className="bg-[#123832]/30 border border-[#2bab98]/30 rounded-2xl p-4 space-y-3">
                  <h4 className="text-xs font-bold text-[#8ff0dc] flex items-center gap-2">
                    <ArrowUpDown size={14} /> Stage Review: Verify Before Committing
                  </h4>

                  {swapMode === "swap" ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div className="bg-stone-900/80 p-3 rounded-xl border border-stone-800 space-y-1">
                        <span className="text-[10px] font-mono text-stone-400">New Slot: Period {swapPreview.slotA.period}</span>
                        <p className="font-bold text-white">{swapPreview.slotB.code} ({swapPreview.slotB.name})</p>
                        <p className="text-[11px] text-[#8ff0dc]">{swapPreview.slotB.faculty}</p>
                      </div>
                      <div className="bg-stone-900/80 p-3 rounded-xl border border-stone-800 space-y-1">
                        <span className="text-[10px] font-mono text-stone-400">New Slot: Period {swapPreview.slotB.period}</span>
                        <p className="font-bold text-white">{swapPreview.slotA.code} ({swapPreview.slotA.name})</p>
                        <p className="text-[11px] text-[#8ff0dc]">{swapPreview.slotA.faculty}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-stone-900/80 p-3.5 rounded-xl border border-stone-800 text-xs space-y-1.5">
                      <div className="flex items-center gap-2 text-emerald-400 font-bold">
                        <span>Takeover Confirmed:</span>
                        <span>Period {swapPreview.slotB.period}</span>
                      </div>
                      <p className="text-white">
                        <strong>{swapPreview.slotA.faculty}</strong> ({swapPreview.slotA.code}) will conduct class in place of <strong>{swapPreview.slotB.faculty}</strong> ({swapPreview.slotB.code}).
                      </p>
                    </div>
                  )}

                  <div className="flex gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPeriodA(null);
                        setSelectedPeriodB(null);
                        setSwapPreview(null);
                      }}
                      className="flex-1 bg-stone-800 hover:bg-stone-700 text-stone-300 py-2 rounded-xl text-xs font-semibold transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={confirmingSwap}
                      onClick={handleCommitSwap}
                      className="flex-1 bg-[#1c8f7f] hover:bg-[#22a894] text-white py-2 rounded-xl text-xs font-bold transition shadow-md disabled:opacity-50"
                    >
                      {confirmingSwap ? "Committing..." : "Confirm & Commit"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center py-2 text-xs text-stone-500">
                  {!selectedPeriodA ? "Select Slot 1..." : "Select Slot 2..."}
                </div>
              )}

              {daySchedule.some((s) => s.is_swapped) && (
                <div className="pt-3 border-t border-stone-800/80 flex items-center justify-between text-xs flex-wrap gap-2">
                  <span className="text-amber-400 font-medium">Custom schedule active on {swapDate}</span>
                  <button
                    type="button"
                    onClick={() => handleRevertSwap()}
                    className="px-3 py-1.5 bg-amber-950/30 hover:bg-amber-900/40 border border-amber-800/40 text-amber-300 rounded-xl font-medium transition"
                  >
                    Revert Day to Default Timetable
                  </button>
                </div>
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  );
}