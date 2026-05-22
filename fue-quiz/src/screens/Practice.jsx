import { useState } from "react";
import { PRACTICE_QUESTIONS, MODULES } from "../data/questions.js";
import { ANSWER_LABELS } from "../lib/gameLogic.js";

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

function PracticeScreen({ onBack }) {
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const q = PRACTICE_QUESTIONS[idx];

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg,#070215 0%,#0E0435 50%,#070215 100%)", display: "flex", justifyContent: "center", fontFamily: '"Outfit",sans-serif', color: "#EDE9FE" }}>
      <div className="fue-page" style={{ padding: "28px 24px 36px" }}>
        {W.back(onBack)}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div>
            <p style={{ fontSize: 11, color: "#9B89CC", letterSpacing: 1, textTransform: "uppercase", fontWeight: 600 }}>📖 Materiały</p>
            <h2 style={{ fontFamily: '"Bebas Neue"', fontSize: 32, letterSpacing: 1 }}>Przykładowe pytania</h2>
          </div>
          <div style={{ background: "rgba(107,33,232,.2)", border: "1px solid rgba(107,33,232,.4)", borderRadius: 20, padding: "4px 12px", fontSize: 12, color: "#C4B5FD" }}>
            {idx + 1} / {PRACTICE_QUESTIONS.length}
          </div>
        </div>

        <div className="su" style={{ ...W.card({ padding: "24px", marginBottom: 16, minHeight: 180 }), animationDelay: ".05s" }}>
          <p style={{ fontSize: 11, color: "#9B89CC", marginBottom: 12, letterSpacing: 1, textTransform: "uppercase" }}>
            {MODULES.find((m) => m.id === q.module)?.icon} {MODULES.find((m) => m.id === q.module)?.name}
          </p>
          <p style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.5 }}>{q.q}</p>
        </div>

        {!revealed ? (
          <button style={W.btn("primary")} onClick={() => setRevealed(true)}>
            👁 Pokaż odpowiedź
          </button>
        ) : (
          <div className="su">
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              {q.opts.map((opt, i) => (
                <div key={i} style={{ background: i === q.ans ? "rgba(11,158,107,.2)" : "rgba(255,255,255,.04)", border: `1px solid ${i === q.ans ? "#0B9E6B" : "rgba(255,255,255,.08)"}`, borderRadius: 10, padding: "12px 16px", display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <span style={{ background: "rgba(0,0,0,.3)", borderRadius: 6, width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, flexShrink: 0 }}>{ANSWER_LABELS[i]}</span>
                  <span style={{ fontSize: 14, color: i === q.ans ? "#10D9A0" : "#9B89CC" }}>{opt}</span>
                  {i === q.ans && <span style={{ marginLeft: "auto", color: "#10D9A0", flexShrink: 0 }}>✓</span>}
                </div>
              ))}
            </div>
            {q.exp && (
              <div style={{ ...W.card({ padding: "14px", borderColor: "rgba(107,33,232,.3)", background: "rgba(107,33,232,.05)", marginBottom: 16 }) }}>
                <p style={{ fontSize: 12, color: "#9B89CC", marginBottom: 4 }}>Wyjaśnienie</p>
                <p style={{ fontSize: 13, color: "#C4B5FD", lineHeight: 1.6 }}>{q.exp}</p>
              </div>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button style={{ ...W.btn("ghost", { flex: 1, padding: "13px" }), opacity: idx === 0 ? .4 : 1 }} onClick={() => { setIdx((i) => i - 1); setRevealed(false); }} disabled={idx === 0}>← Poprzednie</button>
              <button style={{ ...W.btn(idx < PRACTICE_QUESTIONS.length - 1 ? "primary" : "ghost", { flex: 1, padding: "13px" }) }}
                onClick={() => { if (idx < PRACTICE_QUESTIONS.length - 1) { setIdx((i) => i + 1); setRevealed(false); } else onBack(); }}>
                {idx < PRACTICE_QUESTIONS.length - 1 ? "Następne →" : "Gotowe ✓"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default PracticeScreen;
