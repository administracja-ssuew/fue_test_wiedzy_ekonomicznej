import { useState, useEffect, useRef } from "react";
import { MODULES, QUESTIONS } from "./data/questions.js";
import { logoutAdmin, saveAnswer, getSessionForCity, getCityBg, markCodeUsed, getQuestions, updateSession } from "./lib/supabase.js";
import { calcPts, getModule } from "./lib/gameLogic.js";
import useWindowWidth from "./hooks/useWindowWidth.js";
import useAuth from "./hooks/useAuth.js";

import Welcome        from "./screens/Welcome.jsx";
import Break          from "./screens/Break.jsx";
import WaitingResults from "./screens/WaitingResults.jsx";
import CodeEntry   from "./screens/CodeEntry.jsx";
import AdminLogin  from "./screens/AdminLogin.jsx";
import Practice    from "./screens/Practice.jsx";
import Lobby       from "./screens/Lobby.jsx";
import ModuleIntro from "./screens/ModuleIntro.jsx";
import Quiz        from "./screens/Quiz.jsx";
import Ended       from "./screens/Ended.jsx";
import AdminPanel  from "./screens/AdminPanel.jsx";
import Podium      from "./screens/Podium.jsx";

export default function App() {
  const [screen, setScreen] = useState("welcome");
  const { user: admin, loading } = useAuth(); // admin session via Supabase Auth

  // Participant (no auth — identified by code)
  const [participant, setParticipant] = useState(null); // { code, name, surname, city }

  // Quiz state
  const [quizSession, setQuizSession]   = useState(null);
  const [cityQuestions, setCityQuestions] = useState([]); // loaded from DB for participant's city
  const [currentMod, setCurrentMod]     = useState(1);
  const [qIdx, setQIdx]                 = useState(0);
  const [timer, setTimer]               = useState(0);
  const [picked, setPicked]             = useState(null);
  const [answered, setAnswered]         = useState(false);
  const [myPts, setMyPts]               = useState(0);
  const [allAnswers, setAllAnswers]     = useState([]);
  const [nextModule, setNextModule]     = useState(null); // module to start after break
  const [podStep, setPodStep]           = useState(0);

  // Auto-break only after module 2 (between mod 2 and 3)
  // After module 5 → waiting_results (admin reveals ranking manually)
  const BREAK_AFTER = [2];

  const timerRef  = useRef(null);
  const pickTime  = useRef(null);
  const isDesktop = useWindowWidth() >= 900;

  // Use DB questions when available, fallback to hardcoded
  const activeQuestions = cityQuestions.length > 0 ? cityQuestions : QUESTIONS;
  const qs       = activeQuestions.filter((q) => q.module === currentMod);
  const currentQ = qs[qIdx];
  const mod      = getModule(currentMod);

  // ── Timer ────────────────────────────────────────────────────────
  useEffect(() => {
    if (screen !== "quiz") { clearInterval(timerRef.current); return; }
    if (!mod) return;
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimer((t) => {
        if (t <= 1) { clearInterval(timerRef.current); handleTimeout(); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [screen, currentMod, qIdx]);

  // ── Quiz logic ───────────────────────────────────────────────────

  // Called when timer hits 0 — reveals correct answer to participant
  const handleTimeout = () => {
    if (answered) return;
    const userPicked  = picked;               // may be null (no answer)
    const timeWhenPicked = pickTime.current;  // timer value when they clicked

    const correct = userPicked !== null && userPicked === currentQ?.ans;
    const pts     = userPicked !== null ? calcPts(timeWhenPicked, mod.timePerQ, correct) : 0;

    setMyPts((p) => p + pts);
    setAllAnswers((prev) => currentQ
      ? [...prev, { qId: currentQ.id, module: currentMod, picked: userPicked, correct, pts }]
      : prev);

    // Save missed answers to DB (picked answers saved immediately in handlePick)
    if (userPicked === null && currentQ && participant && quizSession) {
      saveAnswer({ sessionId: quizSession.id, participantCode: participant.code, participantName: `${participant.name} ${participant.surname}`, city: participant.city, questionId: currentQ.id, module: currentMod, chosen: null, isCorrect: false, points: 0 });
    }

    setAnswered(true); // NOW reveal correct/wrong colors
    setTimeout(advanceQuestion, 2200);
  };

  // User clicks an answer — lock in choice but DON'T reveal yet (timer still runs)
  const handlePick = (i) => {
    if (picked !== null || answered) return; // already picked or revealed
    pickTime.current = timer;
    setPicked(i);

    // Save to DB immediately so admin sees live responses
    if (currentQ && participant && quizSession) {
      const correct = i === currentQ.ans;
      const pts     = calcPts(timer, mod.timePerQ, correct);
      saveAnswer({ sessionId: quizSession.id, participantCode: participant.code, participantName: `${participant.name} ${participant.surname}`, city: participant.city, questionId: currentQ.id, module: currentMod, chosen: i, isCorrect: correct, points: pts });
    }
    // Timer keeps running — handleTimeout will reveal the answer
  };

  const advanceQuestion = () => {
    const nextIdx = qIdx + 1;
    if (nextIdx < qs.length) {
      setQIdx(nextIdx); setTimer(mod.timePerQ); setPicked(null); setAnswered(false); setScreen("quiz");
    } else {
      const nextMod = currentMod + 1;
      if (BREAK_AFTER.includes(currentMod)) {
        // Automatyczna przerwa po module 2 lub 4
        const afterBreakModule = nextMod <= MODULES.length ? nextMod : null;
        setNextModule(afterBreakModule);
        setPicked(null); setAnswered(false);
        setScreen("break");
        // Poinformuj sesję o pauzie (admin widzi stan)
        if (quizSession) updateSession(quizSession.id, { status: "paused" });
      } else if (nextMod <= MODULES.length) {
        setCurrentMod(nextMod); setQIdx(0); setPicked(null); setAnswered(false);
        setTimer(getModule(nextMod).timePerQ); setScreen("module_intro");
      } else {
        // Wszystkie moduły skończone → czekaj na ogłoszenie wyników przez admina
        setScreen("waiting_results");
        if (quizSession) updateSession(quizSession.id, { status: "paused" });
      }
    }
  };

  // Wznowienie po przerwie (admin zmienił status na "running")
  const handleResumeFromBreak = () => {
    if (nextModule && nextModule <= MODULES.length) {
      setCurrentMod(nextModule); setQIdx(0); setPicked(null); setAnswered(false);
      setTimer(getModule(nextModule).timePerQ); setScreen("module_intro");
    } else {
      setScreen("ended"); // moduł 5 = ogłoszenie wyników
    }
  };

  // Participant validates code → enters lobby
  const handleCodeSuccess = async (participantData) => {
    setParticipant(participantData);
    const session = await getSessionForCity(participantData.city);
    if (session) {
      setQuizSession(session);
      markCodeUsed(participantData.code, session.id);
    }
    // Apply city-specific background
    const bg = session?.bg || await getCityBg(participantData.city);
    if (bg) document.documentElement.style.setProperty("--fue-bg", bg);
    setScreen("lobby");
  };

  // Called automatically by Lobby when admin changes status to "running"
  const startQuiz = async (session) => {
    setQuizSession(session);
    // Load city-specific questions from DB (fallback to hardcoded if none)
    if (session?.city) {
      const dbQs = await getQuestions(session.city);
      if (dbQs.length > 0) setCityQuestions(dbQs);
    }
    setCurrentMod(1); setQIdx(0); setMyPts(0); setAllAnswers([]);
    setPicked(null); setAnswered(false); setTimer(MODULES[0].timePerQ);
    setScreen("module_intro");
  };

  const handleAdminLogout = async () => { await logoutAdmin(); setScreen("welcome"); };
  const resetApp = () => {
    setScreen("welcome"); setParticipant(null); setMyPts(0);
    setAllAnswers([]); setQuizSession(null); setCityQuestions([]); setNextModule(null);
  };

  // ── Loading ──────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#070215", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, fontFamily: '"Space Grotesk",sans-serif', color: "#EDE9FE" }}>
      <div className="spinner" style={{ width: 40, height: 40, border: "3px solid rgba(107,33,232,.3)", borderTop: "3px solid #6B21E8", borderRadius: "50%" }} />
      <p style={{ color: "#9B89CC", fontSize: 14 }}>Ładowanie…</p>
    </div>
  );

  // ── Routing ──────────────────────────────────────────────────────
  if (screen === "welcome")
    return <Welcome isDesktop={isDesktop} onEnterCode={() => setScreen("code_entry")} onAdminLogin={() => setScreen("admin_login")} />;

  if (screen === "code_entry")
    return <CodeEntry onBack={() => setScreen("welcome")} onSuccess={handleCodeSuccess} />;

  if (screen === "admin_login")
    return <AdminLogin onBack={() => setScreen("welcome")} onSuccess={(u) => setScreen("admin")} />;

  if (screen === "break")
    return <Break participant={participant} nextModule={nextModule} onResume={handleResumeFromBreak} />;

  if (screen === "waiting_results")
    return <WaitingResults participant={participant} onReveal={() => setScreen("ended")} />;

  if (screen === "practice")
    return <Practice onBack={() => setScreen(participant ? "lobby" : "welcome")} />;

  if (screen === "lobby")
    return <Lobby participant={participant} isDesktop={isDesktop} isPractice={!!quizSession?.is_practice} onStartQuiz={startQuiz} onPractice={() => setScreen("practice")} />;

  if (screen === "module_intro")
    return <ModuleIntro currentMod={currentMod} onStart={() => { setTimer(mod?.timePerQ || 60); setScreen("quiz"); }} />;

  if (screen === "quiz" && currentQ && mod)
    return <Quiz isDesktop={isDesktop} currentMod={currentMod} qIdx={qIdx} timer={timer} mod={mod} currentQ={currentQ} qs={qs} totalQuestions={activeQuestions} answered={answered} picked={picked} myPts={myPts} allAnswers={allAnswers} isPractice={!!quizSession?.is_practice} participantCode={participant?.code} sessionId={quizSession?.id} onPick={handlePick} />;

  if (screen === "ended")
    return <Ended participant={participant} myPts={myPts} allAnswers={allAnswers} isPractice={!!quizSession?.is_practice} onGoHome={resetApp} />;

  if (screen === "admin")
    return <AdminPanel admin={admin} isDesktop={isDesktop} onLogout={handleAdminLogout} />;

  if (screen === "podium")
    return <Podium onBack={() => setScreen("admin")} podStep={podStep} setPodStep={setPodStep} />;

  return null;
}
