import { useEffect, useState } from "react";
import { validateParticipantCode } from "../lib/supabase.js";
import { armWakeLockFromGesture } from "../lib/wakeLock.js";
import { formatCodeInput, normalizeParticipantCode } from "../lib/codeFormat.js";

const FORMAT_ERR = "Kod ma postać KRK-1234: 3 litery miasta (np. KRK, WAR), myślnik i 4 cyfry.";

export default function CodeEntry({ onBack, onSuccess }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  // Blokada po rate_limited z serwera (P7-CODE-RATE): lockUntil w ms, 0 = brak.
  const [lockUntil, setLockUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const lockLeft = lockUntil ? Math.max(0, Math.ceil((lockUntil - now) / 1000)) : 0;
  const locked = lockLeft > 0;

  // Odliczanie tylko w trakcie blokady.
  useEffect(() => {
    if (!lockUntil || lockUntil <= Date.now()) return undefined;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [lockUntil]);

  // Koniec blokady → komunikat limitu znika, przycisk wraca.
  useEffect(() => {
    if (lockUntil && !locked) {
      setErr("");
      setLockUntil(0);
    }
  }, [lockUntil, locked]);

  const submit = async () => {
    armWakeLockFromGesture({ force: true }); // iOS: blokada ekranu tylko w geście (P7-IOS-WAKE)
    if (locked || loading) return;
    if (!code.trim()) return setErr("Wprowadź kod uczestnika.");
    const norm = normalizeParticipantCode(code);
    if (!norm) return setErr(FORMAT_ERR); // bez RPC → literówka nie zużywa limitu prób
    setLoading(true);
    const res = await validateParticipantCode(norm);
    setLoading(false);
    if (res.rateLimited) {
      const t = Date.now();
      setLockUntil(t + (Number(res.retryAfterS) || 60) * 1000);
      setNow(t);
      return setErr(res.error);
    }
    if (res.error) return setErr(res.error);
    onSuccess(res.data); // { code, name, surname, city }
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--fue-bg)", display: "flex", justifyContent: "center", fontFamily: '"Space Grotesk",sans-serif', color: "#EDE9FE" }}>
      <div className="fue-page" style={{ padding: "28px", justifyContent: "center" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: "#9B89CC", fontSize: 22, padding: "0 0 24px", cursor: "pointer", alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 8 }}>
          ← <span style={{ fontSize: 14, fontWeight: 600 }}>Wróć</span>
        </button>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", maxWidth: 340, margin: "0 auto", width: "100%" }}>
          <div style={{ fontSize: 52, textAlign: "center", marginBottom: 14 }}>🎟️</div>
          <h2 className="su" style={{ fontFamily: '"Bebas Neue"', fontSize: 44, letterSpacing: 1.5, textAlign: "center", marginBottom: 6 }}>Wpisz swój kod</h2>
          <p className="su" style={{ color: "#9B89CC", textAlign: "center", fontSize: 14, marginBottom: 32, lineHeight: 1.6 }}>
            Kod uczestnika otrzymasz od koordynatora swojego miasta.<br />
            <span style={{ color: "#C4B5FD", fontWeight: 600 }}>Przykład: KRK-1111</span>
          </p>

          <input
            type="text"
            className="fue-input"
            placeholder="KRK-1234"
            aria-label="Kod uczestnika"
            value={code}
            onChange={(e) => { setCode((p) => formatCodeInput(e.target.value, p)); if (!locked) setErr(""); }}
            onKeyDown={(e) => e.key === "Enter" && !locked && submit()}
            style={{ textAlign: "center", letterSpacing: 3, fontSize: 22, fontWeight: 700, marginBottom: 10, ...(err ? { borderColor: "#E8376B", background: "rgba(232,55,107,.1)" } : {}) }}
            maxLength={10}
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            autoFocus
          />

          {err && <p className="shake" role="alert" aria-live="polite" style={{ color: "#E8376B", fontSize: 13, textAlign: "center", marginBottom: 10 }}>{err}</p>}

          <button
            onClick={submit}
            disabled={loading || locked}
            style={{ background: "linear-gradient(135deg,#6B21E8,#4F46E5)", color: "#fff", border: "none", borderRadius: 12, padding: "16px", fontSize: 16, fontWeight: 700, cursor: locked ? "not-allowed" : "pointer", opacity: locked ? 0.5 : 1, fontFamily: '"Space Grotesk",sans-serif', boxShadow: "0 8px 28px rgba(107,33,232,.4)", marginTop: 4 }}>
            {loading ? "Sprawdzanie…" : locked ? `Odczekaj ${lockLeft} s` : "Dołącz do quizu →"}
          </button>
        </div>
      </div>
    </div>
  );
}
