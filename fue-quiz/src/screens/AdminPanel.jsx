import { useState, useEffect } from "react";
import { getAllUsers, verifyUser } from "../lib/supabase.js";
import { CITIES, QUESTIONS, MODULES } from "../data/questions.js";
import { cityInfo, moduleQuestions } from "../lib/gameLogic.js";

const W = {
  wrap: {
    minHeight: "100vh",
    background: "linear-gradient(160deg,#070215 0%,#0E0435 50%,#070215 100%)",
    display: "flex", justifyContent: "center",
    fontFamily: '"Outfit",sans-serif', color: "#EDE9FE",
  },
  card: (extra = {}) => ({
    background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.09)", borderRadius: 16, ...extra,
  }),
  btn: (v = "primary", extra = {}) => ({
    ...(v === "primary" ? { background: "linear-gradient(135deg,#6B21E8,#4F46E5)", color: "#fff", boxShadow: "0 8px 28px rgba(107,33,232,.4)" }
      : v === "gold" ? { background: "linear-gradient(135deg,#F5C518,#E5A800)", color: "#07021A", boxShadow: "0 8px 28px rgba(245,197,24,.4)" }
      : v === "danger" ? { background: "linear-gradient(135deg,#E8376B,#B01A4E)", color: "#fff" }
      : { background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)", color: "#C4B5FD" }),
    border: v !== "ghost" ? "none" : undefined,
    borderRadius: 12, padding: "15px 20px", fontSize: 15, fontWeight: 700,
    cursor: "pointer", width: "100%", transition: "transform .15s,opacity .15s",
    fontFamily: '"Outfit",sans-serif', ...extra,
  }),
  label: { fontSize: 11, fontWeight: 600, color: "#9B89CC", letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 8 },
  blob: (t, l, size, color) => ({
    position: "absolute", top: t, left: l, width: size, height: size,
    borderRadius: "50%", background: `radial-gradient(circle,${color} 0%,transparent 70%)`, pointerEvents: "none", zIndex: 0,
  }),
  back: (onClick) => (
    <button onClick={onClick} style={{ background: "none", border: "none", color: "#9B89CC", fontSize: 22, padding: "0 0 24px", cursor: "pointer", alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 8 }}>
      ← <span style={{ fontSize: 14, fontWeight: 600 }}>Wróć</span>
    </button>
  ),
};

