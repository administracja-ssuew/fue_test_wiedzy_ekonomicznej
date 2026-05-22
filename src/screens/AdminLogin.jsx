import { useState } from "react";
import { loginAdmin, DEMO } from "../lib/supabase.js";

const W = {
  btn: (v = "primary", extra = {}) => ({
    ...(v === "primary" ? { background: "linear-gradient(135deg,#6B21E8,#4F46E5)", color: "#fff", boxShadow: "0 8px 28px rgba(107,33,232,.4)" }
      : { background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)", color: "#C4B5FD" }),
    border: v !== "ghost" ? "none" : undefined,
    borderRadius: 12, padding: "15px 20px", fontSize: 15, fontWeight: 700,
    cursor: "pointer", width: "100%", fontFamily: '"Outfit",sans-serif', ...extra,
  }),
};

export default function AdminLogin({ onBack, onSuccess }) {
  const [form, setForm] = useState({ email: "", password: "" });
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const f = (k) => (e) => { setForm((p) => ({ ...p, [k]: e.target.value })); setErr(""); };

  const submit = async () => {
    if (!form.email || !form.password) return setErr("Wypełnij wszystkie pola.");
    setLoading(true);
    const { data, error } = await loginAdmin(form);
    setLoading(false);
    if (error) return setErr(error);
    onSuccess(data);
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--fue-bg)", display: "flex", justifyContent: "center", fontFamily: '"Outfit",sans-serif', color: "#EDE9FE" }}>
      <div className="fue-page" style={{ padding: "28px", justifyContent: "center" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: "#9B89CC", fontSize: 22, padding: "0 0 24px", cursor: "pointer", alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 8 }}>
          ← <span style={{ fontSize: 14, fontWeight: 600 }}>Wróć</span>
        </button>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", maxWidth: 340, margin: "0 auto", width: "100%" }}>
          <div style={{ fontSize: 52, textAlign: "center", marginBottom: 14 }}>🔐</div>
          <h2 className="su" style={{ fontFamily: '"Bebas Neue"', fontSize: 44, letterSpacing: 1.5, textAlign: "center", marginBottom: 6 }}>Panel Admina</h2>
          <p className="su" style={{ color: "#9B89CC", textAlign: "center", fontSize: 14, marginBottom: 32 }}>Logowanie dla organizatorów TWE</p>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input type="email" className="fue-input" placeholder="Email" value={form.email}
              onChange={f("email")} onKeyDown={(e) => e.key === "Enter" && submit()} />
            <input type="password" className="fue-input" placeholder="Hasło" value={form.password}
              onChange={f("password")} onKeyDown={(e) => e.key === "Enter" && submit()} />
          </div>

          {err && <p className="shake" style={{ color: "#E8376B", fontSize: 13, textAlign: "center", marginTop: 10 }}>{err}</p>}

          <button style={{ ...W.btn("primary"), marginTop: 20 }} onClick={submit} disabled={loading}>
            {loading ? "Logowanie…" : "Zaloguj się →"}
          </button>

          {DEMO && (
            <p style={{ color: "rgba(155,137,204,.4)", fontSize: 11, textAlign: "center", marginTop: 16 }}>
              Demo: admin@fue.pl / FUE2025
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
