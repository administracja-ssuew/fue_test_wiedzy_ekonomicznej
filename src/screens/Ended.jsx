
import { useModules } from "../context/ModulesContext.jsx";

const W = {
  wrap: {
    minHeight: "100vh",
    background: "var(--fue-bg)",
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

// Jeden ekran końca gry (06-15, G4/G6): pokazywany automatycznie od fazy finished/results,
// bez czekania na admina. Wynik = poprawne (odsłonięte przez serwer) / liczba pytań w planie.
// perModule: [{ id, ok, total }] z planu; pending — ostatnie odpowiedzi jeszcze bez is_correct.
export default function Ended({ participant, correctN = 0, totalQ = 0, perModule = [], pending = false, isPractice, onGoHome }) {
  const MODULES = useModules();
  const modInfo = (id) => MODULES.find((m) => m.id === id) || { id, name: `Moduł ${id}`, icon: "📘", color: "#6B21E8" };
  return (
    <div style={W.wrap}>
      <div className="fue-page" style={{ justifyContent: "center", alignItems: "center", padding: "36px 28px", textAlign: "center" }}>
        <div style={W.blob("40%", "20%", 280, isPractice ? "rgba(16,217,160,.1)" : "rgba(107,33,232,.15)")} />
        {isPractice && (
          <div style={{ background: "rgba(16,217,160,.15)", border: "1px solid rgba(16,217,160,.35)", borderRadius: 20, padding: "4px 16px", fontSize: 12, fontWeight: 700, color: "#10D9A0", marginBottom: 16 }}>
            🔬 PRÓBNY TEST
          </div>
        )}
        <div className="pi" style={{ fontSize: 64, marginBottom: 16 }}>{isPractice ? "🔬" : "🏆"}</div>
        <h2 className="su" style={{ fontFamily: '"Bebas Neue"', fontSize: 52, letterSpacing: 2, animationDelay: ".06s" }}>
          {isPractice ? "Próba zakończona!" : "Koniec testu"}
        </h2>
        {isPractice && (
          <p className="su" style={{ color: "#9B89CC", fontSize: 15, marginTop: 6, lineHeight: 1.7, animationDelay: ".12s" }}>
            To był próbny test — wyniki nie są oficjalne.
          </p>
        )}
        <div className="su" style={{ ...W.card({ padding: "24px", marginTop: 24, borderColor: "rgba(16,217,160,.3)", background: "rgba(16,217,160,.06)" }), animationDelay: ".18s", width: "100%" }}>
          <p style={{ fontSize: 12, color: "#9B89CC", marginBottom: 6 }}>Twój wynik</p>
          <p style={{ fontFamily: '"Bebas Neue"', fontSize: 56, color: "#10D9A0", lineHeight: 1 }}>{correctN} / {totalQ}</p>
          <p style={{ fontSize: 13, color: "#9B89CC" }}>poprawnych odpowiedzi</p>
          {pending && <p style={{ fontSize: 12, color: "#9B89CC", marginTop: 6 }}>Aktualizuję wynik…</p>}
          {perModule.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(5, Math.max(1, perModule.length))},1fr)`, gap: 8, marginTop: 16 }}>
              {perModule.map((pm) => {
                const m = modInfo(pm.id);
                return (
                  <div key={pm.id} style={{ textAlign: "center" }}>
                    <p style={{ fontSize: 16 }}>{m.icon || "•"}</p>
                    <p style={{ fontFamily: '"Bebas Neue"', fontSize: 18, color: m.color }}>{pm.ok}/{pm.total}</p>
                    <p style={{ fontSize: 9, color: "#9B89CC" }}>{String(m.name || `Moduł ${pm.id}`).split(" ")[0]}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="su" style={{ ...W.card({ padding: "16px", marginTop: 12, borderColor: "rgba(245,197,24,.3)", background: "rgba(245,197,24,.06)" }), animationDelay: ".24s", width: "100%" }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: "#F5C518", marginBottom: 4 }}>
            Dziękujemy za udział, {participant?.name} {participant?.surname}!
          </p>
          <p style={{ fontSize: 13, color: "#9B89CC", lineHeight: 1.6 }}>
            Ranking i podium ogłosimy na sali.
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
