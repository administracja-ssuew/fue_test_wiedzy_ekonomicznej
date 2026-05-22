import { MODULES, QUESTIONS } from "../data/questions.js";
import { cityInfo, moduleQuestions } from "../lib/gameLogic.js";

const W = {
  wrap: {
    minHeight: "100vh",
    background: "var(--fue-bg)",
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

export default function Lobby({ user, isDesktop, onLogout, onStartQuiz, onPractice }) {
  return (
    <div style={W.wrap}>
      <div className="fue-page" style={{ padding: isDesktop ? "40px 0 48px" : "40px 24px 32px" }}>
        <div style={W.blob(-50, -50, 200, "rgba(107,33,232,.18)")} />
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
          <div>
            <p style={{ fontSize: 11, color: "#9B89CC", letterSpacing: 1, textTransform: "uppercase", fontWeight: 600 }}>🐐 FUE QUIZ</p>
            <h2 style={{ fontFamily: '"Bebas Neue"', fontSize: isDesktop ? 52 : 36, letterSpacing: 1 }}>Test Wiedzy Ekonomicznej</h2>
          </div>
          <button onClick={onLogout} style={{ background: "none", border: "none", color: "#9B89CC", fontSize: 12, cursor: "pointer" }}>
            Wyloguj
          </button>
        </div>

        <div className={isDesktop ? "fue-lobby-grid" : ""}>
          {/* Lewa kolumna: profil + moduły */}
          <div>
            {user && (
              <div className="su" style={{ ...W.card({ padding: "16px 20px", marginBottom: 20, borderColor: "rgba(107,33,232,.35)" }) }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 44, height: 44, borderRadius: "50%", background: "linear-gradient(135deg,#6B21E8,#4F46E5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800, flexShrink: 0 }}>
                    {(user.fullName || user.full_name || "U").charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p style={{ fontWeight: 700, fontSize: 15 }}>{user.fullName || user.full_name}</p>
                    <p style={{ color: "#9B89CC", fontSize: 13, marginTop: 2 }}>{cityInfo(user.city).icon} {user.city}</p>
                  </div>
                  <div style={{ marginLeft: "auto", width: 8, height: 8, borderRadius: "50%", background: "#10D9A0", boxShadow: "0 0 8px #10D9A0", animation: "bd 2s infinite" }} />
                </div>
              </div>
            )}

            <div className="su" style={{ ...W.card({ padding: "20px", marginBottom: 16 }), animationDelay: ".1s" }}>
              <p style={{ fontSize: 12, color: "#9B89CC", marginBottom: 12 }}>Struktura testu</p>
              <div className="fue-modules-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {MODULES.map((m) => (
                  <div key={m.id} style={{ background: `${m.color}15`, border: `1px solid ${m.color}30`, borderRadius: 10, padding: "12px", textAlign: "left" }}>
                    <div style={{ fontSize: 20, marginBottom: 4 }}>{m.icon}</div>
                    <p style={{ fontSize: 12, fontWeight: 700, color: "#EDE9FE" }}>{m.name}</p>
                    <p style={{ fontSize: 11, color: "#9B89CC", marginTop: 2 }}>{moduleQuestions(m.id).length} pyt. · {m.timePerQ}s/pyt.</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Prawa kolumna (desktop) / kontynuacja (mobile): akcje */}
          <div>
            <div className="su" style={{ ...W.card({ padding: "28px", borderColor: "rgba(245,197,24,.2)", background: "rgba(245,197,24,.04)" }), animationDelay: ".15s", marginBottom: 16 }}>
              <p style={{ fontSize: 13, color: "#9B89CC", marginBottom: 6 }}>Łączna liczba pytań</p>
              <p style={{ fontFamily: '"Bebas Neue"', fontSize: 56, color: "#F5C518", lineHeight: 1 }}>{QUESTIONS.length}</p>
              <p style={{ fontSize: 12, color: "#9B89CC", marginTop: 4 }}>
                Czas szacowany: ~{Math.round(MODULES.reduce((s, m) => s + m.timePerQ * moduleQuestions(m.id).length, 0) / 60)} minut
              </p>
            </div>

            <div className="su" style={{ display: "flex", flexDirection: "column", gap: 10, animationDelay: ".2s" }}>
              <button style={W.btn("gold", { padding: "18px 24px", fontSize: 16 })} onClick={onStartQuiz}>
                🚀 Rozpocznij Test Wiedzy Ekonomicznej
              </button>
              <button style={W.btn("ghost", { fontSize: 13 })} onClick={() => onPractice()}>
                📖 Przejrzyj materiały przygotowawcze
              </button>
            </div>
            <p style={{ color: "rgba(155,137,204,.3)", fontSize: 11, textAlign: "center", marginTop: 20 }}>
              🐐 Forum Uczelni Ekonomicznych · {new Date().getFullYear()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
