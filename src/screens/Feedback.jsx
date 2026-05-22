import { calcPts } from "../lib/gameLogic.js";

const W = {
  wrap: {
    minHeight: "100vh",
    background: "var(--fue-bg)",
    display: "flex", justifyContent: "center",
    fontFamily: '"Jost",sans-serif', color: "#EDE9FE",
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
    fontFamily: '"Jost",sans-serif', ...extra,
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

export default function Feedback({ currentQ, picked, timer, mod }) {
  if (!currentQ) return null;
  const ok = picked === currentQ.ans;
  const pts = calcPts(timer + 1, mod.timePerQ, ok);
  return (
    <div style={{ ...W.wrap }}>
      <div className="fue-page" style={{ justifyContent: "center", alignItems: "center", padding: 32, textAlign: "center", background: ok ? "linear-gradient(160deg,#070215,#051A12)" : "linear-gradient(160deg,#070215,#1A0512)" }}>
        <div style={W.blob("30%", "30%", 200, ok ? "rgba(16,217,160,.12)" : "rgba(232,55,107,.12)")} />
        <div className="pi" style={{ fontSize: 72, marginBottom: 16 }}>{ok ? "✅" : "❌"}</div>
        <h2 className="su" style={{ fontFamily: '"Bebas Neue"', fontSize: 52, letterSpacing: 2, color: ok ? "#10D9A0" : "#E8376B", animationDelay: ".06s" }}>
          {ok ? "Dobrze!" : "Błąd!"}
        </h2>
        {ok ? (
          <div className="su" style={{ animationDelay: ".13s" }}>
            <p style={{ color: "#9B89CC", fontSize: 14, marginTop: 8 }}>Zdobyłeś/aś</p>
            <p style={{ fontFamily: '"Bebas Neue"', fontSize: 64, color: "#F5C518", lineHeight: 1 }}>+{pts}</p>
            <p style={{ color: "#9B89CC", fontSize: 13 }}>punktów</p>
          </div>
        ) : (
          <div className="su" style={{ animationDelay: ".13s", maxWidth: 320 }}>
            <p style={{ color: "#9B89CC", fontSize: 14, marginTop: 10 }}>Poprawna odpowiedź:</p>
            <p style={{ color: "#10D9A0", fontWeight: 700, fontSize: 15, marginTop: 6, lineHeight: 1.4 }}>{currentQ.opts[currentQ.ans]}</p>
            {currentQ.exp && <p style={{ color: "#9B89CC", fontSize: 12, marginTop: 10, lineHeight: 1.6, fontStyle: "italic" }}>{currentQ.exp}</p>}
          </div>
        )}
        <p className="su" style={{ color: "rgba(155,137,204,.4)", fontSize: 12, marginTop: 32, animationDelay: ".25s" }}>
          Następne pytanie za chwilę…
        </p>
      </div>
    </div>
  );
}
