import { useState } from "react";
import { registerUser } from "../lib/supabase.js";
import { CITIES } from "../data/questions.js";

const W = {
  wrap: {
    minHeight: "100vh",
    background: "linear-gradient(160deg,#070215 0%,#0E0435 50%,#070215 100%)",
    display: "flex", justifyContent: "center",
    fontFamily: '"Space Grotesk",sans-serif', color: "#EDE9FE",
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
    fontFamily: '"Space Grotesk",sans-serif', ...extra,
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

function RegisterScreen({ onBack, onSuccess }) {
  const [form, setForm] = useState({ fullName: "", email: "", password: "", confirm: "", city: "", university: "" });
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const f = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const submit = async () => {
    if (!form.fullName || !form.email || !form.password || !form.city || !form.university) return setErr("Wypełnij wszystkie pola.");
    if (form.password !== form.confirm) return setErr("Hasła nie są zgodne.");
    if (form.password.length < 6) return setErr("Hasło musi mieć min. 6 znaków.");
    setLoading(true);
    const { error } = await registerUser(form);
    setLoading(false);
    if (error) return setErr(error);
    onSuccess();
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg,#070215 0%,#0E0435 50%,#070215 100%)", display: "flex", justifyContent: "center", fontFamily: '"Space Grotesk",sans-serif', color: "#EDE9FE" }}>
      <div className="fue-page" style={{ padding: "28px 28px 40px", overflowY: "auto" }}>
        {W.back(onBack)}
        <h2 className="su" style={{ fontFamily: '"Bebas Neue"', fontSize: 44, letterSpacing: 1.5, marginBottom: 4 }}>Rejestracja</h2>
        <p className="su" style={{ color: "#9B89CC", fontSize: 14, marginBottom: 28, animationDelay: ".05s" }}>
          Wypełnij formularz — admin zatwierdzi Twoje konto przed testem.
        </p>

        {[["fullName", "Imię i Nazwisko", "Jan Kowalski", "text"],
          ["email", "Adres e-mail", "jan@uczelnia.pl", "email"],
          ["university", "Nazwa Uczelni", "Uniwersytet Ekonomiczny w...", "text"],
          ["password", "Hasło", "min. 6 znaków", "password"],
          ["confirm", "Powtórz Hasło", "••••••••", "password"]
        ].map(([key, label, ph, type]) => (
          <div key={key} style={{ marginBottom: 18 }}>
            <label style={W.label}>{label}</label>
            <input type={type} className="fue-input" placeholder={ph} value={form[key]} onChange={f(key)} />
          </div>
        ))}

        <label style={{ ...W.label, marginBottom: 10 }}>Miasto</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
          {CITIES.map((c) => (
            <button key={c.name} onClick={() => setForm((p) => ({ ...p, city: c.name }))}
              style={{ background: form.city === c.name ? "rgba(107,33,232,.3)" : "rgba(255,255,255,.04)", border: `2px solid ${form.city === c.name ? "#6B21E8" : "rgba(255,255,255,.08)"}`, borderRadius: 12, padding: "12px 16px", color: form.city === c.name ? "#EDE9FE" : "#9B89CC", fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <span style={{ fontSize: 20 }}>{c.icon}</span>{c.name}
              {form.city === c.name && <span style={{ marginLeft: "auto", color: "#6B21E8" }}>✓</span>}
            </button>
          ))}
        </div>

        {err && <p style={{ color: "#E8376B", fontSize: 13, marginBottom: 14, textAlign: "center" }}>{err}</p>}
        <button style={{ ...W.btn("primary"), opacity: loading ? .6 : 1 }} onClick={submit} disabled={loading}>
          {loading ? "Rejestrowanie…" : "Zarejestruj się →"}
        </button>
      </div>
    </div>
  );
}

export default RegisterScreen;
