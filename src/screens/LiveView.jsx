import useLiveProjection from "../hooks/useLiveProjection.js";
import Countdown from "./Countdown.jsx";
import ModuleIntroFS from "./ModuleIntroFS.jsx";

const ANS_COLORS = ["#C2185B", "#1565C0", "#2E7D32", "#E65100"];
const ANS_LABELS = ["A", "B", "C", "D"];

// Standalone spectator view (opened via ?live=1&city=X). Pure render over the
// shared DB-state projection — stays in sync with participants and the admin embed.
export default function LiveView({ city }) {
  // Public projector — anon, so no per-participant data; aggregate counts only.
  const { phase, gIdx, timer, autoSec, cdNum, firstOfModule, currentQ, questions, mod, timePerQ, revealTotal, revealCorrect, liveCount, participantsTotal, bg } =
    useLiveProjection(city);

  const timerPct = Math.max(0, Math.min(1, timer / (timePerQ || 60)));
  const tColor   = timerPct > .5 ? "#10D9A0" : timerPct > .25 ? "#FF9A3C" : "#E8376B";

  if (cdNum !== null) return firstOfModule
    ? <ModuleIntroFS mod={mod} secondsLeft={cdNum} />
    : <Countdown num={cdNum} />;

  return (
    <div style={{
      minHeight: "100vh", background: bg,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: '"Space Grotesk",sans-serif', color: "#EDE9FE",
      padding: "24px",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24, width: "100%", maxWidth: 900 }}>
        <div style={{ background: "#E8376B", borderRadius: 20, padding: "3px 14px", fontSize: 13, fontWeight: 700, color: "#fff", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff", animation: "pulse 1s infinite" }} />
          LIVE
        </div>
        <span style={{ fontFamily: '"Bebas Neue"', fontSize: 20, letterSpacing: 1 }}>{city}</span>
        {(phase === "quiz" || phase === "reveal") && (
          <span style={{ fontSize: 13, color: "#9B89CC", marginLeft: "auto" }}>
            {mod?.icon} {mod?.name} · {gIdx + 1}/{questions.length} · {liveCount}/{participantsTotal} odp.
          </span>
        )}
      </div>

      {/* Waiting */}
      {phase === "waiting" && (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>⏳</div>
          <p style={{ fontFamily: '"Bebas Neue"', fontSize: 48, letterSpacing: 2, color: "#F5C518" }}>Oczekiwanie</p>
          <p style={{ color: "#9B89CC", fontSize: 16, marginTop: 8 }}>Quiz dla {city} zaraz się rozpocznie.</p>
        </div>
      )}

      {/* Paused */}
      {phase === "paused" && (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>⏸️</div>
          <p style={{ fontFamily: '"Bebas Neue"', fontSize: 48, letterSpacing: 2, color: "#F5C518" }}>Wstrzymano</p>
          <p style={{ color: "#9B89CC", fontSize: 16, marginTop: 8 }}>Administrator wstrzymał quiz — za chwilę wznowienie.</p>
        </div>
      )}

      {/* Quiz phase */}
      {phase === "quiz" && currentQ && (
        <div style={{ width: "100%", maxWidth: 900 }}>
          <div style={{
            background: "rgba(0,0,0,.45)", backdropFilter: "blur(12px)",
            borderRadius: 20, padding: "28px 32px", marginBottom: 20,
            border: "1px solid rgba(255,255,255,.12)",
            display: "flex", alignItems: "center", gap: 24,
          }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 11, color: "#9B89CC", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
                Pytanie {gIdx + 1} / {questions.length}
              </p>
              <p style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.4 }}>{currentQ.q}</p>
            </div>
            <div style={{ width: 80, height: 80, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="80" height="80" style={{ position: "absolute", transform: "rotate(-90deg)" }}>
                <circle cx="40" cy="40" r="32" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="6"/>
                <circle cx="40" cy="40" r="32" fill="none" stroke={tColor} strokeWidth="6" strokeLinecap="round"
                  strokeDasharray="201" strokeDashoffset={201 * (1 - timerPct)} style={{ transition: "stroke-dashoffset .95s linear" }}/>
              </svg>
              <span style={{ fontFamily: '"Bebas Neue"', fontSize: 30, color: tColor }}>{timer}</span>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {currentQ.opts.map((opt, i) => (
              <div key={i} style={{
                background: ANS_COLORS[i], borderRadius: 16, padding: "18px 22px",
                display: "flex", alignItems: "center", gap: 14,
                boxShadow: "0 4px 16px rgba(0,0,0,.3)",
              }}>
                <span style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(0,0,0,.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, color: "#fff", flexShrink: 0 }}>
                  {ANS_LABELS[i]}
                </span>
                <span style={{ fontSize: 17, color: "#fff", fontWeight: 600 }}>{opt}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reveal phase */}
      {phase === "reveal" && currentQ && (
        <div style={{ width: "100%", maxWidth: 900 }}>
          <div style={{
            background: "rgba(0,0,0,.45)", backdropFilter: "blur(12px)",
            borderRadius: 20, padding: "24px 28px", marginBottom: 16,
            border: "1px solid rgba(255,255,255,.12)",
          }}>
            <p style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>{currentQ.q}</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
              {currentQ.opts.map((opt, i) => (
                <div key={i} style={{
                  background: i === currentQ.ans ? "rgba(16,217,160,.25)" : "rgba(255,255,255,.06)",
                  border: `2px solid ${i === currentQ.ans ? "#10D9A0" : "rgba(255,255,255,.08)"}`,
                  borderRadius: 12, padding: "14px 18px",
                  display: "flex", alignItems: "center", gap: 10,
                  opacity: i === currentQ.ans ? 1 : 0.6,
                }}>
                  <span style={{ width: 30, height: 30, borderRadius: 8, background: i === currentQ.ans ? "#10D9A0" : "rgba(255,255,255,.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: i === currentQ.ans ? "#070215" : "#fff", flexShrink: 0 }}>
                    {ANS_LABELS[i]}
                  </span>
                  <span style={{ fontSize: 15, color: i === currentQ.ans ? "#10D9A0" : "#EDE9FE", fontWeight: i === currentQ.ans ? 700 : 400 }}>{opt}</span>
                  {i === currentQ.ans && <span style={{ marginLeft: "auto", fontSize: 18 }}>✅</span>}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              {[["Odpowiedzi", revealTotal, "#EDE9FE"], ["✅ Poprawne", revealCorrect, "#10D9A0"], ["❌ Błędne", revealTotal - revealCorrect, "#E8376B"]].map(([l, v, c]) => (
                <div key={l} style={{ textAlign: "center" }}>
                  <p style={{ fontFamily: '"Bebas Neue"', fontSize: 28, color: c, lineHeight: 1 }}>{v}</p>
                  <p style={{ fontSize: 11, color: "#9B89CC" }}>{l}</p>
                </div>
              ))}
              <div style={{ marginLeft: "auto", textAlign: "right" }}>
                <p style={{ fontSize: 12, color: "#9B89CC" }}>Następne pytanie za</p>
                <p style={{ fontFamily: '"Bebas Neue"', fontSize: 32, color: "#F5C518", lineHeight: 1 }}>{autoSec}s</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <p style={{ position: "fixed", bottom: 12, right: 16, fontSize: 10, color: "rgba(155,137,204,.3)" }}>FUE Quiz · Live View</p>
    </div>
  );
}
