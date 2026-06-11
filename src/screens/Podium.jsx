function PodiumScreen({ onBack, podStep, setPodStep = () => {}, results = [], readOnly = false }) {
  const confColors = ["#F5C518", "#6B21E8", "#E8376B", "#10D9A0", "#1EB5FF"];
  const top = results.slice(0, 10);
  const count = top.length;                  // ile miejsc ogłaszamy (1–10)
  const shownAt = (r) => count - r + 1;       // miejsce r odsłaniane gdy podStep >= to
  const done = podStep >= count;
  const nextPlace = count - podStep;          // które miejsce odsłoni kolejny klik
  const fmtAvg = (ms) => ms == null ? "" : "śr. " + (ms / 1000).toFixed(2).replace(".", ",") + " s";

  // Wiersz listy dla miejsc 4–10. Top-5 wyróżnione (awans do finału ogólnopolskiego).
  // #1 — renderowany DOPIERO po odsłonięciu (wskakuje z animacją pi), bez migania na starcie.
  const Row = ({ idx }) => {
    const p = top[idx];
    const rank = idx + 1;
    if (!p || podStep < shownAt(rank)) return null;
    const finalist = rank <= 5;
    return (
      <div className="pi" style={{
        display: "flex", alignItems: "center", gap: 12, padding: "9px 14px", borderRadius: 10, marginBottom: 6,
        background: finalist ? "rgba(245,197,24,.10)" : "rgba(255,255,255,.05)",
        border: `1px solid ${finalist ? "rgba(245,197,24,.45)" : "rgba(255,255,255,.10)"}`,
      }}>
        <span style={{ fontFamily: '"Bebas Neue"', fontSize: 24, color: finalist ? "#F5C518" : "#9B89CC", width: 30, textAlign: "center", flexShrink: 0 }}>{rank}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</p>
          <p style={{ fontSize: 10, color: "#9B89CC" }}>{p.city}{p.avgResponseTime != null ? ` · ${fmtAvg(p.avgResponseTime)}` : ""}</p>
        </div>
        {finalist && <span style={{ fontSize: 9, fontWeight: 800, color: "#F5C518", border: "1px solid rgba(245,197,24,.5)", borderRadius: 20, padding: "2px 8px", flexShrink: 0 }}>FINAŁ</span>}
      </div>
    );
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--fue-bg)", display: "flex", justifyContent: "center", fontFamily: '"Space Grotesk",sans-serif', color: "#EDE9FE" }}>
      <div className="fue-page" style={{ justifyContent: "flex-start", padding: "32px 22px 28px", overflow: "hidden", position: "relative" }}>
        {done && Array.from({ length: 24 }).map((_, i) => (
          <div key={i} style={{ position: "absolute", top: -10, left: `${3 + i * 4}%`, width: 7 + (i % 3) * 3, height: 7 + (i % 3) * 3, borderRadius: i % 2 ? "50%" : 3, background: confColors[i % 5], animation: `conffall ${1.4 + (i % 4) * .3}s ${i * .07}s ease-in both`, zIndex: 10 }} />
        ))}

        <div style={{ textAlign: "center", marginBottom: 10 }}>
          <p style={{ fontSize: 11, color: "#9B89CC", letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>Test Wiedzy Ekonomicznej · FUE {new Date().getFullYear()}</p>
          <h1 style={{ fontFamily: '"Bebas Neue"', fontSize: 50, letterSpacing: 3, color: done ? "#F5C518" : "#EDE9FE", transition: "color .5s", lineHeight: 1 }}>
            {podStep === 0 ? "CEREMONIA" : done ? "TOP 10" : "I OTO…"}
          </h1>
          <p style={{ fontSize: 11, color: "#9B89CC", marginTop: 6 }}>Top 5 (złote) awansuje do finału ogólnopolskiego</p>
        </div>

        {/* Podium top-3 (słupki) */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 10, padding: "8px 0 14px", minHeight: 190 }}>
          {[2, 0, 1].map((rank) => {
            const p = top[rank];
            const heights = [150, 90, 116];
            const colors = ["linear-gradient(180deg,#F5C518,#B8940A)", "linear-gradient(180deg,#A0622A,#6B3A12)", "linear-gradient(180deg,#A0A0A0,#6A6A6A)"];
            const glows = ["rgba(245,197,24,.5)", "rgba(205,127,50,.35)", "rgba(192,192,192,.3)"];
            const visible = podStep >= shownAt(rank + 1);
            if (!p) return <div key={rank} style={{ flex: 1, height: heights[rank] }} />;
            return (
              <div key={rank} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", opacity: visible ? 1 : 0, transition: "opacity .5s" }}>
                {visible && (
                  <div className="pi" style={{ textAlign: "center", marginBottom: 8 }}>
                    {rank === 0 && <div style={{ fontSize: 20, marginBottom: 4 }}>👑</div>}
                    <div style={{ width: rank === 0 ? 50 : 42, height: rank === 0 ? 50 : 42, borderRadius: "50%", background: colors[rank], display: "flex", alignItems: "center", justifyContent: "center", fontSize: rank === 0 ? 21 : 17, fontWeight: 800, margin: "0 auto 5px", color: rank === 0 ? "#07021A" : "#fff", ...(rank === 0 ? { animation: "glow 2s infinite" } : {}) }}>
                      {p.name.charAt(0)}
                    </div>
                    <p style={{ fontSize: rank === 0 ? 12 : 11, fontWeight: 700, color: rank === 0 ? "#F5C518" : "#EDE9FE" }}>{p.name.split(" ")[0]}</p>
                    <p style={{ fontSize: 10, color: "#9B89CC" }}>{p.city}</p>
                    {p.avgResponseTime != null && <p style={{ fontSize: rank === 0 ? 12 : 11, fontWeight: 700, color: rank === 0 ? "#F5C518" : "#9B89CC", marginTop: 2 }}>{fmtAvg(p.avgResponseTime)}</p>}
                  </div>
                )}
                <div style={{ width: "100%", height: heights[rank], background: colors[rank], borderRadius: "10px 10px 0 0", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 ${rank === 0 ? 40 : 20}px ${glows[rank]}` }}>
                  <span style={{ fontFamily: '"Bebas Neue"', fontSize: rank === 0 ? 50 : 32, color: rank === 0 ? "#07021A" : "#fff" }}>{rank + 1}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Miejsca 4–10 */}
        {count > 3 && (
          <div style={{ flex: 1, overflowY: "auto", marginBottom: 12 }}>
            {[3, 4, 5, 6, 7, 8, 9].map((idx) => <Row key={idx} idx={idx} />)}
          </div>
        )}

        {!readOnly && (
          <div>
            {!done ? (
              <button style={{ background: "linear-gradient(135deg,#6B21E8,#4F46E5)", color: "#fff", border: "none", borderRadius: 12, padding: "16px", fontSize: 15, fontWeight: 700, width: "100%", cursor: "pointer" }} onClick={() => setPodStep((s) => s + 1)}>
                {nextPlace === 1 ? "Pokaż 1. miejsce!" : `Pokaż ${nextPlace}. miejsce`}
              </button>
            ) : (
              <div style={{ textAlign: "center" }}>
                <p style={{ color: "#9B89CC", fontSize: 13, marginBottom: 14 }}>Gratulacje dla wszystkich uczestników!</p>
                <button style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, padding: "13px 32px", color: "#C4B5FD", fontSize: 14, cursor: "pointer" }} onClick={onBack}>
                  Wróć do panelu
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default PodiumScreen;
