import { useState, useEffect, useRef } from "react";
import { MODULES } from "./data/questions.js";
import { logoutAdmin, getOrCreateSession, saveAnswer, getSessionForCity } from "./lib/supabase.js";
import { calcPts, getModule, moduleQuestions } from "./lib/gameLogic.js";
import useWindowWidth from "./hooks/useWindowWidth.js";
import useAuth from "./hooks/useAuth.js";

import Welcome    from "./screens/Welcome.jsx";
import CodeEntry  from "./screens/CodeEntry.jsx";
import AdminLogin from "./screens/AdminLogin.jsx";
import Practice   from "./screens/Practice.jsx";
import Lobby      from "./screens/Lobby.jsx";
import ModuleIntro from "./screens/ModuleIntro.jsx";
import Quiz       from "./screens/Quiz.jsx";
import Feedback   from "./screens/Feedback.jsx";
import Ended      from "./screens/Ended.jsx";
import AdminPanel from "./screens/AdminPanel.jsx";
import Podium     from "./screens/Podium.jsx";

export default function App() {
  const [screen, setScreen] = useState("welcome");
  const { user: admin, loading } = useAuth(); // admin session via Supabase Auth

  // Participant (no auth — identified by code)
  const [participant, setParticipant] = useState(null); // { code, name, surname, city }

  // Quiz state
  const [quizSession, setQuizSession]   = useState(null);
  const [currentMod, setCurrentMod]     = useState(1);
  const [qIdx, setQIdx]                 = useState(0);
  const [timer, setTimer]               = useState(0);
  const [picked, setPicked]             = useState(null);
  const [answered, setAnswered]         = useState(false);
  const [myPts, setMyPts]               = useState(0);
  const [allAnswers, setAllAnswers]     = useState([]);
  const [podStep, setPodStep]           = useState(0);

  const timerRef = useRef(null);
  const isDesktop = useWindowWidth() >= 900;

  const qs       = moduleQuestions(currentMod);
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
  const handleTimeout = () => {
    if (answered) return;
    setAnswered(true);
    if (currentQ && participant && quizSession) {
      saveAnswer({ sessionId: quizSession.id, participantCode: participant.code, participantName: `${participant.name} ${participant.surname}`, city: participant.city, questionId: currentQ.id, module: currentMod, chosen: null, isCorrect: false, points: 0 });
    }
    setTimeout(advanceQuestion, 2500);
  };

  const handlePick = (i) => {
    if (answered) return;
    clearInterval(timerRef.current);
    setPicked(i);
    setAnswered(true);
    const correct = i === currentQ.ans;
    const pts = calcPts(timer, mod.timePerQ, correct);
    setMyPts((p) => p + pts);
    setAllAnswers((prev) => [...prev, { qId: currentQ.id, module: currentMod, picked: i, correct, pts }]);
    if (participant && quizSession) {
      saveAnswer({ sessionId: quizSession.id, participantCode: participant.code, participantName: `${participant.name} ${participant.surname}`, city: participant.city, questionId: currentQ.id, module: currentMod, chosen: i, isCorrect: correct, points: pts });
    }
    setTimeout(() => setScreen("feedback"), 500);
    setTimeout(advanceQuestion, 2800);
  };

  const advanceQuestion = () => {
    const nextIdx = qIdx + 1;
    if (nextIdx < qs.length) {
      setQIdx(nextIdx); setTimer(mod.timePerQ); setPicked(null); setAnswered(false); setScreen("quiz");
    } else {
      const nextMod = currentMod + 1;
      if (nextMod <= MODULES.length) {
        setCurrentMod(nextMod); setQIdx(0); setPicked(null); setAnswered(false);
        setTimer(getModule(nextMod).timePerQ); setScreen("module_intro");
      } else {
        setScreen("ended");
      }
    }
  };

  // Participant enters lobby after code validation
  const handleCodeSuccess = async (participantData) => {
    setParticipant(participantData);
    // Try to attach to existing session for this city
    const session = await getSessionForCity(participantData.city);
    if (session) setQuizSession(session);
    setScreen("lobby");
  };

  // Called when admin starts quiz (from Lobby via real-time or manually)
  const startQuiz = (session, questions) => {
    setQuizSession(session);
    setCurrentMod(1); setQIdx(0); setMyPts(0); setAllAnswers([]);
    setPicked(null); setAnswered(false); setTimer(MODULES[0].timePerQ);
    setScreen("module_intro");
  };

  const handleAdminLogout = async () => { await logoutAdmin(); setScreen("welcome"); };
  const resetApp = () => { setScreen("welcome"); setParticipant(null); setMyPts(0); setAllAnswers([]); setQuizSession(null); };

  // ── Loading ──────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#070215", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, fontFamily: '"Outfit",sans-serif', color: "#EDE9FE" }}>
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

  if (screen === "practice")
    return <Practice onBack={() => setScreen(participant ? "lobby" : "welcome")} />;

  if (screen === "lobby")
    return <Lobby participant={participant} isDesktop={isDesktop} onStartQuiz={startQuiz} onPractice={() => setScreen("practice")} />;

  if (screen === "module_intro")
    return <ModuleIntro currentMod={currentMod} onStart={() => { setTimer(mod?.timePerQ || 60); setScreen("quiz"); }} />;

  if (screen === "quiz" && currentQ && mod)
    return <Quiz isDesktop={isDesktop} currentMod={currentMod} qIdx={qIdx} timer={timer} mod={mod} currentQ={currentQ} qs={qs} answered={answered} picked={picked} myPts={myPts} allAnswers={allAnswers} onPick={handlePick} />;

  if (screen === "feedback" && currentQ && mod)
    return <Feedback currentQ={currentQ} picked={picked} timer={timer} mod={mod} />;

  if (screen === "ended")
    return <Ended participant={participant} myPts={myPts} allAnswers={allAnswers} onGoHome={resetApp} />;

  if (screen === "admin")
    return <AdminPanel admin={admin} isDesktop={isDesktop} onLogout={handleAdminLogout} />;

  if (screen === "podium")
    return <Podium onBack={() => setScreen("admin")} podStep={podStep} setPodStep={setPodStep} />;

  return null;
}
