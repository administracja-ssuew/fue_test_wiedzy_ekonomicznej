function PodiumScreen({ onBack, podStep, setPodStep, results = [] }) {
  const confColors = ["#F5C518", "#6B21E8", "#E8376B", "#10D9A0", "#1EB5FF"];
  const top5 = results.slice(0, 5);

  // Reveal 5→4→3→2→1: podStep 1=5. miejsce, 2=4., 3=3., 4=2., 5=1.
  // Słupki podium: 3. (idx 2) od podStep≥3, 2. (idx 1) od ≥4, 1. (idx 0) od ≥5.
  const barRevealAt = { 0: 5, 1: 4, 2: 3 };          // idx → próg podStep
  const cardRevealAt = { 3: 2, 4: 1 };               // 4. miejsce od ≥2, 5. od ≥1
  const labels = ["Pokaż 5. miejsce", "Pokaż 4. miejsce", "Pokaż 3. miejsce", "Pokaż 2. miejsce", "Pokaż 1. miejsce!"];

  const Card = ({ idx }) => {
    const p = top5[idx];
    const visible = podStep >= cardRevealAt[idx];
    return (
      <div style={{ flex: 1, opacity: visible && p ? 1 : 0, transition: "opacity .5s" }}>
        {visible && p && (
          <div className="pi" style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontFamily: '"Bebas Neue"', fontSize: 26, color: "#9B89CC", width: 28, textAlign: "center", flexShrink: 0 }}>{idx + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</p>
              <p style={{ fontSize: 10, color: "#9B89CC" }}>{p.city} · {p.correct}/{p.total} popr.</p>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--fue-bg)", display: "flex", justifyContent: "center", fontFamily: '"Space Grotesk",sans-serif', color: "#EDE9FE" }}>
      <div className="fue-page" style={{ justifyContent: "space-between", padding: "36px 22px 28px", overflow: "hidden", position: "relative" }}>
        {podStep >= 5 && Array.from({ length: 24 }).map((_, i) => (
          <div key={i} style={{ position: "absolute", top: -10, left: `${3 + i * 4}%`, width: 7 + (i % 3) * 3, height: 7 + (i % 3) * 3, borderRadius: i % 2 ? "50%" : 3, background: confColors[i % 5], animation: `conffall ${1.4 + (i % 4) * .3}s ${i * .07}s ease-in both`, zIndex: 10 }} />
        ))}

        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 11, color: "#9B89CC", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>Test Wiedzy Ekonomicznej · FUE {new Date().getFullYear()}</p>
          <h1 style={{ fontFamily: '"Bebas Neue"', fontSize: 56, letterSpacing: 3, color: podStep >= 5 ? "#F5C518" : "#EDE9FE", transition: "color .5s", lineHeight: 1 }}>
            {podStep === 0 ? "CEREMONIA" : podStep >= 5 ? "PODIUM!" : "I OTO…"}
          </h1>
        </div>

        {/* Miejsca 4–5 (karty, odsłaniane pierwsze) */}
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <Card idx={4} />
          <Card idx={3} />
        </div>

        {/* Podium top-3 (słupki) */}
        <div style={{ flex: 1, display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 10, padding: "10px 0" }}>
          {[2, 0, 1].map((rank) => {
            const p = top5[rank];
            const heights = [170, 100, 130];
            const colors = ["linear-gradient(180deg,#F5C518,#B8940A)", "linear-gradient(180deg,#A0622A,#6B3A12)", "linear-gradient(180deg,#A0A0A0,#6A6A6A)"];
            const glows = ["rgba(245,197,24,.5)", "rgba(205,127,50,.35)", "rgba(192,192,192,.3)"];
            const visible = podStep >= barRevealAt[rank];
            if (!p) return <div key={rank} style={{ flex: 1, height: heights[rank] }} />;
            return (
              <div key={rank} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", opacity: visible ? 1 : 0, transition: "opacity .5s" }}>
                {visible && (
                  <div className="pi" style={{ textAlign: "center", marginBottom: 8 }}>
                    {rank === 0 && <div style={{ fontSize: 20, marginBottom: 4 }}>👑</div>}
                    <div style={{ width: rank === 0 ? 52 : 44, height: rank === 0 ? 52 : 44, borderRadius: "50%", background: colors[rank], display: "flex", alignItems: "center", justifyContent: "center", fontSize: rank === 0 ? 22 : 18, fontWeight: 800, margin: "0 auto 5px", color: rank === 0 ? "#07021A" : "#fff", ...(rank === 0 ? { animation: "glow 2s infinite" } : {}) }}>
                      {p.name.charAt(0)}
                    </div>
                    <p style={{ fontSize: rank === 0 ? 12 : 11, fontWeight: 700, color: rank === 0 ? "#F5C518" : "#EDE9FE" }}>{p.name.split(" ")[0]}</p>
                    <p style={{ fontSize: 10, color: "#9B89CC" }}>{p.city}</p>
                    <p style={{ fontSize: rank === 0 ? 14 : 12, fontWeight: 700, color: rank === 0 ? "#F5C518" : "#9B89CC", marginTop: 2 }}>{p.correct}/{p.total} popr.</p>
                  </div>
                )}
                <div style={{ width: "100%", height: heights[rank], background: colors[rank], borderRadius: "10px 10px 0 0", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 ${rank === 0 ? 40 : 20}px ${glows[rank]}` }}>
                  <span style={{ fontFamily: '"Bebas Neue"', fontSize: rank === 0 ? 56 : 36, color: rank === 0 ? "#07021A" : "#fff" }}>{rank + 1}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div>
          {podStep < 5 ? (
            <button style={{ background: "linear-gradient(135deg,#6B21E8,#4F46E5)", color: "#fff", border: "none", borderRadius: 12, padding: "16px", fontSize: 15, fontWeight: 700, width: "100%", cursor: "pointer" }} onClick={() => setPodStep((s) => s + 1)}>
              {labels[podStep]}
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
      </div>
    </div>
  );
}

export default PodiumScreen;
