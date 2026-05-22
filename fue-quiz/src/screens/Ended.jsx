import { MODULES } from "../data/questions.js";

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

export default function Ended({ user, myPts, allAnswers, onGoHome }) {
  return (
    <div style={W.wrap}>
      <div className="fue-page" style={{ justifyContent: "center", alignItems: "center", padding: "36px 28px", textAlign: "center" }}>
        <div style={W.blob("40%", "20%", 280, "rgba(107,33,232,.15)")} />
        <div className="pi" style={{ fontSize: 64, marginBottom: 16 }}>🏆</div>
        <h2 className="su" style={{ fontFamily: '"Bebas Neue"', fontSize: 52, letterSpacing: 2, animationDelay: ".06s" }}>Ukończyłeś Test!</h2>
        <p className="su" style={{ color: "#9B89CC", fontSize: 15, marginTop: 6, lineHeight: 1.7, animationDelay: ".12s" }}>
          Dziękujemy za udział,<br />
          <strong style={{ color: "#EDE9FE" }}>{user?.fullName || user?.full_name || "Uczestniku"}</strong>!
        </p>
        <div className="su" style={{ ...W.card({ padding: "24px", marginTop: 24, borderColor: "rgba(245,197,24,.25)", background: "rgba(245,197,24,.06)" }), animationDelay: ".18s", width: "100%" }}>
          <p style={{ fontSize: 12, color: "#9B89CC", marginBottom: 6 }}>Twój wynik</p>
          <p style={{ fontFamily: '"Bebas Neue"', fontSize: 56, color: "#F5C518", lineHeight: 1 }}>{myPts}</p>
          <p style={{ fontSize: 13, color: "#9B89CC" }}>punktów</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginTop: 16 }}>
            {MODULES.map((m) => {
              const pts = allAnswers.filter((a) => a.module === m.id).reduce((s, a) => s + a.pts, 0);
              return (
                <div key={m.id} style={{ textAlign: "center" }}>
                  <p style={{ fontSize: 16 }}>{m.icon}</p>
                  <p style={{ fontFamily: '"Bebas Neue"', fontSize: 18, color: m.color }}>{pts}</p>
                  <p style={{ fontSize: 9, color: "#9B89CC" }}>{m.name.split(" ")[0]}</p>
                </div>
              );
            })}
          </div>
        </div>
        <div className="su" style={{ ...W.card({ padding: "16px", marginTop: 12 }), animationDelay: ".24s", width: "100%" }}>
          <p style={{ fontSize: 13, color: "#9B89CC", lineHeight: 1.6 }}>
            Wyniki zostaną ogłoszone przez organizatorów.<br />
            Top 5 z Twojego miasta przechodzi do <strong style={{ color: "#EDE9FE" }}>etapu ogólnopolskiego</strong>.
          </p>
        </div>
        <button className="su" style={{ ...W.btn("ghost", { marginTop: 20 }), animationDelay: ".3s" }}
          onClick={() => onGoHome()}>
          Wróć do strony głównej
        </button>
      </div>
    </div>
  );
}
