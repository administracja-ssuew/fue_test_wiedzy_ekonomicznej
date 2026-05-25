import { useState, useEffect, useRef } from "react";
import { supabase, DEMO, logoutAdmin, saveAnswer, getSessionForCity, getSessionById, getCityBg, markCodeUsed, getQuestions, updateSession, advanceSessionQuestion } from "./lib/supabase.js";
import { calcPts, getModule } from "./lib/gameLogic.js";
import { useModules } from "./context/ModulesContext.jsx";
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
  const [podiumResults, setPodiumResults] = useState([]);

  // Auto-break only after module 2 (between mod 2 and 3)
  // After module 5 → waiting_results (admin reveals ranking manually)
  const BREAK_AFTER = [2];

  const MODULES        = useModules(); // dynamic from DB (or hardcoded fallback)
  const timerRef       = useRef(null);
  const pickTime       = useRef(null);
  const pickedRef      = useRef(null);  // always-current picked value (avoids stale closure in timer)
  const screenRef      = useRef(screen); // always-current screen value (avoids stale closures)
  const qStartedAtRef  = useRef(null);   // authoritative question start time (derived from DB)
  const modTimePerQRef = useRef(60);     // always-current timePerQ for active module
  const currentModRef  = useRef(currentMod); // always-current module (avoids stale closures in Realtime)
  const qIdxRef        = useRef(qIdx);       // always-current qIdx (avoids stale closures in Realtime)
  const isDesktop = useWindowWidth() >= 900;

  useEffect(() => { screenRef.current = screen; }, [screen]);
  useEffect(() => { currentModRef.current = currentMod; }, [currentMod]);
  useEffect(() => { qIdxRef.current = qIdx; }, [qIdx]);
  useEffect(() => { pickedRef.current = picked; }, [picked]);

  // Auto-restore admin session: redirect to panel when Supabase session is found on page load
  useEffect(() => {
    if (!loading && admin && screen === "welcome") setScreen("admin");
  }, [loading, admin]);

  // Restore participant from sessionStorage after page refresh (runs once, after auth resolves)
  useEffect(() => {
    if (loading || admin) return; // admin takes priority; wait for auth
    const saved = sessionStorage.getItem("fue_participant");
    if (!saved) return;
    // Restore bg immediately — before the async handleCodeSuccess fetch — to avoid flash of default bg
    const savedBg = sessionStorage.getItem("fue_bg");
    if (savedBg) document.documentElement.style.setProperty("--fue-bg", savedBg);
    try {
      const p = JSON.parse(saved);
      handleCodeSuccess(p);
    } catch (_) {
      sessionStorage.removeItem("fue_participant");
      sessionStorage.removeItem("fue_bg");
    }
  }, [loading]); // eslint-disable-line

  // Only DB questions — no hardcoded fallback
  const activeQuestions = cityQuestions;
  const qs       = activeQuestions.filter((q) => q.module === currentMod);
  const currentQ = qs[qIdx];
  const mod      = getModule(currentMod, MODULES);

  // ── Helpers — synchronizacja z globalnym indeksem pytania ────────
  const getQuestionState = (globalIdx, questions) => {
    const q = questions[globalIdx];
    if (!q) return null;
    const m = getModule(q.module, MODULES);
    if (!m) return null;
    const modQs = questions.filter((q2) => q2.module === q.module);
    const qIdxInMod = modQs.findIndex((q2) => q2.id === q.id);
    return { q, mod: m, modId: q.module, qIdx: Math.max(0, qIdxInMod) };
  };

  const syncToSession = (session, questions) => {
    if (!session?.q_started_at || !questions.length) return false;
    const globalIdx = Math.min(session.current_question_idx || 0, questions.length - 1);
    const state = getQuestionState(globalIdx, questions);
    if (!state) return false;
    const elapsed    = Math.floor((Date.now() - new Date(session.q_started_at).getTime()) / 1000);
    const remaining  = Math.max(1, state.mod.timePerQ - elapsed);
    qStartedAtRef.current  = session.q_started_at;
    modTimePerQRef.current = state.mod.timePerQ;
    clearInterval(timerRef.current);
    setCurrentMod(state.modId); setQIdx(state.qIdx);
    setTimer(remaining); setAnswered(false); setPicked(null);
    return true;
  };

  // ── Timer — derived from q_started_at so all clients stay in sync ──
  useEffect(() => {
    if (screen !== "quiz") { clearInterval(timerRef.current); return; }
    if (!mod) return;
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      const startedAt = qStartedAtRef.current;
      if (!startedAt) {
        // Fallback countdown (practice mode / no session)
        setTimer((t) => {
          if (t <= 1) { clearInterval(timerRef.current); handleTimeout(); return 0; }
          return t - 1;
        });
        return;
      }
      const elapsed    = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
      const remaining  = Math.max(0, modTimePerQRef.current - elapsed);
      setTimer(remaining);
      if (remaining <= 0) { clearInterval(timerRef.current); handleTimeout(); }
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [screen, currentMod, qIdx]);

  // ── Synchronizacja pytań przez Realtime (wszyscy na tym samym pytaniu) ──
  useEffect(() => {
    if (!quizSession?.id || !participant || !cityQuestions.length || DEMO || !supabase) return;

    const ch = supabase.channel(`q-sync-${quizSession.id}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "quiz_sessions",
        filter: `id=eq.${quizSession.id}`,
      }, ({ new: s }) => {
        if (s.status !== "running" || s.current_question_idx === undefined) return;
        // Use refs for currentMod and qIdx to avoid stale closure values
        // (this callback is registered once and must always read the latest state).
        const myGlobalIdx = cityQuestions.filter((q) => q.module < currentModRef.current).length + qIdxRef.current;
        if (s.current_question_idx > myGlobalIdx) {
          // Serwer jest do przodu — pełna synchronizacja (slow client / reconnect)
          const state = getQuestionState(s.current_question_idx, cityQuestions);
          if (state) {
            const elapsed = Math.floor((Date.now() - new Date(s.q_started_at).getTime()) / 1000);
            const remaining = Math.max(1, state.mod.timePerQ - elapsed);
            qStartedAtRef.current  = s.q_started_at;
            modTimePerQRef.current = state.mod.timePerQ;
            clearInterval(timerRef.current);
            setCurrentMod(state.modId); setQIdx(state.qIdx);
            setTimer(remaining); setAnswered(false); setPicked(null);
            setScreen("quiz");
          }
        } else if (s.current_question_idx === myGlobalIdx && !qStartedAtRef.current && s.q_started_at) {
          // Same question index but we lost the optimistic-lock race and have no local
          // q_started_at yet — adopt the winner's server-generated timestamp.
          const state = getQuestionState(myGlobalIdx, cityQuestions);
          if (state) {
            const elapsed = Math.floor((Date.now() - new Date(s.q_started_at).getTime()) / 1000);
            const remaining = Math.max(1, state.mod.timePerQ - elapsed);
            qStartedAtRef.current  = s.q_started_at;
            modTimePerQRef.current = state.mod.timePerQ;
            setTimer(remaining);
          }
        }
      })
      .subscribe();

    return () => supabase.removeChannel(ch);
  }, [quizSession?.id, participant?.code, cityQuestions.length]);

  // ── Session status sync — handles pause, force-end, and results reveal ──
  useEffect(() => {
    if (!quizSession?.id || !participant) return;

    const QUIZ_SCREENS = ["quiz", "module_intro", "admin_pause", "break", "waiting_results"];

    const isPracticeSession = !!quizSession?.is_practice;

    const handleSessionStatus = (status) => {
      const cur = screenRef.current;
      if (status === "paused" && ["quiz", "module_intro"].includes(cur)) {
        clearInterval(timerRef.current);
        setAnswered(true);
        setScreen("admin_pause");
      } else if (status === "running" && cur === "admin_pause") {
        // Admin resumed — clear stale q_started_at so timer doesn't immediately expire
        qStartedAtRef.current = null;
        setPicked(null); setAnswered(false);
        setTimer(modTimePerQRef.current || 60);
        setScreen("quiz");
      } else if (status === "ended" && QUIZ_SCREENS.includes(cur)) {
        clearInterval(timerRef.current);
        if (isPracticeSession) {
          // Practice ended — return to lobby to wait for real quiz
          setQuizSession(null);
          setCityQuestions([]);
          setScreen("lobby");
        } else {
          setScreen("ended");
        }
      } else if (status === "results" && QUIZ_SCREENS.includes(cur)) {
        clearInterval(timerRef.current);
        setScreen("ended");
      }
    };

    if (DEMO) {
      // DEMO: poll every 2s using session ID directly — avoids fetching wrong session
      const poll = setInterval(async () => {
        const s = await getSessionById(quizSession.id);
        if (s) handleSessionStatus(s.status);
      }, 2000);
      return () => clearInterval(poll);
    }

    // Production: Realtime + 3s poll fallback using session ID — always the right session
    const ch = supabase.channel(`session-sync-${quizSession.id}`)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "quiz_sessions",
        filter: `id=eq.${quizSession.id}`,
      }, ({ new: s }) => handleSessionStatus(s.status))
      .subscribe();
    const poll = setInterval(async () => {
      const s = await getSessionById(quizSession.id);
      if (s) handleSessionStatus(s.status);
    }, 3000);
    return () => { supabase.removeChannel(ch); clearInterval(poll); };
  }, [quizSession?.id, participant?.code]); // stable deps — uses screenRef internally

  // ── Quiz logic ───────────────────────────────────────────────────

  // Called when timer hits 0 — reveals correct answer to participant
  const handleTimeout = () => {
    clearInterval(timerRef.current);
    if (answered) return;
    // Use ref to avoid stale closure: picked state may have changed since this handler was captured
    const userPicked     = pickedRef.current;
    const timeWhenPicked = pickTime.current;

    const correct = userPicked !== null && userPicked === currentQ?.ans;
    const pts     = userPicked !== null ? calcPts(timeWhenPicked, mod.timePerQ, correct) : 0;

    setMyPts((p) => p + pts);
    setAllAnswers((prev) => currentQ
      ? [...prev, { qId: currentQ.id, module: currentMod, picked: userPicked, correct, pts }]
      : prev);

    // Only save to DB when user did NOT pick — handlePick already saved picked answers
    // (avoid overwriting the correct DB row with null/0 due to stale closure)
    if (userPicked === null && currentQ && participant && quizSession) {
      saveAnswer({ sessionId: quizSession.id, participantCode: participant.code, participantName: `${participant.name} ${participant.surname}`, city: participant.city, questionId: currentQ.id, module: currentMod, chosen: null, isCorrect: false, points: 0, responseTimeS: null });
    }

    setAnswered(true); // reveal correct/wrong colors — wait before advancing
    setTimeout(advanceQuestion, 5000);
  };

  // User clicks an answer — lock in choice but DON'T reveal yet (timer still runs)
  const handlePick = (i) => {
    if (picked !== null || answered) return; // already picked or revealed
    pickTime.current = timer;
    setPicked(i);

    // Save to DB immediately so admin sees live responses
    if (currentQ && participant && quizSession) {
      const correct       = i === currentQ.ans;
      const pts           = calcPts(timer, mod.timePerQ, correct);
      const responseTimeS = mod.timePerQ - timer; // seconds elapsed since question start
      saveAnswer({ sessionId: quizSession.id, participantCode: participant.code, participantName: `${participant.name} ${participant.surname}`, city: participant.city, questionId: currentQ.id, module: currentMod, chosen: i, isCorrect: correct, points: pts, responseTimeS });
    }
    // Timer keeps running — handleTimeout will reveal the answer
  };

  const advanceQuestion = async () => {
    const nextIdx = qIdx + 1;
    if (nextIdx < qs.length) {
      const nextGlobalIdx = activeQuestions.filter((q) => q.module < currentMod).length + nextIdx;
      const curGlobalIdx  = nextGlobalIdx - 1;
      modTimePerQRef.current = mod.timePerQ;

      if (quizSession && !DEMO) {
        // Race-safe: only one client wins; winner gets server-generated timestamp back.
        // Loser gets null and waits for Realtime event from the winner's DB write.
        const { startedAt } = await advanceSessionQuestion(quizSession.id, curGlobalIdx, nextGlobalIdx);
        if (startedAt) {
          qStartedAtRef.current = startedAt;
        } else {
          qStartedAtRef.current = null;
          // Safety-net: if Realtime hasn't corrected us in 1s, fetch directly from DB
          const capturedIdx  = nextGlobalIdx;
          const capturedCity = participant?.city;
          setTimeout(async () => {
            if (!qStartedAtRef.current && capturedCity) {
              const s = await getSessionForCity(capturedCity);
              if (s?.q_started_at && s.current_question_idx === capturedIdx) {
                qStartedAtRef.current = s.q_started_at;
              }
            }
          }, 1000);
        }
      } else if (DEMO && quizSession) {
        // DEMO mode: advanceSessionQuestion handles localStorage optimistic lock.
        const { startedAt } = await advanceSessionQuestion(quizSession.id, curGlobalIdx, nextGlobalIdx);
        qStartedAtRef.current = startedAt || new Date().toISOString();
      } else {
        // No session (solo practice without session) — local timestamp is fine.
        qStartedAtRef.current = new Date().toISOString();
      }

      setQIdx(nextIdx); setTimer(mod.timePerQ); setPicked(null); setAnswered(false); setScreen("quiz");
    } else {
      const nextMod = currentMod + 1;
      if (BREAK_AFTER.includes(currentMod)) {
        // Automatyczna przerwa po module 2
        const afterBreakModule = nextMod <= MODULES.length ? nextMod : null;
        setNextModule(afterBreakModule);
        setPicked(null); setAnswered(false);
        setScreen("break");
        // BUG 3 FIX: NIE zapisuj status:"paused" do bazy — to robiło by każdy uczestnik
        // osobno, triggerując admin-pause Realtime subscription u innych uczestników.
        // Status sesji kontroluje wyłącznie admin (przycisk Pauza w AdminPanel).
      } else if (nextMod <= MODULES.length) {
        setCurrentMod(nextMod); setQIdx(0); setPicked(null); setAnswered(false);
        setTimer(getModule(nextMod, MODULES).timePerQ); setScreen("module_intro");
      } else {
        // Wszystkie moduły skończone → czekaj na ogłoszenie wyników przez admina
        setScreen("waiting_results");
        // BUG 3 FIX: NIE zapisuj status:"paused" do bazy — patrz komentarz wyżej.
      }
    }
  };

  // Wznowienie po przerwie (admin zmienił status na "running")
  const handleResumeFromBreak = () => {
    if (nextModule && nextModule <= MODULES.length) {
      setCurrentMod(nextModule); setQIdx(0); setPicked(null); setAnswered(false);
      setTimer(getModule(nextModule, MODULES).timePerQ); setScreen("module_intro");
    } else {
      setScreen("ended"); // moduł 5 = ogłoszenie wyników
    }
  };

  // Participant validates code → enters lobby
  const handleCodeSuccess = async (participantData) => {
    sessionStorage.setItem("fue_participant", JSON.stringify(participantData));
    setParticipant(participantData);
    const session = await getSessionForCity(participantData.city);
    if (session) {
      setQuizSession(session);
      await markCodeUsed(participantData.code, session.id);
    }
    // Apply city-specific background and cache it for refresh
    const bg = session?.bg || await getCityBg(participantData.city);
    if (bg) {
      document.documentElement.style.setProperty("--fue-bg", bg);
      sessionStorage.setItem("fue_bg", bg);
    }
    setScreen("lobby");
  };

  // Called by Lobby when session goes "running" (first join or reconnect)
  const startQuiz = async (session) => {
    setQuizSession(session);

    // Re-mark code as used in case the participant joined before a session existed
    if (participant?.code && session?.id) {
      markCodeUsed(participant.code, session.id);
    }

    // Apply bg when quiz starts (catches case where session had no bg when lobby was entered)
    const bg = session?.bg || await getCityBg(session?.city);
    if (bg) {
      document.documentElement.style.setProperty("--fue-bg", bg);
      sessionStorage.setItem("fue_bg", bg);
    }

    const dbQs = session?.city ? await getQuestions(session.city) : [];

    // Brak pytań — pokaż komunikat zamiast pustego ekranu
    if (dbQs.length === 0) {
      setScreen("no_questions");
      return;
    }

    setCityQuestions(dbQs);
    setMyPts(0); setAllAnswers([]);

    // Admin ustawił q_started_at → idź od razu do pytania (bez kliku uczestnika)
    if (session?.q_started_at && syncToSession(session, dbQs)) {
      setScreen("quiz");
      return;
    }

    // Fallback — sesja bez q_started_at (edge case: admin nie kliknął start)
    setCurrentMod(1); setQIdx(0);
    setPicked(null); setAnswered(false); setTimer(MODULES[0]?.timePerQ ?? 60);
    setScreen("module_intro");
  };

  const handleAdminLogout = async () => { await logoutAdmin(); setScreen("welcome"); };
  const resetApp = () => {
    sessionStorage.removeItem("fue_participant");
    sessionStorage.removeItem("fue_bg");
    document.documentElement.style.removeProperty("--fue-bg");
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

  // Admin manually paused mid-quiz — participant waits
  if (screen === "admin_pause")
    return <Break participant={participant} nextModule={currentMod} isAdminPause sessionId={quizSession?.id} onResume={() => {
      // Clear stale q_started_at so the timer restarts from full duration instead of immediately expiring
      qStartedAtRef.current = null;
      setPicked(null); setAnswered(false); setTimer(modTimePerQRef.current || 60); setScreen("quiz");
    }} />;

  if (screen === "waiting_results")
    return <WaitingResults participant={participant} onReveal={() => setScreen("ended")} />;

  if (screen === "practice")
    return <Practice city={participant?.city} onBack={() => setScreen(participant ? "lobby" : "welcome")} />;

  if (screen === "no_questions") return (
    <div style={{ minHeight: "100vh", background: "var(--fue-bg)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: '"Space Grotesk",sans-serif', color: "#EDE9FE", textAlign: "center", padding: 32 }}>
      <div>
        <div style={{ fontSize: 52, marginBottom: 16 }}>⚠️</div>
        <h2 style={{ fontFamily: '"Bebas Neue"', fontSize: 36, letterSpacing: 1, color: "#F5C518", marginBottom: 12 }}>Brak pytań</h2>
        <p style={{ color: "#9B89CC", fontSize: 15, lineHeight: 1.7, maxWidth: 360, margin: "0 auto 28px" }}>
          Administrator nie wgrał jeszcze pytań dla Twojego miasta ({participant?.city}).<br />
          Skontaktuj się z organizatorem.
        </p>
        <button onClick={() => setScreen("lobby")} style={{ background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 12, padding: "12px 28px", color: "#C4B5FD", cursor: "pointer", fontFamily: '"Space Grotesk"', fontSize: 14 }}>
          ← Wróć do poczekalni
        </button>
      </div>
    </div>
  );

  if (screen === "lobby")
    return <Lobby participant={participant} isDesktop={isDesktop} isPractice={!!quizSession?.is_practice} onStartQuiz={startQuiz} onPractice={() => setScreen("practice")} />;

  if (screen === "module_intro")
    return <ModuleIntro currentMod={currentMod} onStart={async () => {
      const timePerQ  = mod?.timePerQ || 60;
      modTimePerQRef.current = timePerQ;
      setTimer(timePerQ);
      setScreen("quiz");
      if (quizSession) {
        const globalIdx = activeQuestions.filter((q) => q.module < currentMod).length + qIdx;
        // prevGlobalIdx is the last question of the previous module (or -1 for module 1 start).
        // We use globalIdx as both expected and next so the optimistic lock key is globalIdx itself;
        // we pass globalIdx - 1 as expected so any client at idx-1 can advance to globalIdx.
        // For module 1, the admin wrote q_started_at via "Start quizu" — no race here.
        // For subsequent modules, previous question was globalIdx-1.
        const { startedAt } = await advanceSessionQuestion(quizSession.id, globalIdx - 1, globalIdx);
        qStartedAtRef.current = startedAt || null;
        if (!startedAt) {
          const capturedCity = participant?.city;
          setTimeout(async () => {
            if (!qStartedAtRef.current && capturedCity) {
              const s = await getSessionForCity(capturedCity);
              if (s?.q_started_at && s.current_question_idx === globalIdx) qStartedAtRef.current = s.q_started_at;
            }
          }, 1000);
        }
      } else {
        // No session (practice / demo fallback)
        qStartedAtRef.current = new Date().toISOString();
      }
    }} />;

  if (screen === "quiz" && currentQ && mod)
    return <Quiz isDesktop={isDesktop} currentMod={currentMod} qIdx={qIdx} timer={timer} mod={mod} currentQ={currentQ} qs={qs} totalQuestions={activeQuestions} answered={answered} picked={picked} myPts={myPts} allAnswers={allAnswers} isPractice={!!quizSession?.is_practice} participantCode={participant?.code} sessionId={quizSession?.id} onPick={handlePick} />;

  if (screen === "ended")
    return <Ended participant={participant} myPts={myPts} allAnswers={allAnswers} isPractice={!!quizSession?.is_practice} onGoHome={resetApp} />;

  if (screen === "admin")
    return <AdminPanel admin={admin} isDesktop={isDesktop} onLogout={handleAdminLogout} onPodium={(results) => { setPodiumResults(results); setPodStep(0); setScreen("podium"); }} />;

  if (screen === "podium")
    return <Podium onBack={() => setScreen("admin")} podStep={podStep} setPodStep={setPodStep} results={podiumResults} />;

  return null;
}
