import { MODULES } from "../data/questions.js";
import { ANSWER_BG, ANSWER_LABELS } from "../lib/gameLogic.js";
import useAntiCheat from "../hooks/useAntiCheat.js";

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

export default function Quiz({ currentQ, mod, currentMod, qIdx, timer, picked, answered, myPts, allAnswers, isDesktop, isPractice, qs, totalQuestions, participantCode, sessionId, onPick }) {
  if (!currentQ || !mod) return null;

  const { violations, showWarning, lastType, dismiss } = useAntiCheat({
    active: true,
    participantCode,
    sessionId,
  });
  const timerPct = timer / mod.timePerQ;
  const r = 22, circ = 2 * Math.PI * r;
  const tColor = timer > mod.timePerQ * 0.5 ? "#10D9A0" : timer > mod.timePerQ * 0.25 ? "#FF9A3C" : "#E8376B";
  const total = totalQuestions?.length || qs.length * MODULES.length;
  const qNumGlobal = (totalQuestions || []).filter((q) => q.module < currentMod).length + qIdx + 1;

  const QuizContent = () => (
    <div className="fue-quiz-main" style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      {/* Top bar */}
      <div style={{ background: "rgba(0,0,0,.45)", backdropFilter: "blur(8px)", padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ background: `${mod.color}22`, border: `1px solid ${mod.color}44`, borderRadius: 20, padding: "2px 10px", fontSize: 10, fontWeight: 700, color: mod.color }}>
              {mod.icon} {mod.name}
            </span>
            {isPractice && <span style={{ background: "rgba(16,217,160,.2)", border: "1px solid rgba(16,217,160,.4)", borderRadius: 20, padding: "2px 8px", fontSize: 10, fontWeight: 700, color: "#10D9A0" }}>PRÓBA</span>}
          </div>
          <p style={{ fontWeight: 700, fontSize: 14, marginTop: 3 }}>Pytanie {qIdx + 1} / {qs.length} · #{qNumGlobal}/{total}</p>
        </div>
        <div style={{ position: "relative", width: 54, height: 54, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="54" height="54" style={{ position: "absolute", transform: "rotate(-90deg)" }}>
            <circle cx="27" cy="27" r={r} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="4" />
            <circle cx="27" cy="27" r={r} fill="none" stroke={tColor} strokeWidth="4" strokeLinecap="round"
              strokeDasharray={circ} strokeDashoffset={circ * (1 - timerPct)}
              style={{ transition: "stroke-dashoffset .95s linear, stroke .4s" }} />
          </svg>
          <span style={{ fontFamily: '"Bebas Neue"', fontSize: 22, color: tColor, transition: "color .4s" }}>{timer}</span>
        </div>
      </div>

      {/* Global progress */}
      <div style={{ height: 3, background: "rgba(255,255,255,.07)", flexShrink: 0 }}>
        <div style={{ height: "100%", background: `linear-gradient(90deg,${mod.color},#F5C518)`, width: `${(qNumGlobal / total) * 100}%`, transition: "width .4s" }} />
      </div>

      {/* Question */}
      <div style={{ padding: "22px 20px 14px", flexShrink: 0 }}>
        <p style={{ fontSize: isDesktop ? 20 : 18, fontWeight: 700, lineHeight: 1.45, textAlign: "center" }}>
          {currentQ.q}
        </p>
      </div>

      {/* Answers */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "0 14px 20px", alignContent: "start" }}>
        {currentQ.opts.map((opt, i) => {
          const sel = picked === i, ok = i === currentQ.ans;
          let bg = ANSWER_BG[i], opacity = 1, border = "none";
          if (!answered && sel) {
            // Picked but timer still running — show as locked-in (bright outline, no color change)
            opacity = 1;
            border = "3px solid rgba(255,255,255,.9)";
          } else if (answered) {
            // Timer ended — reveal correct/wrong
            if (sel && ok)       bg = "#0B9E6B";
            else if (sel && !ok) bg = "#C0284A";
            else if (!sel && ok) { bg = "#0B9E6B"; opacity = .85; }
            else                 opacity = .3;
          }
          return (
            <button key={i} onClick={() => onPick(i)} className="ans-btn"
              style={{ background: bg, border, borderRadius: 14, padding: "16px 12px", color: "#fff", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8, cursor: (answered || picked !== null) ? "default" : "pointer", opacity, minHeight: 100, textAlign: "left", boxShadow: "0 4px 18px rgba(0,0,0,.35)", position: "relative", overflow: "hidden" }}
              disabled={answered || picked !== null}>
              <div style={{ width: 28, height: 28, borderRadius: 7, background: "rgba(0,0,0,.28)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800 }}>{ANSWER_LABELS[i]}</div>
              <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{opt}</span>
              {!answered && sel && <div style={{ position: "absolute", top: 8, right: 10, fontSize: 13, color: "rgba(255,255,255,.7)" }}>✔ wybrano</div>}
              {answered && ok  && <div style={{ position: "absolute", top: 8, right: 10, fontSize: 16 }}>✓</div>}
              {answered && sel && !ok && <div style={{ position: "absolute", top: 8, right: 10, fontSize: 16 }}>✗</div>}
            </button>
          );
        })}
      </div>

      <div style={{ padding: "0 14px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <p style={{ fontSize: 12, color: "#9B89CC" }}>Łączny wynik: <strong style={{ color: "#F5C518" }}>{myPts} pkt</strong></p>
      </div>
    </div>
  );

  const Sidebar = () => (
    <div className="fue-quiz-sidebar" style={{ background: "rgba(0,0,0,.2)" }}>
      <p style={{ fontSize: 11, color: "#9B89CC", letterSpacing: 1, textTransform: "uppercase", fontWeight: 600, marginBottom: 16 }}>Twoje wyniki</p>
      {MODULES.map((m) => {
        const mAnswers = allAnswers.filter((a) => a.module === m.id);
        const mPts = mAnswers.reduce((s, a) => s + a.pts, 0);
        const done = currentMod > m.id;
        const active = currentMod === m.id;
        return (
          <div key={m.id} style={{ ...W.card({ padding: "12px 14px", marginBottom: 8, borderColor: active ? `${m.color}55` : "rgba(255,255,255,.06)", background: active ? `${m.color}10` : "rgba(255,255,255,.02)" }) }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 18 }}>{m.icon}</span>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 12, fontWeight: 700 }}>{m.name}</p>
                <p style={{ fontSize: 10, color: "#9B89CC" }}>{m.timePerQ}s/pyt.</p>
              </div>
              <div style={{ textAlign: "right" }}>
                {done ? <p style={{ fontFamily: '"Bebas Neue"', fontSize: 18, color: "#F5C518" }}>{mPts} pkt</p>
                  : active ? <p style={{ fontSize: 10, color: m.color, fontWeight: 700, animation: "pulse 1.5s infinite" }}>W toku</p>
                  : <p style={{ fontSize: 10, color: "#9B89CC" }}>Oczekuje</p>}
              </div>
            </div>
          </div>
        );
      })}
      <div style={{ ...W.card({ padding: "14px", marginTop: 8, textAlign: "center", borderColor: "rgba(245,197,24,.25)" }), background: "rgba(245,197,24,.06)" }}>
        <p style={{ fontSize: 11, color: "#9B89CC" }}>Łącznie</p>
        <p style={{ fontFamily: '"Bebas Neue"', fontSize: 36, color: "#F5C518", lineHeight: 1 }}>{myPts}</p>
        <p style={{ fontSize: 10, color: "#9B89CC" }}>punktów</p>
      </div>
    </div>
  );

  const warningMsg = lastType === "screenshot_attempt"
    ? "Wykryto próbę wykonania zrzutu ekranu."
    : "Wykryto przełączenie zakładki / opuszczenie okna testu.";

  return (
    <div style={W.wrap}>
      <div className="fue-quiz-layout" style={{ width: "100%", maxWidth: isDesktop ? 1240 : 460 }}>
        <QuizContent />
        <Sidebar />
      </div>

      {/* Anti-cheat warning overlay */}
      {showWarning && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.95)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: '"Space Grotesk",sans-serif', padding: 24 }}>
          <div style={{ maxWidth: 400, width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: 56, marginBottom: 16 }} className="pi">⚠️</div>
            <h2 style={{ fontFamily: '"Bebas Neue"', fontSize: 36, letterSpacing: 1, color: "#E8376B", marginBottom: 12 }}>
              Administrator poinformowany!
            </h2>
            <p style={{ color: "#EDE9FE", fontSize: 15, lineHeight: 1.6, marginBottom: 8 }}>
              {warningMsg}
            </p>
            <p style={{ color: "#9B89CC", fontSize: 13, marginBottom: 28, lineHeight: 1.6 }}>
              Wykonuj test <strong style={{ color: "#EDE9FE" }}>samodzielnie</strong> bez opuszczania ekranu quizu.<br />
              Naruszenia są rejestrowane i widoczne dla administratora.
            </p>
            {violations > 1 && (
              <p style={{ background: "rgba(232,55,107,.15)", border: "1px solid rgba(232,55,107,.3)", borderRadius: 10, padding: "8px 16px", color: "#E8376B", fontSize: 13, marginBottom: 20 }}>
                Łączna liczba naruszeń: <strong>{violations}</strong>
              </p>
            )}
            <button onClick={dismiss}
              style={{ background: "linear-gradient(135deg,#6B21E8,#4F46E5)", color: "#fff", border: "none", borderRadius: 12, padding: "14px 32px", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: '"Space Grotesk",sans-serif' }}>
              Rozumiem — wracam do testu
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
