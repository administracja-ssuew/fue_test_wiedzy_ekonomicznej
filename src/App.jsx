import { useState, useEffect, useRef, useMemo, lazy } from "react";
import { supabase, DEMO, logoutAdmin, getCityBg, markCodeUsed, keepRealtimeAlive } from "./lib/supabase.js";
import { ANSWER_LABELS } from "./lib/gameLogic.js";
import { startServerClock } from "./lib/serverClock.js";
import { loadParticipant, saveParticipant, clearParticipant, BG_KEY } from "./lib/participantState.js";
import { useModules } from "./context/ModulesContext.jsx";
import useWindowWidth from "./hooks/useWindowWidth.js";
import useAuth from "./hooks/useAuth.js";
import useParticipantGame from "./hooks/useParticipantGame.js";
import useWakeLock from "./hooks/useWakeLock.js";

import Welcome        from "./screens/Welcome.jsx";
import Break          from "./screens/Break.jsx";
import WaitingResults from "./screens/WaitingResults.jsx";
import CodeEntry   from "./screens/CodeEntry.jsx";
import AdminLogin  from "./screens/AdminLogin.jsx";
import Lobby       from "./screens/Lobby.jsx";
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

  // Participant (no auth — identified by code). localStorage → przeżywa refresh i
  // zamknięcie karty; loadParticipant migruje też stary wpis sprzed fazy 6.
  const [participant, setParticipant] = useState(() => loadParticipant()); // { code, name, surname, city, sessionId? }
  const [podStep, setPodStep]           = useState(0);
  const [podiumResults, setPodiumResults] = useState([]);
  const MODULES        = useModules(); // tylko nazwa/ikona/kolor — czasy pytań są w planie sesji
  const isDesktop = useWindowWidth() >= 900;

  // ── Gra uczestnika (Faza 6) ─────────────────────────────────────
  // Ekran = czysta funkcja fazy z zamrożonego planu i zegara serwera. Uczestnik nie
  // zapisuje przejść pytań i nie ma własnych timerów — tylko projekcja + wybór odpowiedzi.
  const game = useParticipantGame(screen === "game" ? participant : null);
  const gv = game.view;
  const gamePlan = game.plan || [];
  const isPracticeSession = !!game.session?.is_practice;
  // Faza do routingu i sondy: „loading” przed pierwszym snapshotem oraz gdy kotwica
  // przyszła przed planem (plan_loading) — nigdy komunikat legacy na starcie quizu.
  let gamePhase = gv.phase;
  if (game.loadState === "loading" && !game.plan && !game.session) gamePhase = "loading";
  else if (gamePhase === "plan_loading") gamePhase = "loading";
  else if (gamePhase === "no_session") gamePhase = "lobby";
  else if (gamePhase === "ended" && isPracticeSession) gamePhase = "lobby"; // próba wraca do poczekalni
  const myCurrent = gv.item ? game.myAnswers[gv.item.id] : null;

  // Ekran telefonu nie gaśnie w poczekalni i przez całą rozgrywkę (ponawiane po powrocie karty).
  useWakeLock(screen === "game" && ["lobby", "no_session", "plan_loading", "intro", "countdown", "quiz", "reveal", "paused", "finished"].includes(gv.phase));

  // Tło miasta z localStorage od razu — bez mignięcia domyślnego tła po refreshu.
  useEffect(() => {
    try {
      const bg = localStorage.getItem(BG_KEY);
      if (bg) document.documentElement.style.setProperty("--fue-bg", bg);
    } catch (_) { /* nieistotne */ }
  }, []);

  // Restore uczestnika po refreshu: po rozstrzygnięciu auth (admin ma pierwszeństwo)
  // wracamy prosto do gry — bez ponownego wpisywania kodu.
  useEffect(() => {
    if (loading || admin || screen !== "welcome") return;
    if (participant) setScreen("game");
  }, [loading]); // eslint-disable-line

  // Nieprawidłowy kod (np. usunięty przez admina) → od nowa ekran kodu.
  useEffect(() => {
    if (screen !== "game" || game.loadState !== "invalid_code") return;
    clearParticipant();
    setParticipant(null);
    setScreen("code_entry");
  }, [screen, game.loadState]);

  // Oznacz kod jako użyty w sesji — raz na parę (kod, sesja).
  const markedRef = useRef(null);
  useEffect(() => {
    const sid = game.session?.id;
    const code = participant?.code;
    if (screen !== "game" || !sid || !code) return;
    const key = `${code}|${sid}`;
    if (markedRef.current === key) return;
    markedRef.current = key;
    markCodeUsed(code, sid);
  }, [screen, game.session?.id, participant?.code]);

  // Tło miasta: z sesji (bg / bg_mobile wg szerokości), a gdy snapshot go nie niesie —
  // z getCityBg. Zapis do localStorage na potrzeby refreshu.
  const sessBg = game.session?.bg ?? null;
  const sessBgMobile = game.session?.bg_mobile ?? null;
  useEffect(() => {
    if (screen !== "game" || !participant?.city) return undefined;
    let cancelled = false;
    const apply = (raw) => {
      if (cancelled || !raw) return;
      const bg = isDesktop ? (raw.bg || raw.bgMobile) : (raw.bgMobile || raw.bg);
      if (!bg) return;
      document.documentElement.style.setProperty("--fue-bg", bg);
      try { localStorage.setItem(BG_KEY, bg); } catch (_) { /* nieistotne */ }
    };
    if (sessBg || sessBgMobile) apply({ bg: sessBg, bgMobile: sessBgMobile });
    else getCityBg(participant.city).then(apply);
    return () => { cancelled = true; };
  }, [screen, participant?.city, game.session?.id, sessBg, sessBgMobile, isDesktop]);

  // Atrybuty dla sondy e2e (06-08): stabilny odczyt fazy bez parsowania tekstu.
  useEffect(() => {
    if (screen !== "game") {
      delete document.body.dataset.fuePhase;
      delete document.body.dataset.fueQ;
      delete document.body.dataset.fueRemaining;
      delete document.body.dataset.fueLocked;
      delete document.body.dataset.fueChoice;
      return;
    }
    document.body.dataset.fuePhase = gamePhase;
    document.body.dataset.fueQ = gv.idx != null ? String(gv.idx + 1) : "";
    document.body.dataset.fueRemaining = String(gv.secondsLeft ?? "");
    document.body.dataset.fueLocked = myCurrent ? "1" : "0";
    document.body.dataset.fueChoice = myCurrent?.chosen != null ? (ANSWER_LABELS[myCurrent.chosen] ?? "") : "";
  }, [screen, gamePhase, gv.idx, gv.secondsLeft, myCurrent]);

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

  // Utrzymuje socket Realtime przy życiu przez cały czas trwania aplikacji — bez tego
  // wyjście z poczekalni opróżniało listę kanałów, supabase-js rozłączał socket i
  // uczestnik przestawał dostawać przejścia pytań. Szczegóły w lib/supabase.js.
  useEffect(() => { keepRealtimeAlive(); }, []);

  // Auto-restore admin session: redirect to panel when Supabase session is found on page load
  useEffect(() => {
    if (!loading && admin && screen === "welcome") setScreen("admin");
  }, [loading, admin]);

  const handleAdminLogout = async () => { await logoutAdmin(); setScreen("welcome"); };

  // Kod poprawny → zapamiętaj uczestnika i wejdź do gry (faza z hooka: lobby/quiz/…).
  const handleCodeSuccess = (p) => {
    saveParticipant(p);
    setParticipant(p);
    setScreen("game");
  };

  const resetApp = () => {
    clearParticipant();
    document.documentElement.style.removeProperty("--fue-bg");
    setParticipant(null);
    setScreen("welcome");
  };

  // ── Standalone live view ─────────────────────────────────────────
  if (liveParams) return <LiveView city={liveParams.city} />;

  // ── Loading ──────────────────────────────────────────────────────
  const loadingView = (
    <div style={{ minHeight: "100vh", background: "#070215", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, fontFamily: '"Space Grotesk",sans-serif', color: "#EDE9FE" }}>
      <div className="spinner" style={{ width: 40, height: 40, border: "3px solid rgba(107,33,232,.3)", borderTop: "3px solid #6B21E8", borderRadius: "50%" }} />
      <p style={{ color: "#9B89CC", fontSize: 14 }}>Ładowanie…</p>
    </div>
  );
  if (loading) return loadingView;

  // Szkielet ekranu pytania (Faza 6 — płynność): refresh bez cache albo kotwica przed
  // planem pokazują kształt ekranu gry zamiast pustki/spinnera. Tło = var(--fue-bg),
  // ustawione z localStorage (BG_KEY) zanim przyjdzie snapshot. Wartość JSX, nie komponent.
  const skelBlock = (extra) => ({ background: "rgba(255,255,255,.06)", borderRadius: 10, animation: "pulse 1.4s infinite", ...extra });
  const QuizSkeleton = (
    <div data-fue-skeleton="1" aria-busy="true" aria-label="Ładowanie quizu" style={{ minHeight: "100vh", background: "var(--fue-bg)", display: "flex", justifyContent: "center", fontFamily: '"Space Grotesk",sans-serif' }}>
      <div className="fue-quiz-layout" style={{ width: "100%" }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          {/* Pasek górny 54 px */}
          <div style={{ background: "rgba(0,0,0,.45)", padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={skelBlock({ width: 110, height: 16, borderRadius: 20 })} />
              <div style={skelBlock({ width: 150, height: 14 })} />
            </div>
            <div style={skelBlock({ width: 54, height: 54, borderRadius: "50%", flexShrink: 0 })} />
          </div>
          <div style={{ height: 6, background: "rgba(255,255,255,.07)", flexShrink: 0 }} />
          {/* Blok pytania — 2 linie */}
          <div style={{ padding: "22px 20px 14px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <div style={skelBlock({ width: "88%", height: 18 })} />
            <div style={skelBlock({ width: "62%", height: 18 })} />
          </div>
          {/* Siatka 2×2 kafli odpowiedzi */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, padding: "0 14px 20px", alignContent: "start" }}>
            {[0, 1, 2, 3].map((i) => <div key={i} style={skelBlock({ minHeight: 100, borderRadius: 14 })} />)}
          </div>
        </div>
      </div>
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
    return <Practice city={participant?.city} onBack={() => setScreen(participant ? "game" : "welcome")} />;

  if (screen === "no_questions") return (
    <div style={{ minHeight: "100vh", background: "var(--fue-bg)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: '"Space Grotesk",sans-serif', color: "#EDE9FE", textAlign: "center", padding: 32 }}>
      <div>
        <div style={{ fontSize: 52, marginBottom: 16 }}>⚠️</div>
        <h2 style={{ fontFamily: '"Bebas Neue"', fontSize: 36, letterSpacing: 1, color: "#F5C518", marginBottom: 12 }}>Brak pytań</h2>
        <p style={{ color: "#9B89CC", fontSize: 15, lineHeight: 1.7, maxWidth: 360, margin: "0 auto 28px" }}>
          Administrator nie wgrał jeszcze pytań dla Twojego miasta ({participant?.city}).<br />
          Skontaktuj się z organizatorem.
        </p>
        <button onClick={() => setScreen("game")} style={{ background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.15)", borderRadius: 12, padding: "12px 28px", color: "#C4B5FD", cursor: "pointer", fontFamily: '"Space Grotesk"', fontSize: 14 }}>
          ← Wróć do poczekalni
        </button>
      </div>
    </div>
  );

  // ── Gra uczestnika: switch po fazie z planu ──────────────────────
  if (screen === "game") {
    if (!participant) return loadingView;
    const mId = gv.item?.m;
    const mod = mId != null
      ? (MODULES.find((m) => m.id === mId) || { id: mId, name: `Moduł ${mId}`, icon: "📘", color: "#6B21E8" })
      : null;

    switch (gamePhase) {
      case "loading":
        // Obejmuje loadState „loading” bez planu/sesji ORAZ plan_loading (mapowane wyżej).
        return QuizSkeleton;

      case "lobby":
        // Lobby woła onStartQuiz(s) z wierszem wykrytej sesji — jej id jako podpowiedź
        // omija przypięte id zakończonej sesji (np. po próbie).
        return <Lobby participant={participant} isDesktop={isDesktop} isPractice={isPracticeSession}
          onStartQuiz={(s) => game.refresh(s?.id)} onPractice={() => setScreen("practice")} />;

      case "intro":
        return <ModuleIntroFS mod={mod} secondsLeft={gv.secondsLeft} />;

      case "countdown":
        return <Countdown num={Math.max(0, gv.secondsLeft - 1)} />;

      case "quiz":
      case "reveal":
        return <Quiz item={gv.item} mod={mod} phase={gv.phase} secondsLeft={gv.secondsLeft}
          opensAt={gv.opensAt} closesAt={gv.closesAt} revealUntil={gv.revealUntil}
          picked={myCurrent?.chosen ?? null} answerStatus={myCurrent?.status ?? null}
          correctAns={gv.phase === "reveal" ? game.revealAns : null}
          qNumGlobal={gv.idx + 1} totalQuestions={gamePlan.length}
          qNumInModule={1 + gamePlan.filter((x) => x.m === gv.item.m && x.i < gv.item.i).length}
          moduleCount={gamePlan.filter((x) => x.m === gv.item.m).length}
          correctTotal={game.correctTotal} isDesktop={isDesktop} isPractice={isPracticeSession}
          participantCode={participant.code} sessionId={game.session?.id} onPick={game.pick} />;

      case "paused":
        return <Break participant={participant} nextModule={gv.item?.m} isAdminPause />;

      case "finished":
        return <WaitingResults participant={participant} />;

      case "results":
      case "ended": {
        const allAnswers = Object.entries(game.myAnswers).map(([qId, a]) => ({
          qId, module: gamePlan.find((x) => x.id === qId)?.m, picked: a.chosen, correct: a.correct === true, pts: 0,
        }));
        return <Ended participant={participant} myPts={0} allAnswers={allAnswers} isPractice={isPracticeSession} onGoHome={resetApp} />;
      }

      case "legacy":
        // Świadoma decyzja: nowy klient nie odtwarza starej maszyny stanów.
        return (
          <div style={{ minHeight: "100vh", background: "var(--fue-bg)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: '"Space Grotesk",sans-serif', color: "#EDE9FE", textAlign: "center", padding: 32 }}>
            <div>
              <div style={{ fontSize: 52, marginBottom: 16 }}>⚠️</div>
              <h2 style={{ fontFamily: '"Bebas Neue"', fontSize: 36, letterSpacing: 1, color: "#F5C518", marginBottom: 12 }}>Sesja z poprzedniej wersji</h2>
              <p style={{ color: "#9B89CC", fontSize: 15, lineHeight: 1.7, maxWidth: 380, margin: "0 auto" }}>
                Ten quiz został uruchomiony w starszej wersji panelu. Organizator musi zakończyć sesję i uruchomić ją ponownie z odświeżonego panelu.
              </p>
            </div>
          </div>
        );

      default:
        return loadingView;
    }
  }

  if (screen === "admin")
    return <AdminPanel admin={admin} isDesktop={isDesktop} onLogout={handleAdminLogout} onPodium={(results) => { setPodiumResults(results); setPodStep(0); setScreen("podium"); }} />;

  if (screen === "podium")
    return <Podium onBack={() => setScreen("admin")} podStep={podStep} setPodStep={setPodStep} results={podiumResults} />;

  return null;
}
