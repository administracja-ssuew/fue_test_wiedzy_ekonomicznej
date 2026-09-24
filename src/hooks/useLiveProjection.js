import { useState, useEffect, useRef } from "react";
import {
  supabase, DEMO,
  getSessionForCity, getCityBg, getLiveQuestionStats, getLiveAnswerSummary, getLiveAnswerCount, getQuestions,
  getParticipantCount, getSessionPlan, getAnswerSummaryV2,
} from "../lib/supabase.js";
import { useModules } from "../context/ModulesContext.jsx";
import { REVEAL_SECONDS, projectLiveState } from "../lib/gameLogic.js";
import { toMs, projectPlanState, REVEAL_GATE_MS } from "../lib/plan.js";
import { serverNow } from "../lib/serverClock.js";

const DEFAULT_BG = "linear-gradient(160deg,#070215 0%,#0E0435 50%,#070215 100%)";

// Pure projection of the DB session state for any "spectator" view (standalone
// LiveView, admin ghost embed). It runs NO quiz state machine of its own — a single
// 250ms ticker derives phase/timer/countdown.
//
// Faza 6: sesja z planem (plan_anchor_at) → projekcja z planu sesji (items + kotwica
// + serverNow), czas pytania z planu (zamrożony przy starcie), reveal po bramce
// closes_at + 1,5 s przez get_answer_summary_v2. Sesja bez planu (legacy) → stara
// projekcja z (status, current_question_idx, q_started_at, czas modułu) — do 06-11.
//
// `detailed`: true only for the admin embed (authenticated) → fetches the full
// per-participant answer list (get_admin_question_stats, admin-only). The public
// LiveView (anon) uses detailed=false → only aggregate counts via an anon-safe RPC,
// so no participant's individual answers are ever exposed to anon (anti-cheat).
//
// phase: "waiting" | "paused" | "quiz" | "reveal"
export default function useLiveProjection(city, { detailed = false } = {}) {
  const MODULES = useModules();
  const [phase, setPhase]         = useState("waiting");
  const [gIdx, setGIdx]           = useState(0);
  const [timer, setTimer]         = useState(0);
  const [reveal, setReveal]       = useState([]);
  const [revealTotal, setRevealTotal]     = useState(0);
  const [revealCorrect, setRevealCorrect] = useState(0);
  const [revealAns, setRevealAns]         = useState(null); // poprawny indeks (bramkowany z serwera)
  const [autoSec, setAutoSec]     = useState(REVEAL_SECONDS);
  const [bg, setBg]               = useState(DEFAULT_BG);
  const [liveCount, setLiveCount] = useState(0);
  const [participantsTotal, setParticipantsTotal] = useState(0);
  const [cdNum, setCdNum]         = useState(null);
  const [firstOfModule, setFirstOfModule] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [sessionId, setSessionId] = useState(null); // do subskrypcji szybkiego kanału sesji
  const [podium, setPodium]       = useState(null); // {results, podStep} wypchnięte przez admina (#5)

  const sessionRef       = useRef(null);
  const questionsRef     = useRef([]);
  const modulesRef       = useRef(MODULES);
  const phaseRef         = useRef("waiting");
  const lastIdxRef       = useRef(-1);
  const revealFetchedRef = useRef(-1);
  const liveRef          = useRef(null);
  const planRef          = useRef(null); // items planu sesji (null = sesja legacy / plan jeszcze nie pobrany)
  const planSidRef       = useRef(null); // session.id, dla którego pobrano (lub pobieramy) plan
  const [planTpq, setPlanTpq] = useState(null); // czas bieżącego pytania z planu

  // Sesja z Realtime/polla → sessionRef + jednorazowe pobranie planu na session.id.
  const applySession = (s) => {
    if (!s) return;
    sessionRef.current = s;
    if (s.id) setSessionId(s.id);
    if (!s.plan_anchor_at) {
      planRef.current = null; planSidRef.current = null;
      return;
    }
    if (planSidRef.current === s.id) return;
    planSidRef.current = s.id;
    planRef.current = null;
    getSessionPlan(s.id).then((items) => {
      if (planSidRef.current !== s.id) return; // w międzyczasie inna sesja
      if (items?.length) planRef.current = items;
      else planSidRef.current = null; // ponów przy następnym odczycie sesji
    });
  };

  useEffect(() => { modulesRef.current = MODULES; }, [MODULES]);
  useEffect(() => { questionsRef.current = questions; }, [questions]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Initial load
  useEffect(() => {
    if (!city) return;
    Promise.all([getSessionForCity(city), getCityBg(city), getQuestions(city)])
      .then(([sess, bgData, qs]) => {
        const bgVal = bgData?.bg || bgData?.bgMobile;
        if (bgVal) setBg(bgVal);
        if (qs?.length) { setQuestions(qs); questionsRef.current = qs; }
        if (sess) applySession(sess);
      });
  }, [city]); // eslint-disable-line

  // Realtime + poll → keep sessionRef fresh
  useEffect(() => {
    if (!city) return;
    const apply = applySession;
    if (!DEMO && supabase) {
      const ch = supabase.channel(`live-proj-${city}`)
        .on("broadcast", { event: "quiz_event" }, () => {
          // Sygnał, nie źródło prawdy — pobierz autorytatywny stan z bazy (anty-spoofing).
          getSessionForCity(city).then(apply);
        })
        .on("postgres_changes", {
          event: "UPDATE", schema: "public", table: "quiz_sessions", filter: `city=eq.${city}`,
        }, ({ new: s }) => apply(s))
        .subscribe();
      // detailed = embed w panelu admina. Ten jeden klient MUSI nadążać, bo prowadzący
      // patrzy na niego i na salę jednocześnie. Broadcast go nie ratuje: Supabase ma
      // domyślnie broadcast.self=false, więc podgląd NIE dostaje przejścia rozgłoszonego
      // przez ten sam panel — zmierzone na produkcji. Zostaje postgres_changes (~670 ms)
      // i ten poll, więc dla admina schodzimy na 1 s. Publiczne projektory (anon) mają
      // działający broadcast od admina i zostają na 5 s.
      const poll = setInterval(() => getSessionForCity(city).then(apply), detailed ? 1000 : 5000);
      return () => { supabase.removeChannel(ch); clearInterval(poll); };
    }
    const poll = setInterval(() => getSessionForCity(city).then(apply), 3000);
    return () => clearInterval(poll);
  }, [city]); // eslint-disable-line

  // Szybki kanał broadcast sesji (quiz-${id}) — łapie INSTANT push przejścia pytania
  // rozgłaszany przez uczestnika (advanceQuestion) oraz admina, bez czekania na wolny
  // postgres_changes/polling. Dzięki temu reveal kończy się równo z uczestnikiem.
  useEffect(() => {
    if (!sessionId || DEMO || !supabase) return;
    const ch = supabase.channel(`quiz-${sessionId}`)
      .on("broadcast", { event: "quiz_event" }, () => {
        // Sygnał do szybkiego odświeżenia — stan bierzemy z bazy, nie z payloadu (anty-spoofing).
        getSessionForCity(city).then(applySession);
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [sessionId]);

  // Projection ticker
  useEffect(() => {
    // idx = indeks w questionsRef; v2 = sesja z planem (reveal bramkowany planem, sekcja 39).
    const fetchReveal = async (idx, { v2 = false, retry = false } = {}) => {
      const q = questionsRef.current[idx];
      const sid = sessionRef.current?.id;
      if (!sid || !q?.id) return;
      if (v2 && !detailed) {
        // Publiczny projektor, sesja z planem: poprawna odpowiedź dopiero po closes_at + 1,5 s.
        const s = await getAnswerSummaryV2(sid, q.id);
        if (lastIdxRef.current !== idx) return; // przyszło po zmianie pytania
        setRevealTotal(s.total || 0);
        setRevealCorrect(s.correct || 0);
        if (s.ans != null) setRevealAns(s.ans);
        else if (retry) setTimeout(() => { if (lastIdxRef.current === idx) fetchReveal(idx, { v2: true }); }, 1000);
        return;
      }
      if (detailed) {
        // Admin embed (authenticated): full per-participant list + counts.
        const stats = await getLiveQuestionStats(sid, q.id);
        setReveal(stats.answers || []);
        setRevealTotal(stats.total || 0);
        setRevealCorrect(stats.correct || 0);
      } else {
        // Public projector (anon): aggregate counts only — no per-person data.
        // ans jest bramkowane serwerowo (tylko po końcu czasu pytania).
        const s = await getLiveAnswerSummary(sid, q.id);
        setRevealTotal(s.total || 0);
        setRevealCorrect(s.correct || 0);
        if (s.ans != null) setRevealAns(s.ans);
      }
    };

    const resetForIdx = (idx) => {
      if (idx === lastIdxRef.current) return;
      lastIdxRef.current = idx;
      revealFetchedRef.current = -1;
      setReveal([]); setLiveCount(0); setRevealTotal(0); setRevealCorrect(0); setRevealAns(null);
    };

    // Sesja z planem: faza i czas to funkcja (plan, kotwica, serverNow) — jak u uczestnika.
    const tickPlan = (s) => {
      const nowMs = serverNow();
      const v = projectPlanState({
        items: planRef.current,
        anchorMs: toMs(s.plan_anchor_at),
        pausedAtMs: toMs(s.plan_paused_at),
        status: s.status,
        nowMs,
      });
      if (!v.item) {
        // lobby / results / ended / legacy
        setPhase("waiting"); setCdNum(null); setFirstOfModule(false);
        return;
      }
      const qs = questionsRef.current;
      const found = qs.findIndex((x) => x.id === v.item.id);
      const idx = found >= 0 ? found : v.idx;
      resetForIdx(idx);
      setGIdx(idx);
      setPlanTpq(v.item.tpq ?? null);
      setFirstOfModule(!!v.firstOfModule);

      if (v.phase === "intro" || v.phase === "countdown") {
        setPhase("quiz");
        setCdNum(Math.max(0, v.secondsLeft - 1));
        setTimer(v.item.tpq);
      } else if (v.phase === "quiz") {
        setPhase("quiz"); setCdNum(null);
        setTimer(v.secondsLeft);
      } else if (v.phase === "reveal" || v.phase === "finished") {
        // finished: ≤ 1 s do przejścia zamiatacza w status results — zostajemy na reveal bez mignięcia.
        setPhase("reveal"); setCdNum(null);
        setAutoSec(v.phase === "finished" ? 0 : v.secondsLeft);
      } else if (v.phase === "paused") {
        setPhase("paused"); setCdNum(null);
      }

      // Reveal po bramce (zamiast setTimeout 1500): raz na pytanie.
      if ((v.phase === "reveal" || v.phase === "finished")
          && nowMs >= v.closesAt + REVEAL_GATE_MS + 100
          && revealFetchedRef.current !== idx) {
        revealFetchedRef.current = idx;
        fetchReveal(idx, { v2: true, retry: true });
      }
    };

    const tick = () => {
      const s = sessionRef.current;
      if (planRef.current?.length && s?.plan_anchor_at) { tickPlan(s); return; }
      // Legacy (sesja bez planu albo plan jeszcze się pobiera) — do usunięcia w 06-11.
      setPlanTpq(null);
      const { phase: p, idx, timer: t, autoSec: a, cdNum: cd, firstOfModule: fom } = projectLiveState({
        session: sessionRef.current,
        questions: questionsRef.current,
        modules: modulesRef.current,
        now: serverNow(), // wspólny zegar — ta sama sekunda co u uczestnika
      });

      resetForIdx(idx);
      setGIdx(idx);
      setPhase(p);
      setCdNum(cd);
      setFirstOfModule(!!fom);
      if (p === "quiz") setTimer(t);
      if (p === "reveal") {
        setAutoSec(a);
        if (revealFetchedRef.current !== idx) {
          revealFetchedRef.current = idx;
          setTimeout(() => fetchReveal(idx), 1500); // let last submissions land
        }
      }
    };

    tick();
    const iv = setInterval(tick, 250);
    return () => clearInterval(iv);
  }, []); // reads refs

  // Live answer count during the quiz phase
  useEffect(() => {
    liveRef.current = setInterval(() => {
      if (phaseRef.current !== "quiz") return;
      const q = questionsRef.current[lastIdxRef.current];
      const sid = sessionRef.current?.id;
      if (sid && q?.id) getLiveAnswerCount(sid, q.id).then(setLiveCount);
    }, 1000);
    return () => clearInterval(liveRef.current);
  }, []);

  // Liczba uczestników w sesji (do licznika "X/N" na Live View). Wolno się zmienia
  // → odpyt co 5 s. Tylko liczba przez SECURITY DEFINER RPC — anon nie czyta
  // kodów/nazwisk (hardening, sekcja 27).
  useEffect(() => {
    if (!city) return;
    const fetchTotal = () => {
      const sid = sessionRef.current?.id;
      if (sid) getParticipantCount(city, sid).then(setParticipantsTotal);
    };
    fetchTotal();
    const iv = setInterval(fetchTotal, 5000);
    return () => clearInterval(iv);
  }, [city]);

  // #5 — odbiór podium wypchniętego przez admina (kanał miasta).
  // UWAGA (residual risk): anon nie może czytać wyników z bazy (get_session_results
  // jest admin-only), więc podium MUSI przyjść broadcastem od admina i nie da się go
  // zweryfikować z bazy jak stanu quizu. Skutek ewentualnego sfałszowania jest
  // kosmetyczny i przejściowy (błędny ranking na projektorze), a admin re-broadcastuje
  // stan co 2 s, nadpisując podszywkę. Pełne domknięcie wymaga Realtime Authorization
  // (kanały prywatne z RLS) — świadomie poza zakresem tej poprawki.
  useEffect(() => {
    if (!city || DEMO || !supabase) return;
    const ch = supabase.channel(`podium-${encodeURIComponent(city)}`) // ASCII — zgodne z nadawcą (App)
      .on("broadcast", { event: "podium" }, ({ payload }) => { if (payload?.results) setPodium(payload); })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [city]);

  const currentQ = questions[gIdx];
  const mod      = MODULES.find((m) => m.id === currentQ?.module);
  // Sesja z planem: czas z planu (SC4). Fallback na czas modułu tylko dla legacy — usunąć w 06-11.
  const timePerQ = planTpq ?? (mod?.timePerQ || 60);

  return { phase, gIdx, timer, autoSec, cdNum, firstOfModule, currentQ, questions, mod, timePerQ, reveal, revealTotal, revealCorrect, revealAns, liveCount, participantsTotal, bg, podium };
}
