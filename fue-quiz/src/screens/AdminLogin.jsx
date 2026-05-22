import { useState } from "react";
import { DEMO } from "../lib/supabase.js";
import { ADMIN_CODE } from "../lib/gameLogic.js";

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

function AdminLoginScreen({ onBack, onSuccess }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);

  const submit = () => {
    if (pw === ADMIN_CODE) { setErr(false); onSuccess(); }
    else setErr(true);
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg,#070215 0%,#0E0435 50%,#070215 100%)", display: "flex", justifyContent: "center", fontFamily: '"Outfit",sans-serif', color: "#EDE9FE" }}>
      <div className="fue-page" style={{ padding: "28px", justifyContent: "center" }}>
        {W.back(onBack)}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", maxWidth: 340, margin: "0 auto", width: "100%" }}>
          <div style={{ fontSize: 52, textAlign: "center", marginBottom: 14 }}>🔐</div>
          <h2 className="su" style={{ fontFamily: '"Bebas Neue"', fontSize: 44, letterSpacing: 1.5, textAlign: "center", marginBottom: 6 }}>Panel Admina</h2>
          <p className="su" style={{ color: "#9B89CC", textAlign: "center", fontSize: 14, marginBottom: 32 }}>Wprowadź kod dostępu organizatora</p>
          <div className={err ? "shake" : ""}>
            <input type="password" className="fue-input" placeholder="• • • • • • • •" value={pw}
              onChange={(e) => { setPw(e.target.value); setErr(false); }}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              style={{ textAlign: "center", letterSpacing: 6, fontSize: 20, marginBottom: 10, ...(err ? { borderColor: "#E8376B", background: "rgba(232,55,107,.1)" } : {}) }} />
            {err && <p style={{ color: "#E8376B", textAlign: "center", fontSize: 13, marginBottom: 10 }}>Nieprawidłowy kod dostępu</p>}
          </div>
          <button style={W.btn("primary")} onClick={submit}>Zaloguj się →</button>
          {DEMO && <p style={{ color: "rgba(155,137,204,.35)", fontSize: 11, textAlign: "center", marginTop: 16 }}>Demo: kod to „FUE2025"</p>}
        </div>
      </div>
    </div>
  );
}

export default AdminLoginScreen;