function AdminPanel({ user, onLogout, onStartQuiz, isDesktop }) {
  const [tab, setTab] = useState("users");
  const [users, setUsers] = useState([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const medals = ["🥇", "🥈", "🥉"];

  const loadUsers = async () => {
    setLoading(true);
    const data = await getAllUsers(user?.role === "city_admin" ? user.city : null);
    setUsers(data);
    setLoading(false);
  };

  useEffect(() => { loadUsers(); }, [tab]);

  const handleVerify = async (uid, approve) => {
    await verifyUser(uid, approve);
    loadUsers();
  };

  const pending = users.filter((u) => !u.verified);
  const verified = users.filter((u) => u.verified);
  const shown = (filter ? users.filter((u) => u.city === filter) : users);

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg,#070215 0%,#0E0435 50%,#070215 100%)", fontFamily: '"Outfit",sans-serif', color: "#EDE9FE" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: isDesktop ? "0 32px" : "0" }}>
        {/* Header */}
        <div style={{ background: "linear-gradient(180deg,rgba(107,33,232,.28) 0%,transparent 100%)", padding: isDesktop ? "32px 0 24px" : "32px 20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <div style={{ background: "rgba(245,197,24,.15)", border: "1px solid rgba(245,197,24,.4)", borderRadius: 8, padding: "3px 10px", fontSize: 10, color: "#F5C518", fontWeight: 700 }}>
                {user?.role === "global_admin" ? "PREZYDIUM FUE" : "ADMIN MIASTA"}
              </div>
            </div>
            <h1 style={{ fontFamily: '"Bebas Neue"', fontSize: 46, letterSpacing: 1.5 }}>Panel Administracyjny</h1>
            <p style={{ color: "#9B89CC", fontSize: 13, marginTop: 2 }}>Test Wiedzy Ekonomicznej · FUE {new Date().getFullYear()}</p>
          </div>
          <button onClick={onLogout} style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 10, padding: "10px 18px", color: "#9B89CC", fontSize: 13, cursor: "pointer" }}>
            Wyloguj
          </button>
        </div>

        {/* Stats bar */}
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${isDesktop ? 4 : 2},1fr)`, gap: 12, padding: isDesktop ? "0 0 20px" : "0 16px 20px" }}>
          {[
            ["Zarejestrowani", users.length, "#6B21E8"],
            ["Zweryfikowani", verified.length, "#10D9A0"],
            ["Oczekujące", pending.length, "#F5C518"],
            ["Pytań w teście", QUESTIONS.length, "#E65100"],
          ].map(([label, val, color]) => (
            <div key={label} style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 12, padding: "16px" }}>
              <p style={{ fontFamily: '"Bebas Neue"', fontSize: 32, color, lineHeight: 1 }}>{val}</p>
              <p style={{ fontSize: 11, color: "#9B89CC", marginTop: 4 }}>{label}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,.08)", padding: isDesktop ? "0" : "0 16px" }}>
          {[["users", "👥 Uczestnicy"], ["quiz", "🚀 Quiz"], ["results", "🏆 Wyniki"]].map(([t, label]) => (
            <button key={t} className={`fue-tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>{label}</button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ padding: isDesktop ? "24px 0" : "20px 16px" }}>

          {tab === "users" && (
            <div>
              {/* City filter */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
                <button onClick={() => setFilter("")} style={{ background: filter === "" ? "rgba(107,33,232,.3)" : "rgba(255,255,255,.06)", border: `1px solid ${filter === "" ? "#6B21E8" : "rgba(255,255,255,.12)"}`, borderRadius: 20, padding: "6px 14px", color: "#C4B5FD", fontSize: 12, cursor: "pointer" }}>
                  Wszystkie
                </button>
                {CITIES.map((c) => (
                  <button key={c.name} onClick={() => setFilter(c.name)} style={{ background: filter === c.name ? "rgba(107,33,232,.3)" : "rgba(255,255,255,.06)", border: `1px solid ${filter === c.name ? "#6B21E8" : "rgba(255,255,255,.12)"}`, borderRadius: 20, padding: "6px 14px", color: "#C4B5FD", fontSize: 12, cursor: "pointer" }}>
                    {c.icon} {c.name}
                  </button>
                ))}
              </div>

              {loading ? <p style={{ color: "#9B89CC", textAlign: "center", padding: 32 }}>Ładowanie…</p> : (
                <>
                  {pending.length > 0 && (
                    <div style={{ marginBottom: 24 }}>
                      <p style={{ fontSize: 12, color: "#F5C518", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>
                        ⏳ Oczekujące na weryfikację ({pending.filter((u) => !filter || u.city === filter).length})
                      </p>
                      {pending.filter((u) => !filter || u.city === filter).map((u) => (
                        <UserCard key={u.id} u={u} onApprove={() => handleVerify(u.id, true)} onReject={() => handleVerify(u.id, false)} showActions />
                      ))}
                    </div>
                  )}
                  <p style={{ fontSize: 12, color: "#10D9A0", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>
                    ✓ Zweryfikowani ({verified.filter((u) => !filter || u.city === filter).length})
                  </p>
                  {verified.filter((u) => !filter || u.city === filter).map((u) => (
                    <UserCard key={u.id} u={u} />
                  ))}
                  {shown.length === 0 && <p style={{ color: "#9B89CC", textAlign: "center", padding: 24 }}>Brak uczestników</p>}
                </>
              )}
            </div>
          )}

          {tab === "quiz" && (
            <div style={{ maxWidth: 560 }}>
              <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.09)", borderRadius: 16, padding: "28px", marginBottom: 16 }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>🚀</div>
                <h3 style={{ fontFamily: '"Bebas Neue"', fontSize: 32, letterSpacing: 1, marginBottom: 8 }}>Etap Regionalny</h3>
                <p style={{ color: "#9B89CC", fontSize: 14, lineHeight: 1.65, marginBottom: 20 }}>
                  Po rozpoczęciu wszyscy zweryfikowani uczestnicy z danego miasta będą mogli wejść do testu.<br />
                  Test trwa ok. <strong style={{ color: "#EDE9FE" }}>{Math.round(MODULES.reduce((s, m) => s + m.timePerQ * moduleQuestions(m.id).length, 0) / 60)} minut</strong>.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 24 }}>
                  {MODULES.map((m) => (
                    <div key={m.id} style={{ background: `${m.color}12`, border: `1px solid ${m.color}30`, borderRadius: 10, padding: "12px" }}>
                      <p style={{ fontSize: 16 }}>{m.icon}</p>
                      <p style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>{m.name}</p>
                      <p style={{ fontSize: 11, color: "#9B89CC", marginTop: 2 }}>{moduleQuestions(m.id).length} pyt. · {m.timePerQ}s</p>
                    </div>
                  ))}
                </div>
                <button style={{ background: "linear-gradient(135deg,#F5C518,#E5A800)", color: "#07021A", borderRadius: 12, padding: "16px 24px", fontSize: 16, fontWeight: 700, width: "100%", cursor: "pointer", border: "none" }}
                  onClick={onStartQuiz}>
                  🚀 Rozpocznij Test Regionalny
                </button>
              </div>
              <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.09)", borderRadius: 16, padding: "20px" }}>
                <p style={{ fontSize: 12, color: "#9B89CC", marginBottom: 8 }}>Etap Ogólnopolski</p>
                <p style={{ fontSize: 14, color: "#EDE9FE", lineHeight: 1.6 }}>
                  Dostępny po zakończeniu etapu regionalnego.<br />
                  <span style={{ color: "#9B89CC" }}>Top 5 z każdego miasta (25 uczestników) rywalizuje o tytuł najlepszego w Polsce.</span>
                </p>
              </div>
            </div>
          )}

          {tab === "results" && (
            <div style={{ maxWidth: 700 }}>
              <p style={{ color: "#9B89CC", fontSize: 14, marginBottom: 16 }}>
                Wyniki pojawią się tu po zakończeniu testu przez uczestników.
              </p>
              <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.09)", borderRadius: 16, padding: "24px", textAlign: "center" }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>🏆</div>
                <p style={{ color: "#9B89CC", fontSize: 14 }}>Brak aktywnej sesji lub uczestnicy jeszcze nie ukończyli testu.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function UserCard({ u, onApprove, onReject, showActions }) {
  const ci = cityInfo(u.city);
  return (
    <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 12, padding: "14px 16px", marginBottom: 8, display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ width: 38, height: 38, borderRadius: "50%", background: `linear-gradient(135deg,${ci.color},${ci.color}88)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, flexShrink: 0 }}>
        {(u.fullName || u.full_name || "?").charAt(0)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.fullName || u.full_name}</p>
        <p style={{ fontSize: 11, color: "#9B89CC", marginTop: 2 }}>{ci.icon} {u.city} · {u.university}</p>
      </div>
      {showActions ? (
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button onClick={onApprove} style={{ background: "rgba(11,158,107,.2)", border: "1px solid #0B9E6B", borderRadius: 8, padding: "7px 14px", color: "#10D9A0", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✓ Zatwierdź</button>
          <button onClick={onReject} style={{ background: "rgba(232,55,107,.12)", border: "1px solid rgba(232,55,107,.4)", borderRadius: 8, padding: "7px 14px", color: "#E8376B", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✗ Odrzuć</button>
        </div>
      ) : (
        <div style={{ background: "rgba(11,158,107,.15)", border: "1px solid rgba(11,158,107,.3)", borderRadius: 20, padding: "3px 10px", fontSize: 11, color: "#10D9A0", flexShrink: 0 }}>✓ aktywny</div>
      )}
    </div>
  );
}

export default AdminPanel;
export { UserCard };
