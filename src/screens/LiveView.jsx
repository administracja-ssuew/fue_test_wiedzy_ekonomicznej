import { useState, useEffect, useRef } from "react";
import {
  supabase, DEMO,
  getSessionForCity, getCityBg, getLiveQuestionStats, getLiveAnswerCount, getQuestions,
} from "../lib/supabase.js";
import { useModules } from "../context/ModulesContext.jsx";
import Countdown from "./Countdown.jsx";

const ANS_COLORS = ["#C2185B", "#1565C0", "#2E7D32", "#E65100"];
const ANS_LABELS = ["A", "B", "C", "D"];

export default function LiveView({ city }) {
  const MODULES = useModules();
  const [session, setSession]     = useState(null);
  const [questions, setQuestions] = useState([]);
  const [phase, setPhase]         = useState("waiting"); // waiting|quiz|reveal
  const [gIdx, setGIdx]           = useState(0);
  const [timer, setTimer]         = useState(0);
  const [reveal, setReveal]       = useState([]);
  const [autoSec, setAutoSec]     = useState(5);
  const [bg, setBg]               = useState("linear-gradient(160deg,#070215 0%,#0E0435 50%,#070215 100%)");
  const [liveCount, setLiveCount] = useState(0);

  const [cdNum, setCdNum]             = useState(null); // countdown: 3/2/1/0=START!/null=hidden

  const sessionRef      = useRef(null);
  const timerRef        = useRef(null);
  const revealRef       = useRef(null);
  const liveRef         = useRef(null);
  const gIdxRef         = useRef(0);
  const questionsRef    = useRef([]);
  const phaseRef        = useRef("waiting");

  useEffect(() => { gIdxRef.current = gIdx; }, [gIdx]);
  useEffect(() => { questionsRef.current = questions; }, [questions]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const syncSession = (sess, qs) => {
    if (!sess?.q_started_at || !qs.length) return;
    const idx = Math.min(sess.current_question_idx || 0, qs.length - 1);
    const q   = qs[idx];
    const m   = MODULES.find((mod) => mod.id === q?.module);
    const timePerQ = m?.timePerQ || 60;
    const elapsed  = Math.max(0, Math.floor((Date.now() - new Date(sess.q_started_at).getTime()) / 1000));
    const remaining = Math.max(0, timePerQ - elapsed);
    setGIdx(idx); gIdxRef.current = idx;
    setTimer(remaining);
    setLiveCount(0);
    setCdNum(null); // clear stale countdown from previous question
    setReveal([]); setPhase("quiz"); phaseRef.current = "quiz";
  };

  // Initial load
  useEffect(() => {
    if (!city) return;
    Promise.all([getSessionForCity(city), getCityBg(city), getQuestions(city)])
      .then(([sess, bgData, qs]) => {
        // LiveView is always on a large screen — prefer desktop bg, fall back to mobile
        const bgVal = bgData?.bg || bgData?.bgMobile;
        if (bgVal) setBg(bgVal);
        if (qs?.length) { setQuestions(qs); questionsRef.current = qs; }
        if (!sess) return;
        setSession(sess); sessionRef.current = sess;
        if (sess.status === "running") syncSession(sess, qs || []);
      });
  }, [city]); // eslint-disable-line

  // Realtime + poll
  useEffect(() => {
    if (!city) return;

    const handleSess = async (s) => {
      if (!s) return;
      setSession(s); sessionRef.current = s;
      const qs = questionsRef.current;
      if (s.status === "running") {
        const curPhase = phaseRef.current;
        const questionChanged = s.current_question_idx !== gIdxRef.current;
        // During reveal, doNext() is already polling for the next question — don't
        // interrupt it. Without this guard, a Realtime event with questionChanged=true
        // calls syncSession ~3s into the 8s reveal countdown, cutting it off early.
        if (curPhase === "reveal") return;
        if (questionChanged || curPhase !== "quiz") {
          syncSession(s, qs);
        }
      } else if (s.status === "waiting" || s.status === "paused") {
        if (phaseRef.current === "quiz") {
          clearInterval(timerRef.current); clearInterval(liveRef.current);
        }
        setPhase("waiting"); phaseRef.current = "waiting";
      } else if (s.status === "ended" || s.status === "results") {
        clearInterval(timerRef.current); clearInterval(liveRef.current);
        setPhase("waiting"); phaseRef.current = "waiting";
      }
    };

    if (!DEMO && supabase) {
      const ch = supabase.channel(`live-view-${city}`)
        .on("broadcast", { event: "quiz_event" }, ({ payload }) => {
          if (payload?.status) {
            getSessionForCity(city).then((s) => { if (s) handleSess(s); });
          }
        })
        .on("postgres_changes", {
          event: "UPDATE", schema: "public", table: "quiz_sessions",
          filter: `city=eq.${city}`,
        }, ({ new: s }) => handleSess(s))
        .subscribe();
      const poll = setInterval(async () => {
        const s = await getSessionForCity(city);
        handleSess(s);
      }, 5000);
      return () => { supabase.removeChannel(ch); clearInterval(poll); };
    }

    const poll = setInterval(async () => {
      const s = await getSessionForCity(city);
      handleSess(s);
    }, 3000);
    return () => clearInterval(poll);
  }, [city]); // eslint-disable-line

  const currentQ = questions[gIdx];
  const mod      = MODULES.find((m) => m.id === currentQ?.module);
  const timePerQ = mod?.timePerQ || 60;
  const timerPct = timer / timePerQ;
  const tColor   = timerPct > .5 ? "#10D9A0" : timerPct > .25 ? "#FF9A3C" : "#E8376B";

  // Minimum time the reveal screen is shown before transitioning.
  // Must match the setTimeout(advanceQuestion, 5000) delay in App.jsx so LiveView
  // and participants reach the next question at the same moment.
  const REVEAL_MIN_MS = 5000;

  const doReveal = async () => {
    const revealStart = Date.now();
    setPhase("reveal"); phaseRef.current = "reveal";
    clearInterval(timerRef.current); clearInterval(liveRef.current);

    const capturedIdx = gIdxRef.current;

    // Fetch answer stats after 2s (participants finishing last submissions)
    setTimeout(async () => {
      const q   = questionsRef.current[capturedIdx];
      const sid = sessionRef.current?.id;
      if (sid && q?.id) {
        const stats = await getLiveQuestionStats(sid, q.id);
        setReveal(stats.answers || []);
      }
    }, 2000);

    // Countdown display: counts down REVEAL_MIN_MS then holds at 0
    setAutoSec(Math.ceil(REVEAL_MIN_MS / 1000));
    clearInterval(revealRef.current);
    revealRef.current = setInterval(() => {
      setAutoSec(Math.max(0, Math.ceil((REVEAL_MIN_MS - (Date.now() - revealStart)) / 1000)));
    }, 500);

    // Poll every second. Transition when DB shows question advanced AND
    // REVEAL_MIN_MS have elapsed — keeps LiveView in sync with participants.
    const qs = questionsRef.current;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (phaseRef.current !== "reveal") { clearInterval(revealRef.current); return; }
      if (capturedIdx + 1 >= qs.length) {
        clearInterval(revealRef.current);
        setPhase("waiting"); phaseRef.current = "waiting";
        return;
      }
      const s = await getSessionForCity(city);
      if (!s || s.status !== "running") {
        clearInterval(revealRef.current);
        setPhase("waiting"); phaseRef.current = "waiting";
        return;
      }
      if (s.current_question_idx > capturedIdx && Date.now() - revealStart >= REVEAL_MIN_MS) {
        clearInterval(revealRef.current);
        setSession(s); sessionRef.current = s;
        syncSession(s, qs);
        return;
      }
    }
    clearInterval(revealRef.current);
    setPhase("waiting"); phaseRef.current = "waiting";
  };

  // Timer effect
  useEffect(() => {
    if (phase !== "quiz" || !mod || !currentQ) return;
    clearInterval(timerRef.current); clearInterval(liveRef.current);
    const modTimePerQ = mod.timePerQ;
    timerRef.current = setInterval(() => {
      const sess = sessionRef.current;
      if (!sess?.q_started_at) {
        setTimer((t) => {
          if (t <= 1) { clearInterval(timerRef.current); doReveal(); return 0; }
          return t - 1;
        });
        return;
      }
      const elapsedRaw = (Date.now() - new Date(sess.q_started_at).getTime()) / 1000;
      if (elapsedRaw < 0) {
        // q_started_at is still in the future — show countdown
        setCdNum(Math.max(0, Math.ceil(-elapsedRaw) - 1));
        setTimer(modTimePerQ);
        return;
      }
      setCdNum(null); // clear countdown once timer starts
      const remaining = Math.max(0, modTimePerQ - Math.floor(elapsedRaw));
      setTimer(remaining);
      if (remaining <= 0) { clearInterval(timerRef.current); doReveal(); }
    }, 1000);
    liveRef.current = setInterval(async () => {
      const q   = questionsRef.current[gIdxRef.current];
      const sid = sessionRef.current?.id;
      if (sid && q?.id) getLiveAnswerCount(sid, q.id).then((c) => setLiveCount(c));
    }, 1000);
    return () => { clearInterval(timerRef.current); clearInterval(liveRef.current); };
  }, [gIdx, phase]); // eslint-disable-line

  const correct   = reveal.filter((a) => a.isCorrect);
  const incorrect = reveal.filter((a) => !a.isCorrect);

  if (cdNum !== null) return <Countdown num={cdNum} />;

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
        {phase === "quiz" && (
          <span style={{ fontSize: 13, color: "#9B89CC", marginLeft: "auto" }}>
            {mod?.icon} {mod?.name} · {gIdx + 1}/{questions.length} · {liveCount} odp.
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

      {/* Quiz phase */}
      {phase === "quiz" && currentQ && (
        <div style={{ width: "100%", maxWidth: 900 }}>
          {/* Timer + question */}
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
          {/* Answers */}
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
              {[["Odpowiedzi", reveal.length, "#EDE9FE"], ["✅ Poprawne", correct.length, "#10D9A0"], ["❌ Błędne", incorrect.length, "#E8376B"]].map(([l, v, c]) => (
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
