import { useState, useEffect, useRef, useMemo, lazy } from "react";
import { supabase, DEMO, logoutAdmin, submitAnswer, getSessionForCity, getSessionById, getCityBg, markCodeUsed, getQuestions, updateSession, advanceSessionQuestion, getParticipantAnswers } from "./lib/supabase.js";
import { getModule, REVEAL_SECONDS, MODULE_INTRO_SECONDS, remainingSeconds } from "./lib/gameLogic.js";
import { serverNow, startServerClock } from "./lib/serverClock.js";
import { useModules } from "./context/ModulesContext.jsx";
import useWindowWidth from "./hooks/useWindowWidth.js";
import useAuth from "./hooks/useAuth.js";

import Welcome        from "./screens/Welcome.jsx";
import Break          from "./screens/Break.jsx";
import WaitingResults from "./screens/WaitingResults.jsx";
import CodeEntry   from "./screens/CodeEntry.jsx";
import AdminLogin  from "./screens/AdminLogin.jsx";
import Lobby       from "./screens/Lobby.jsx";
import ModuleIntro from "./screens/ModuleIntro.jsx";
import Quiz        from "./screens/Quiz.jsx";
import Ended       from "./screens/Ended.jsx";
import Countdown   from "./screens/Countdown.jsx";

// Code-splitting: ekrany spoza ścieżki uczestnika ładowane leniwie → mniejszy bundle
// początkowy i krótszy Total Blocking Time na telefonie. (Suspense jest w main.jsx.)
const AdminPanel = lazy(() => import("./screens/AdminPanel.jsx"));
const Practice   = lazy(() => import("./screens/Practice.jsx"));
const Podium     = lazy(() => import("./screens/Podium.jsx"));
const LiveView   = lazy(() => import("./screens/LiveView.jsx"));
import ModuleIntroFS from "./screens/ModuleIntroFS.jsx";

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
  const [countdownNum, setCountdownNum] = useState(null); // 3/2/1/0="START!"/null=hidden
  const [revealAns, setRevealAns]       = useState({});   // qId → poprawny indeks (z serwera, do reveal)

  // Auto-break after module 2 and after module 4 (przerwy między blokami).
  // After module 5 → waiting_results (admin reveals ranking manually)
  const BREAK_AFTER = [2, 4];

  const MODULES        = useModules(); // dynamic from DB (or hardcoded fallback)
  const timerRef       = useRef(null);
  const pickTime       = useRef(null);
  const pickedRef      = useRef(null);  // always-current picked value (avoids stale closure in timer)
  const screenRef      = useRef(screen); // always-current screen value (avoids stale closures)
  const qStartedAtRef  = useRef(null);   // authoritative question start time (derived from DB)
  const modTimePerQRef = useRef(60);     // always-current timePerQ for active module
  const currentModRef      = useRef(currentMod); // always-current module (avoids stale closures in Realtime)
  const qIdxRef            = useRef(qIdx);       // always-current qIdx (avoids stale closures in Realtime)
  const cityQuestionsRef   = useRef([]);          // always-current questions for session event handler
  const quizChRef          = useRef(null);        // kanał broadcast sesji (instant push przejścia pytania)
  const isDesktop = useWindowWidth() >= 900;

  // Natychmiastowy push nowego stanu sesji na szybkiej ścieżce (broadcast ~50ms),
  // gdy to UCZESTNIK przesuwa pytanie. Bez tego Live View i pozostali uczestnicy
  // czekali na wolny postgres_changes (~0.6s)/polling → reveal „wisiał" dłużej.
  const broadcastSession = (overrides) => {
    if (DEMO || !supabase || !quizChRef.current || !quizSession?.id) return;
    const payload = { ...quizSession, id: quizSession.id, city: participant?.city, status: "running", ...overrides };
    quizChRef.current.send({ type: "broadcast", event: "quiz_event", payload });
  };

  // #5 — wypchnij stan podium na Live View (projektor). Anon nie ma dostępu do
  // wyników, więc admin rozgłasza ranking + krok odsłaniania na kanale miasta.
  const podiumChRef = useRef(null);
  const podStepRef  = useRef(podStep);
  useEffect(() => { podStepRef.current = podStep; }, [podStep]);
  useEffect(() => {
    const city = podiumResults[0]?.city;
    if (screen !== "podium" || DEMO || !supabase || !city) return;
    const ch = supabase.channel(`podium-${encodeURIComponent(city)}`); // ASCII — polskie znaki psują broadcast
    const send = () => ch.send({ type: "broadcast", event: "podium", payload: { results: podiumResults, podStep: podStepRef.current } });
    ch.subscribe((s) => { if (s === "SUBSCRIBED") { podiumChRef.current = ch; send(); } });
    // Re-broadcast co 2 s — projektor, który podłączy się później, też dostanie stan.
    const iv = setInterval(() => { if (podiumChRef.current) send(); }, 2000);
    return () => { podiumChRef.current = null; clearInterval(iv); supabase.removeChannel(ch); };
  }, [screen, podiumResults]); // eslint-disable-line
  useEffect(() => {
    if (screen === "podium" && podiumChRef.current)
      podiumChRef.current.send({ type: "broadcast", event: "podium", payload: { results: podiumResults, podStep } });
  }, [podStep]); // eslint-disable-line

  // Standalone live view — opened via ?live=1&city=X
  const liveParams = useMemo(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get("live") === "1" ? { city: p.get("city") || "" } : null;
  }, []);

  // Zegar serwera — zmierz offset raz na starcie i odświeżaj okresowo, by wszystkie
  // ekrany liczyły timery z tego samego "teraz" (sync co do sekundy).
  useEffect(() => startServerClock(), []);

  useEffect(() => { screenRef.current = screen; }, [screen]);
  useEffect(() => { currentModRef.current = currentMod; }, [currentMod]);
  useEffect(() => { qIdxRef.current = qIdx; }, [qIdx]);
  useEffect(() => { pickedRef.current = picked; }, [picked]);
  useEffect(() => { cityQuestionsRef.current = cityQuestions; }, [cityQuestions]);

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
    const elapsed    = Math.max(0, Math.floor((serverNow() - new Date(session.q_started_at).getTime()) / 1000));
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
      // Same canonical formula AND same clock (serverNow) as the spectator projection
      // → identyczna sekunda na każdym ekranie, niezależnie od zegara urządzenia.
      // Tick 250 ms (jak Live View), by przeskok sekundy następował w tej samej chwili.
      const remaining  = remainingSeconds(modTimePerQRef.current, new Date(startedAt).getTime(), serverNow());
      setTimer(remaining);
      if (remaining <= 0) { clearInterval(timerRef.current); handleTimeout(); }
    }, 250);
    return () => clearInterval(timerRef.current);
  }, [screen, currentMod, qIdx]);

  // ── Pre-question countdown (3→2→1→START), synced via q_started_at ──
  // Whenever the active question's start is still in the future (set by
  // advance_session_question / start_quiz_session a few seconds ahead), show the
  // fullscreen countdown instead of the question. Driven by the same server
  // timestamp as LiveView/admin, so the animation is time-synced on every screen.
  // Answering is naturally blocked because <Quiz> isn't rendered meanwhile.
  useEffect(() => {
    if (screen !== "quiz") return;
    const tick = () => {
      const startedAt = qStartedAtRef.current ? new Date(qStartedAtRef.current).getTime() : null;
      const now = serverNow();
      if (startedAt && startedAt > now) {
        setCountdownNum(Math.max(0, Math.ceil((startedAt - now) / 1000) - 1));
      } else {
        setCountdownNum((n) => (n === null ? n : null));
      }
    };
    tick();
    const iv = setInterval(tick, 200);
    return () => clearInterval(iv);
  }, [screen, currentMod, qIdx]);

  // ── Pojedynczy kanał Realtime + poll dla wszystkich zdarzeń sesji ──
  // Łączy q-sync i session-sync w jedną subskrypcję, eliminując problem
  // deduplikacji Supabase gdy dwa kanały mają identyczny filtr event:table:id.
  // cityQuestionsRef zawsze ma aktualne pytania bez dodawania ich jako dep.
  useEffect(() => {
    if (!quizSession?.id || !participant) return;

    const QUIZ_SCREENS = ["quiz", "module_intro", "admin_pause", "break", "waiting_results"];
    const isPracticeSession = !!quizSession?.is_practice;

    const handleUpdate = (s) => {
      const cur = screenRef.current;

      // Status changes take priority over question sync
      if (s.status === "paused" && ["quiz", "module_intro"].includes(cur)) {
        clearInterval(timerRef.current); setAnswered(true); setScreen("admin_pause"); return;
      }
      if (s.status === "running" && cur === "admin_pause") {
        if (s.q_started_at) {
          qStartedAtRef.current = s.q_started_at;
          const elapsed = Math.max(0, Math.floor((serverNow() - new Date(s.q_started_at).getTime()) / 1000));
          setTimer(Math.max(1, modTimePerQRef.current - elapsed));
        } else {
          qStartedAtRef.current = null;
          setTimer(modTimePerQRef.current || 60);
        }
        setPicked(null); setAnswered(false); setScreen("quiz"); return;
      }
      if (s.status === "ended" && QUIZ_SCREENS.includes(cur)) {
        clearInterval(timerRef.current);
        if (isPracticeSession) { setQuizSession(null); setCityQuestions([]); setScreen("lobby"); }
        else { setScreen("ended"); }
        return;
      }
      if (s.status === "results" && QUIZ_SCREENS.includes(cur)) {
        clearInterval(timerRef.current); setScreen("ended"); return;
      }

      // Question advancement — only when session is running
      if (s.status !== "running" || s.current_question_idx === undefined) return;
      const questions = cityQuestionsRef.current;
      if (!questions.length) return;
      const myGlobalIdx = questions.filter((q) => q.module < currentModRef.current).length + qIdxRef.current;

      // Admin "repeat question": same index but a NEW, fresh q_started_at → reset the
      // timer and answer state on the current question. Distinguishable from a normal
      // advance (index changes) and from resume (back-dated timestamp; handled above on
      // the admin_pause screen). "Fresh" = started ≤2s ago, so resume never matches here.
      if (cur === "quiz" && s.current_question_idx === myGlobalIdx && s.q_started_at &&
          qStartedAtRef.current && s.q_started_at !== qStartedAtRef.current) {
        const elapsed = Math.max(0, Math.floor((serverNow() - new Date(s.q_started_at).getTime()) / 1000));
        if (elapsed <= 2) {
          qStartedAtRef.current = s.q_started_at;
          setTimer(modTimePerQRef.current || 60);
          setPicked(null); setAnswered(false);
          return;
        }
        // Admin "Następne pytanie": q_started_at back-dated past the full time → end
        // the question NOW. Next timer tick computes remaining=0 → handleTimeout →
        // reveal → normal auto-advance. Synced with LiveView/admin (same timestamp).
        if (elapsed >= (modTimePerQRef.current || 60)) {
          qStartedAtRef.current = s.q_started_at;
          return;
        }
      }

      if (s.current_question_idx > myGlobalIdx) {
        const state = getQuestionState(s.current_question_idx, questions);
        if (state) {
          const elapsed = Math.max(0, Math.floor((serverNow() - new Date(s.q_started_at).getTime()) / 1000));
          const remaining = Math.max(1, state.mod.timePerQ - elapsed);
          qStartedAtRef.current = s.q_started_at; modTimePerQRef.current = state.mod.timePerQ;
          // Do NOT clearInterval here — the timer effect handles its own lifecycle when
          // currentMod/qIdx change. Calling clearInterval without a guaranteed re-run
          // of the effect (when state values happen to be the same) kills the timer permanently.
          setCurrentMod(state.modId); setQIdx(state.qIdx);
          setTimer(remaining); setAnswered(false); setPicked(null); setScreen("quiz");
        }
      } else if (s.current_question_idx === myGlobalIdx && !qStartedAtRef.current && s.q_started_at) {
        const state = getQuestionState(myGlobalIdx, questions);
        if (state) {
          const elapsed = Math.max(0, Math.floor((serverNow() - new Date(s.q_started_at).getTime()) / 1000));
          const remaining = Math.max(1, state.mod.timePerQ - elapsed);
          qStartedAtRef.current = s.q_started_at; modTimePerQRef.current = state.mod.timePerQ;
          setTimer(remaining);
        }
      }
    };

    if (DEMO) {
      const poll = setInterval(async () => {
        const s = await getSessionById(quizSession.id);
        if (s) handleUpdate(s);
      }, 2000);
      return () => clearInterval(poll);
    }

    const ch = supabase.channel(`quiz-${quizSession.id}`)
      .on("broadcast", { event: "quiz_event" }, ({ payload }) => {
        // Admin broadcast: payload now contains the full merged session — no extra DB fetch needed.
        // Fallback: fetch from DB if payload looks incomplete (old client compatibility).
        if (!payload?.status) return;
        if (payload.id) { handleUpdate(payload); }
        else { getSessionById(quizSession.id).then((s) => { if (s) handleUpdate(s); }); }
      })
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "quiz_sessions",
        filter: `id=eq.${quizSession.id}`,
      }, ({ new: s }) => handleUpdate(s))
      .subscribe();
    quizChRef.current = ch;
    const poll = setInterval(async () => {
      const s = await getSessionById(quizSession.id);
      if (s) handleUpdate(s);
    }, 10000); // pure safety-net — broadcast + Realtime are the fast path. Longer
               // interval keeps DB load low at 500 concurrent participants.
    return () => { supabase.removeChannel(ch); quizChRef.current = null; clearInterval(poll); };
  }, [quizSession?.id, participant?.code]);

  // ── Quiz logic ───────────────────────────────────────────────────

  // Zapis odpowiedzi z walidacją SERWEROWĄ (submit_answer liczy is_correct z ans).
  // Jedno źródło: lokalna tablica wyników + poprawna odpowiedź do reveal — z wyniku
  // serwera (a nie z currentQ.ans, którego anon już nie dostaje). Dedupe po qId.
  const recordAnswer = async (chosen) => {
    const q = currentQ;
    if (!q || !participant || !quizSession) return;
    // clientCorrect tylko jako fallback, gdy sekcja 29 nie wgrana (ans wtedy obecne).
    const clientCorrect = q.ans != null ? (chosen !== null && chosen === q.ans) : null;
    const responseTimeS = chosen !== null ? (mod.timePerQ - pickTime.current) : null;
    const r = await submitAnswer({
      sessionId: quizSession.id, participantCode: participant.code,
      participantName: `${participant.name} ${participant.surname}`, city: participant.city,
      questionId: q.id, module: currentMod, chosen, clientCorrect, responseTimeS,
    });
    const ca = r.correctAns ?? (q.ans ?? null);
    if (ca != null) setRevealAns((m) => ({ ...m, [q.id]: ca }));
    setAllAnswers((prev) => prev.some((a) => a.qId === q.id)
      ? prev
      : [...prev, { qId: q.id, module: currentMod, picked: chosen, correct: !!r.isCorrect, pts: 0 }]);
  };

  // Called when timer hits 0 — reveals correct answer to participant
  const handleTimeout = () => {
    clearInterval(timerRef.current);
    if (answered) return;
    // Brak wyboru → zapisz pustą odpowiedź (serwer policzy is_correct=false) i pobierz
    // poprawną odp. do reveal. Wybrane odpowiedzi zapisał już handlePick (recordAnswer).
    if (pickedRef.current === null) recordAnswer(null);
    setAnswered(true); // reveal correct/wrong colors — wait before advancing
    setTimeout(advanceQuestion, REVEAL_SECONDS * 1000);
  };

  // User clicks an answer — lock in choice but DON'T reveal yet (timer still runs)
  const handlePick = (i) => {
    if (picked !== null || answered) return; // already picked or revealed
    pickTime.current = timer;
    setPicked(i);
    recordAnswer(i); // zapis serwerowy + poprawna odp. do reveal (odpowiedź ostateczna)
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
          // Wygrany advance → natychmiast rozgłoś nowy stan (Live View + reszta uczestników
          // dostają w ~50ms zamiast czekać na postgres_changes), żeby reveal kończył się równo.
          broadcastSession({ current_question_idx: nextGlobalIdx, q_started_at: startedAt });
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

      // Show the pre-question countdown immediately if the next start is in the future
      // (winner gets the server timestamp; losers pick it up via the countdown effect
      // once Realtime delivers it). Avoids a 1-frame flash of the question.
      const startedMs = qStartedAtRef.current ? new Date(qStartedAtRef.current).getTime() : null;
      setCountdownNum(startedMs && startedMs > serverNow() ? Math.max(0, Math.ceil((startedMs - serverNow()) / 1000) - 1) : null);

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
    // Apply city-specific background (mobile vs desktop variant) and cache for refresh
    const bgRaw = session ? { bg: session.bg, bgMobile: session.bg_mobile } : await getCityBg(participantData.city);
    const bg = isDesktop ? (bgRaw.bg || bgRaw.bgMobile) : (bgRaw.bgMobile || bgRaw.bg);
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

    // Apply bg when quiz starts — re-check in case bg was set after lobby was entered
    const bgRaw2 = session ? { bg: session.bg, bgMobile: session.bg_mobile } : await getCityBg(session?.city);
    const bg2 = isDesktop ? (bgRaw2.bg || bgRaw2.bgMobile) : (bgRaw2.bgMobile || bgRaw2.bg);
    if (bg2) {
      document.documentElement.style.setProperty("--fue-bg", bg2);
      sessionStorage.setItem("fue_bg", bg2);
    }

    const dbQs = session?.city ? await getQuestions(session.city) : [];

    // Brak pytań — pokaż komunikat zamiast pustego ekranu
    if (dbQs.length === 0) {
      setScreen("no_questions");
      return;
    }

    setCityQuestions(dbQs);

    // Rebuild local score from DB so a refresh mid-quiz doesn't reset the displayed
    // total (answers are persisted server-side). A genuinely fresh start returns [] → 0.
    const priorAnswers = session?.id && participant?.code
      ? await getParticipantAnswers(session.id, participant.code)
      : [];
    setAllAnswers(priorAnswers);
    setMyPts(priorAnswers.reduce((sum, a) => sum + (a.pts || 0), 0));

    // Ustal moduł/pytanie z sesji ZANIM pokażemy ekran odliczania — dzięki temu
    // zapowiedź modułu (qIdx===0) pokazuje właściwy moduł, także przy reconnekcie
    // w trakcie późniejszego modułu (a nie zawsze "Moduł 1").
    const synced = !!(session?.q_started_at && syncToSession(session, dbQs));

    // Ekran odliczania, gdy q_started_at jest w przyszłości. Start modułu ma lead
    // 30 s (ekran zapowiedzi modułu); zwykłe pytanie 4 s (3-2-1). Reconnect/refresh
    // ma q_started_at w przeszłości → od razu pytanie.
    const qStartedAtMs = session?.q_started_at ? new Date(session.q_started_at).getTime() : null;
    if (qStartedAtMs && qStartedAtMs > serverNow()) {
      setScreen("countdown");
      await new Promise((resolve) => {
        const tick = () => {
          const msLeft = qStartedAtMs - serverNow();
          if (msLeft > 0) setCountdownNum(Math.max(0, Math.ceil(msLeft / 1000) - 1));
        };
        tick();
        const iv = setInterval(() => {
          const msLeft = qStartedAtMs - serverNow();
          if (msLeft <= 0) { clearInterval(iv); setCountdownNum(null); resolve(); }
          else tick();
        }, 100);
      });
    }

    if (synced) { setScreen("quiz"); return; }

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

  // ── Standalone live view ─────────────────────────────────────────
  if (liveParams) return <LiveView city={liveParams.city} />;

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
    return <Break participant={participant} nextModule={currentMod} isAdminPause sessionId={quizSession?.id} onResume={(s) => {
      if (s?.q_started_at) {
        qStartedAtRef.current = s.q_started_at;
        const elapsed = Math.max(0, Math.floor((serverNow() - new Date(s.q_started_at).getTime()) / 1000));
        setTimer(Math.max(1, modTimePerQRef.current - elapsed));
      } else {
        qStartedAtRef.current = null;
        setTimer(modTimePerQRef.current || 60);
      }
      setPicked(null); setAnswered(false); setScreen("quiz");
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

  if (screen === "countdown")
    return qIdx === 0
      ? <ModuleIntroFS mod={mod} secondsLeft={countdownNum} />
      : <Countdown num={countdownNum} />;

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
        // Pierwsze pytanie modułu → lead = 30 s (ekran zapowiedzi modułu).
        const { startedAt } = await advanceSessionQuestion(quizSession.id, globalIdx - 1, globalIdx, MODULE_INTRO_SECONDS);
        qStartedAtRef.current = startedAt || null;
        // Wygrany start modułu → rozgłoś od razu (Live View pokaże zapowiedź modułu równo).
        if (startedAt) broadcastSession({ current_question_idx: globalIdx, q_started_at: startedAt });
        const ms = startedAt ? new Date(startedAt).getTime() : null;
        if (ms && ms > serverNow()) setCountdownNum(Math.max(0, Math.ceil((ms - serverNow()) / 1000) - 1));
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

  // Pre-question overlay: start jest w przyszłości. Dla pierwszego pytania modułu
  // (qIdx===0, lead 30 s) pokazujemy zapowiedź modułu; w innym wypadku 3→2→1→START.
  // #4 — `counting` liczone SYNCHRONICZNIE z qStartedAtRef w renderze (nie z 200ms
  // efektu countdownNum), żeby pytanie nie mignęło o klatkę po zmianie pytania.
  const cdMs = qStartedAtRef.current ? new Date(qStartedAtRef.current).getTime() : null;
  const counting = screen === "quiz" && cdMs != null && cdMs > serverNow();
  const cdShow = countdownNum != null ? countdownNum : (counting ? Math.max(0, Math.ceil((cdMs - serverNow()) / 1000) - 1) : 0);
  if (counting)
    return qIdx === 0
      ? <ModuleIntroFS mod={mod} secondsLeft={cdShow} />
      : <Countdown num={cdShow} />;

  if (screen === "quiz" && currentQ && mod && !counting)
    return <Quiz isDesktop={isDesktop} currentMod={currentMod} qIdx={qIdx} timer={timer} mod={mod} currentQ={currentQ} qs={qs} totalQuestions={activeQuestions} answered={answered} picked={picked} myPts={myPts} allAnswers={allAnswers} correctAns={revealAns[currentQ?.id] ?? null} isPractice={!!quizSession?.is_practice} participantCode={participant?.code} sessionId={quizSession?.id} onPick={handlePick} />;

  if (screen === "ended")
    return <Ended participant={participant} myPts={myPts} allAnswers={allAnswers} isPractice={!!quizSession?.is_practice} onGoHome={resetApp} />;

  if (screen === "admin")
    return <AdminPanel admin={admin} isDesktop={isDesktop} onLogout={handleAdminLogout} onPodium={(results) => { setPodiumResults(results); setPodStep(0); setScreen("podium"); }} />;

  if (screen === "podium")
    return <Podium onBack={() => setScreen("admin")} podStep={podStep} setPodStep={setPodStep} results={podiumResults} />;

  return null;
}
