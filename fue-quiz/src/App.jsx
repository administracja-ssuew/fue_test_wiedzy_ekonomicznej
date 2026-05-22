import { useState, useEffect, useRef } from "react";
import { MODULES, QUESTIONS } from "./data/questions.js";
import { logoutUser, createSession, saveAttempt } from "./lib/supabase.js";
import { calcPts, getModule, moduleQuestions } from "./lib/gameLogic.js";
import useWindowWidth from "./hooks/useWindowWidth.js";
import useAuth from "./hooks/useAuth.js";

import Welcome from "./screens/Welcome.jsx";
import Register from "./screens/Register.jsx";
import Login from "./screens/Login.jsx";
import AdminLogin from "./screens/AdminLogin.jsx";
import Pending from "./screens/Pending.jsx";
import Practice from "./screens/Practice.jsx";
import Lobby from "./screens/Lobby.jsx";
import ModuleIntro from "./screens/ModuleIntro.jsx";
import Quiz from "./screens/Quiz.jsx";
import Feedback from "./screens/Feedback.jsx";
import Ended from "./screens/Ended.jsx";
import AdminPanel from "./screens/AdminPanel.jsx";
import Podium from "./screens/Podium.jsx";

export default function App() {
  const [screen, setScreen] = useState("welcome");
  const { user, loading } = useAuth();

  const [quizSession, setQuizSession] = useState(null);
  const [currentMod, setCurrentMod] = useState(1);
  const [qIdx, setQIdx] = useState(0);
  const [timer, setTimer] = useState(0);
  const [picked, setPicked] = useState(null);
  const [answered, setAnswered] = useState(false);
  const [myPts, setMyPts] = useState(0);
  const [allAnswers, setAllAnswers] = useState([]);
  const [podStep, setPodStep] = useState(0);

  const timerRef = useRef(null);
  const uid = useRef("demo_" + Math.random().toString(36).slice(2, 8));
  const isDesktop = useWindowWidth() >= 900;

  const qs = moduleQuestions(currentMod);
  const currentQ = qs[qIdx];
  const mod = getModule(currentMod);

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

  const handleTimeout = () => {
    if (answered) return;
    setAnswered(true);
    setAllAnswers((prev) => currentQ ? [...prev, { qId: currentQ.id, module: currentMod, picked: null, correct: false, pts: 0 }] : prev);
    setTimeout(advanceQuestion, 2500);
  };

  const handlePick = (i) => {
    if (answered) return;
    clearInterval(timerRef.current);
    setPicked(i);
    setAnswered(true);
    const correct = i === currentQ.ans;
    const pts = calcPts(timer, mod.timePerQ, correct);
    const newTotal = myPts + pts;
    setMyPts(newTotal);
    setAllAnswers((prev) => [...prev, { qId: currentQ.id, module: currentMod, picked: i, correct, pts }]);
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
        finishQuiz();
      }
    }
  };

  const finishQuiz = async () => {
    if (quizSession) await saveAttempt({ sessionId: quizSession.id, userId: user?.id || uid.current, answers: allAnswers, totalScore: myPts, completed: true });
    setScreen("ended");
  };

  const startQuiz = async () => {
    const session = await createSession({ stage: "regional", city: user?.city || null, createdBy: user?.id || uid.current });
    if (session.data) setQuizSession(session.data);
    setCurrentMod(1); setQIdx(0); setMyPts(0); setAllAnswers([]);
    setPicked(null); setAnswered(false); setTimer(MODULES[0].timePerQ);
    setScreen("module_intro");
    return session.data;
  };

  const handleLogout = async () => { await logoutUser(); setScreen("welcome"); };
  const resetApp = () => { setScreen("welcome"); setMyPts(0); setAllAnswers([]); };

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#070215", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, fontFamily: '"Outfit",sans-serif', color: "#EDE9FE" }}>
      <div className="spinner" style={{ width: 40, height: 40, border: "3px solid rgba(107,33,232,.3)", borderTop: "3px solid #6B21E8", borderRadius: "50%" }} />
      <p style={{ color: "#9B89CC", fontSize: 14 }}>Ładowanie…</p>
    </div>
  );

  if (screen === "welcome")      return <Welcome isDesktop={isDesktop} onRegister={() => setScreen("register")} onLogin={() => setScreen("login")} onAdminLogin={() => setScreen("admin_login")} />;
  if (screen === "register")     return <Register onBack={() => setScreen("welcome")} onSuccess={() => setScreen("pending")} />;
  if (screen === "login")        return <Login onBack={() => setScreen("welcome")} onSuccess={(u) => { setScreen(u.verified ? (u.role === "participant" ? "lobby" : "admin") : "pending"); }} />;
  if (screen === "admin_login")  return <AdminLogin onBack={() => setScreen("welcome")} onSuccess={(u) => { setScreen("admin"); }} />;
  if (screen === "pending")      return <Pending onGoHome={() => setScreen("welcome")} onPractice={() => setScreen("practice")} />;
  if (screen === "practice")     return <Practice onBack={() => setScreen(user?.verified ? "lobby" : "pending")} />;
  if (screen === "lobby")        return <Lobby user={user} isDesktop={isDesktop} onLogout={handleLogout} onStartQuiz={startQuiz} onPractice={() => setScreen("practice")} />;
  if (screen === "module_intro") return <ModuleIntro currentMod={currentMod} onStart={() => { setTimer(mod.timePerQ); setScreen("quiz"); }} />;
  if (screen === "quiz" && currentQ && mod) return <Quiz user={user} isDesktop={isDesktop} currentMod={currentMod} qIdx={qIdx} timer={timer} mod={mod} currentQ={currentQ} qs={qs} answered={answered} picked={picked} myPts={myPts} allAnswers={allAnswers} onPick={handlePick} />;
  if (screen === "feedback" && currentQ && mod) return <Feedback currentQ={currentQ} picked={picked} timer={timer} mod={mod} />;
  if (screen === "ended")        return <Ended user={user} myPts={myPts} allAnswers={allAnswers} onGoHome={resetApp} />;
  if (screen === "admin")        return <AdminPanel user={user} isDesktop={isDesktop} onLogout={handleLogout} onStartQuiz={startQuiz} />;
  if (screen === "podium")       return <Podium onBack={() => setScreen("admin")} podStep={podStep} setPodStep={setPodStep} />;

  return null;
}
