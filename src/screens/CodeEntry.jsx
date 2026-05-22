import { useState } from "react";
import { validateParticipantCode } from "../lib/supabase.js";

export default function CodeEntry({ onBack, onSuccess }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!code.trim()) return setErr("Wprowadź kod uczestnika.");
    setLoading(true);
    const { data, error } = await validateParticipantCode(code);
    setLoading(false);
    if (error) return setErr(error);
    onSuccess(data); // { code, name, surname, city }
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--fue-bg)", display: "flex", justifyContent: "center", fontFamily: '"Outfit",sans-serif', color: "#EDE9FE" }}>
      <div className="fue-page" style={{ padding: "28px", justifyContent: "center" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: "#9B89CC", fontSize: 22, padding: "0 0 24px", cursor: "pointer", alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 8 }}>
          ← <span style={{ fontSize: 14, fontWeight: 600 }}>Wróć</span>
        </button>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", maxWidth: 340, margin: "0 auto", width: "100%" }}>
          <div style={{ fontSize: 52, textAlign: "center", marginBottom: 14 }}>🎟️</div>
          <h2 className="su" style={{ fontFamily: '"Bebas Neue"', fontSize: 44, letterSpacing: 1.5, textAlign: "center", marginBottom: 6 }}>Wpisz swój kod</h2>
          <p className="su" style={{ color: "#9B89CC", textAlign: "center", fontSize: 14, marginBottom: 32, lineHeight: 1.6 }}>
            Kod uczestnika otrzymasz od koordynatora swojego miasta.<br />
            <span style={{ color: "#C4B5FD", fontWeight: 600 }}>Przykład: KRK-4829</span>
          </p>

          <input
            type="text"
            className="fue-input"
            placeholder="XXX-0000"
            value={code}
            onChange={(e) => { setCode(e.target.value.toUpperCase()); setErr(""); }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            style={{ textAlign: "center", letterSpacing: 4, fontSize: 22, fontWeight: 700, marginBottom: 10, ...(err ? { borderColor: "#E8376B", background: "rgba(232,55,107,.1)" } : {}) }}
            maxLength={8}
            autoFocus
          />

          {err && <p className="shake" style={{ color: "#E8376B", fontSize: 13, textAlign: "center", marginBottom: 10 }}>{err}</p>}

          <button
            onClick={submit}
            disabled={loading}
            style={{ background: "linear-gradient(135deg,#6B21E8,#4F46E5)", color: "#fff", border: "none", borderRadius: 12, padding: "16px", fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: '"Outfit",sans-serif', boxShadow: "0 8px 28px rgba(107,33,232,.4)", marginTop: 4 }}>
            {loading ? "Sprawdzanie…" : "Dołącz do quizu →"}
          </button>
        </div>
      </div>
    </div>
  );
}
