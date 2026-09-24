import { useRef } from "react";
import { ANSWER_BG, ANSWER_LABELS } from "../lib/gameLogic.js";
import { serverNow } from "../lib/serverClock.js";
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

// Ekran pytania — czysto prezentacyjny (Faza 6). Faza, sekundy i czas pytania (item.tpq)
// przychodzą z projekcji zamrożonego planu (useParticipantGame); brak własnych timerów.
// Pasek i pierścień czasu to animacje CSS zakotwiczone w terminie otwarcia (opensAt) —
// animuje je przeglądarka, niezależnie od zadławienia wątku JS; cyfry liczy ticker rAF hooka.
export default function Quiz({ item, mod, phase, secondsLeft, opensAt, closesAt, revealUntil, picked, answerStatus, correctAns,
  qNumGlobal, totalQuestions, qNumInModule, moduleCount, correctTotal, isDesktop, isPractice, participantCode, sessionId, onPick }) {
  // All hooks must run unconditionally (Rules of Hooks) — guard comes after.
  const { violations, showWarning, lastType, dismiss } = useAntiCheat({
    active: true,
    participantCode,
    sessionId,
  });

  // Ujemny animation-delay liczony RAZ na (pytanie, otwarcie). Gdyby liczyć go w każdym
  // renderze (co tik sekund), przeglądarka zaktualizowałaby opóźnienie działającej
  // animacji przy niezmienionym czasie startu — pasek przeskakiwałby do przodu.
  // Nowy opensAt (skip/repeat/wznowienie) = nowy klucz = restart animacji.
  const animKey = item ? `${item.id}-${opensAt}` : "";
  const animRef = useRef({ key: null, delay: 0 });
  if (animRef.current.key !== animKey) {
    animRef.current = { key: animKey, delay: opensAt != null ? -(serverNow() - opensAt) / 1000 : 0 };
  }
  const animDelay = animRef.current.delay;

  if (!item || !item.opts || !mod) return null;

  const answered = phase === "reveal";
  // Poprawny indeks WYŁĄCZNIE z serwera (revealed_* / reveal ze snapshotu). Do tego czasu
  // w reveal pokazujemy komunikat oczekiwania zamiast kolorów (Pułapka 2).
  const correctIdx = correctAns != null ? correctAns : null;
  const hasReveal = answered && correctIdx != null;

  const tpq = item.tpq || 1;
  // W reveal secondsLeft liczy do revealUntil („następne” w pasku) — licznik pytania stoi na 0.
  const timer = phase === "quiz" ? (secondsLeft ?? 0) : 0;
  const timerPct = phase === "quiz" ? Math.min(1, timer / tpq) : 0;
  const r = 22, circ = 2 * Math.PI * r;
  const tColor = timer > tpq * 0.5 ? "#10D9A0" : timer > tpq * 0.25 ? "#FF9A3C" : "#E8376B";
  const total = totalQuestions || 1;

  // Plain JSX value (not a nested component) — rendering <QuizContent /> created a
  // brand-new component type every render, remounting the whole subtree on each
  // 1-second timer tick. Computing it as a value keeps the DOM stable.
  const quizContent = (
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
          <p style={{ fontWeight: 700, fontSize: 14, marginTop: 3 }}>Pytanie {qNumInModule} / {moduleCount} · #{qNumGlobal}/{totalQuestions}</p>
        </div>
        <div style={{ position: "relative", width: 54, height: 54, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="54" height="54" style={{ position: "absolute", transform: "rotate(-90deg)" }}>
            <circle cx="27" cy="27" r={r} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="4" />
            {/* Pierścień = animacja CSS fueRing zakotwiczona w opensAt. Inline strokeDashoffset
                to tylko skokowy zapas dla prefers-reduced-motion (animacja ma pierwszeństwo). */}
            <circle key={animKey} className="fue-ring" cx="27" cy="27" r={r} fill="none" stroke={tColor} strokeWidth="4" strokeLinecap="round"
              strokeDasharray={circ}
              style={{
                "--fue-circ": `${circ}px`, strokeDashoffset: circ * (1 - timerPct),
                animationName: "fueRing", animationTimingFunction: "linear", animationFillMode: "forwards",
                animationDuration: `${tpq}s`, animationDelay: `${animDelay}s`,
                animationPlayState: phase === "quiz" ? "running" : "paused",
                transition: "stroke .4s",
              }} />
          </svg>
          <span style={{ fontFamily: '"Bebas Neue"', fontSize: 22, color: tColor, transition: "color .4s" }}>{timer}</span>
        </div>
      </div>

      {/* Pasek czasu — animacja CSS fueDrain (transform: scaleX) zakotwiczona w opensAt:
          animuje kompozytor, więc jest płynna nawet przy zadławionym wątku JS. Inline
          transform to skokowy zapas dla prefers-reduced-motion (animacja ma pierwszeństwo). */}
      <div style={{ height: 6, background: "rgba(255,255,255,.07)", overflow: "hidden", flexShrink: 0 }}>
        <div key={animKey} className="fue-drain" style={{
          height: "100%", transformOrigin: "left", background: `linear-gradient(90deg,${mod.color},#F5C518)`,
          animationName: "fueDrain", animationTimingFunction: "linear", animationFillMode: "forwards",
          animationDuration: `${tpq}s`, animationDelay: `${animDelay}s`,
          animationPlayState: phase === "quiz" ? "running" : "paused",
          transform: phase === "reveal" ? "scaleX(0)" : `scaleX(${timerPct})` }} />
      </div>

      {/* Global progress */}
      <div style={{ height: 3, background: "rgba(255,255,255,.07)", flexShrink: 0 }}>
        <div style={{ height: "100%", background: `linear-gradient(90deg,${mod.color},#F5C518)`, width: `${(qNumGlobal / total) * 100}%`, transition: "width .4s" }} />
      </div>

      {/* Question */}
      <div style={{ padding: "22px 20px 14px", flexShrink: 0 }}>
        <p style={{ fontSize: isDesktop ? 20 : 18, fontWeight: 700, lineHeight: 1.45, textAlign: "center" }}>
          {item.q}
        </p>
      </div>

      {/* Answers */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "0 14px 20px", alignContent: "start" }}>
        {item.opts.map((opt, i) => {
          const sel = picked === i, ok = hasReveal && i === correctIdx;
          let bg = ANSWER_BG[i], opacity = 1, border = "none";
          if (!hasReveal && sel) {
            // Wybrane, a poprawna odpowiedź jeszcze nieznana — obrys „zablokowane”, bez koloru
            opacity = 1;
            border = "3px solid rgba(255,255,255,.9)";
          } else if (answered && !hasReveal) {
            // Czas minął, czekamy na odsłonięcie z serwera — przygaś niewybrane
            opacity = .45;
          } else if (hasReveal) {
            // Timer ended — reveal correct/wrong
            if (sel && ok)       bg = "#0B9E6B";
            else if (sel && !ok) bg = "#C0284A";
            else if (!sel && ok) { bg = "#0B9E6B"; opacity = .85; }
            else                 opacity = .3;
          }
          // Zapis w toku → wybrana odpowiedź pulsuje, aż serwer potwierdzi (saved/failed).
          const pendingPulse = sel && !answered && answerStatus === "pending";
          return (
            <button key={i} className="ans-btn"
              onClick={() => {
                if (answered || picked !== null) return;
                // Optymistyczny lock-in: hook ustawia `picked` synchronicznie (ta sama klatka),
                // krótka wibracja potwierdza dotyk tam, gdzie działa (Android; iOS — brak, bez szkody).
                try { navigator.vibrate?.(15); } catch (_) { /* nieistotne */ }
                onPick(i);
              }}
              style={{ background: bg, border, borderRadius: 14, padding: "16px 12px", color: "#fff", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8, cursor: (answered || picked !== null) ? "default" : "pointer", opacity, minHeight: 100, textAlign: "left", boxShadow: "0 4px 18px rgba(0,0,0,.35)", position: "relative", overflow: "hidden", animation: pendingPulse ? "pulse 1s infinite" : undefined }}
              disabled={answered || picked !== null}>
              <div style={{ width: 28, height: 28, borderRadius: 7, background: "rgba(0,0,0,.28)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800 }}>{ANSWER_LABELS[i]}</div>
              <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{opt}</span>
              {!hasReveal && sel && <div style={{ position: "absolute", top: 8, right: 10, fontSize: 13, color: "rgba(255,255,255,.7)" }}>✔ wybrano</div>}
              {hasReveal && ok  && <div style={{ position: "absolute", top: 8, right: 10, fontSize: 16 }}>✓</div>}
              {hasReveal && sel && !ok && <div style={{ position: "absolute", top: 8, right: 10, fontSize: 16 }}>✗</div>}
            </button>
          );
        })}
      </div>

      <div style={{ padding: "0 14px 10px" }}>
        <p style={{ fontSize: 12, color: "#9B89CC", textAlign: "center" }}>Poprawne odpowiedzi: <strong style={{ color: "#10D9A0" }}>{correctTotal ?? 0}</strong> / {totalQuestions}</p>
      </div>
      {/* Rezerwa miejsca pod stały pasek potwierdzenia (żeby nie zasłaniał odpowiedzi) */}
      {picked !== null && !answered && <div style={{ height: 92, flexShrink: 0 }} />}
    </div>
  );

  const warningMsg = lastType === "screenshot_attempt"
    ? "Wykryto próbę wykonania zrzutu ekranu."
    : "Wykryto przełączenie zakładki / opuszczenie okna testu.";

  return (
    <div style={W.wrap}>
      <div className="fue-quiz-layout" style={{ width: "100%" }}>
        {quizContent}
      </div>

      {/* Stały pasek potwierdzenia wyboru — zawsze widoczny u dołu (bez scrolla na mobile) */}
      {picked !== null && !answered && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 200, background: "rgba(7,2,21,.97)", borderTop: "2px solid rgba(16,217,160,.55)", padding: "12px 18px", textAlign: "center", fontFamily: '"Space Grotesk",sans-serif' }}>
          <p style={{ fontSize: 15, fontWeight: 800, color: "#10D9A0" }}>✔ Twoja odpowiedź: {ANSWER_LABELS[picked]} — {item.opts[picked]}</p>
          {answerStatus === "failed" ? (
            <p style={{ fontSize: 13, color: "#E8376B", marginTop: 3, fontWeight: 700 }}>⚠️ Nie udało się zapisać odpowiedzi</p>
          ) : answerStatus === "pending" ? (
            <p style={{ fontSize: 13, color: "#9B89CC", marginTop: 3, fontWeight: 600 }}>⏳ Zapisywanie…</p>
          ) : (
            <p style={{ fontSize: 13, color: "#EDE9FE", marginTop: 3, fontWeight: 600 }}>Odpowiedź jest <strong style={{ color: "#F5C518" }}>OSTATECZNA</strong> — nie można jej zmienić.</p>
          )}
        </div>
      )}

      {/* Pasek wyniku w fazie reveal — licznik „następne” = secondsLeft do revealUntil */}
      {answered && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 200, background: "rgba(7,2,21,.96)", borderTop: "1px solid rgba(255,255,255,.1)", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: '"Space Grotesk",sans-serif' }}>
          {hasReveal ? (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 22 }}>✅</span>
              <div>
                <p style={{ fontSize: 10, color: "#9B89CC", marginBottom: 2, textTransform: "uppercase", letterSpacing: 1 }}>Poprawna odpowiedź</p>
                <p style={{ fontSize: 15, fontWeight: 700, color: "#10D9A0" }}>{item.opts[correctIdx]}</p>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div className="spinner" style={{ width: 22, height: 22, border: "3px solid rgba(107,33,232,.3)", borderTop: "3px solid #6B21E8", borderRadius: "50%" }} />
              <p style={{ fontSize: 15, fontWeight: 700, color: "#C4B5FD" }}>Sprawdzamy odpowiedź…</p>
            </div>
          )}
          <div style={{ textAlign: "center" }}>
            <p style={{ fontFamily: '"Bebas Neue"', fontSize: 40, color: "#F5C518", lineHeight: 1 }}>{secondsLeft ?? 0}</p>
            <p style={{ fontSize: 9, color: "#9B89CC", textTransform: "uppercase", letterSpacing: 1 }}>następne</p>
          </div>
        </div>
      )}

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
