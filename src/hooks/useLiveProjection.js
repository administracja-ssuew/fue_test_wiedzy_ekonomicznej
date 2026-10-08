import { useState, useEffect, useRef } from "react";
import {
  supabase, DEMO,
  getSessionForCity, getCityBg, getLiveQuestionStats, getLiveAnswerCount, getQuestions,
  getParticipantCount, getSessionPlan, getAnswerSummaryV2,
} from "../lib/supabase.js";
import { useModules } from "../context/ModulesContext.jsx";
import { REVEAL_MS } from "../lib/gameLogic.js";
import { toMs, projectPlanState, REVEAL_GATE_MS } from "../lib/plan.js";
import { serverNow } from "../lib/serverClock.js";
import { projectorIdlePhase } from "../lib/projector.js";

const DEFAULT_BG = "linear-gradient(160deg,#070215 0%,#0E0435 50%,#070215 100%)";

// Pure projection of the DB session state for any "spectator" view (standalone
// LiveView, admin ghost embed). It runs NO quiz state machine of its own - a single
// 250ms ticker derives phase/timer/countdown.
//
// Faza 6: sesja z planem (plan_anchor_at) → projekcja z planu sesji (items + kotwica
// + serverNow), czas pytania z planu (zamrożony przy starcie), reveal po bramce
// closes_at + 1,5 s przez get_answer_summary_v2. Sesja bez planu albo plan jeszcze
// niepobrany → "waiting" bez licznika (nie liczymy czasu z modułów).
//
// `detailed`: true only for the admin embed (authenticated) → fetches the full
// per-participant answer list (get_admin_question_stats, admin-only). The public
// LiveView (anon) uses detailed=false → only aggregate counts via an anon-safe RPC,
// so no participant's individual answers are ever exposed to anon (anti-cheat).
//
// phase: "waiting" | "ended" | "paused" | "quiz" | "reveal"
export default function useLiveProjection(city, { detailed = false } = {}) {
  const MODULES = useModules();
  // tickPlan żyje w efekcie z pustymi zależnościami - moduły czyta przez ref, nie z domknięcia.
  const modulesRef = useRef(MODULES);
  modulesRef.current = MODULES;
  const [phase, setPhase]         = useState("waiting");
  const [gIdx, setGIdx]           = useState(0);
  const [timer, setTimer]         = useState(0);
  const [reveal, setReveal]       = useState([]);
  const [revealTotal, setRevealTotal]     = useState(0);
  const [revealCorrect, setRevealCorrect] = useState(0);
  const [revealAns, setRevealAns]         = useState(null); // poprawny indeks (bramkowany z serwera)
  // Liczba całkowita do wyświetlania (REVEAL_MS = 11 500 → 12 s na starcie odliczania).
  const [autoSec, setAutoSec]     = useState(Math.ceil(REVEAL_MS / 1000));
  // Przerwa planowa (06-12): następny moduł { id, name, icon, color } | null (ręczna pauza / brak przerwy).
  const [breakNext, setBreakNext] = useState(null);
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
  const phaseRef        = useRef("waiting");
  const lastIdxRef       = useRef(-1);
  const revealFetchedRef = useRef(-1);
  const liveRef          = useRef(null);
  const planRef          = useRef(null); // items planu sesji (null = sesja legacy / plan jeszcze nie pobrany)
  const planSidRef       = useRef(null); // session.id, dla którego pobrano (lub pobieramy) plan
  const [planTpq, setPlanTpq] = useState(null); // czas bieżącego pytania z planu
  // Numer, liczba pytań i moduł z planu sesji - lokalna lista pytań miasta może się różnić od planu.
  const [qNum, setQNum]       = useState(0);
  const [qTotal, setQTotal]   = useState(0);
  const [planMod, setPlanMod] = useState(null);
  const cityRef   = useRef(city);
  cityRef.current = city;
  const qFetchRef = useRef({ busy: false, at: 0 });

  // Lista pytań mogła się zmienić po otwarciu projektora (pytanie dodane/podmienione,
  // nowa sesja). Doładowanie bez równoległych wywołań i nie częściej niż co 2 s.
  const refreshQuestions = () => {
    const f = qFetchRef.current;
    const c = cityRef.current;
    if (!c || f.busy || Date.now() - f.at < 2000) return;
    f.busy = true; f.at = Date.now();
    getQuestions(c)
      .then((qs) => {
        if (cityRef.current !== c) return;
        if (qs?.length) { setQuestions(qs); questionsRef.current = qs; }
      })
      .catch(() => {})
      .finally(() => { f.busy = false; });
  };

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
    refreshQuestions(); // nowa sesja może mieć inny zestaw pytań
    getSessionPlan(s.id).then((items) => {
      if (planSidRef.current !== s.id) return; // w międzyczasie inna sesja
      if (items?.length) planRef.current = items;
      else planSidRef.current = null; // ponów przy następnym odczycie sesji
    });
  };

  useEffect(() => { questionsRef.current = questions; }, [questions]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Initial load
  useEffect(() => {
    if (!city) return;
    refreshQuestions();
    Promise.all([getSessionForCity(city), getCityBg(city)])
      .then(([sess, bgData]) => {
        const bgVal = bgData?.bg || bgData?.bgMobile;
        if (bgVal) setBg(bgVal);
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
          // Sygnał, nie źródło prawdy - pobierz autorytatywny stan z bazy (anty-spoofing).
          getSessionForCity(city).then(apply);
        })
        .on("postgres_changes", {
          event: "UPDATE", schema: "public", table: "quiz_sessions", filter: `city=eq.${city}`,
        }, ({ new: s }) => apply(s))
        .subscribe();
      // detailed = embed w panelu admina. Ten jeden klient MUSI nadążać, bo prowadzący
      // patrzy na niego i na salę jednocześnie. Broadcast go nie ratuje: Supabase ma
      // domyślnie broadcast.self=false, więc podgląd NIE dostaje przejścia rozgłoszonego
      // przez ten sam panel - zmierzone na produkcji. Zostaje postgres_changes (~670 ms)
      // i ten poll, więc dla admina schodzimy na 1 s. Publiczne projektory (anon) mają
      // działający broadcast od admina i zostają na 5 s.
      const poll = setInterval(() => getSessionForCity(city).then(apply), detailed ? 1000 : 5000);
      return () => { supabase.removeChannel(ch); clearInterval(poll); };
    }
    const poll = setInterval(() => getSessionForCity(city).then(apply), 3000);
    return () => clearInterval(poll);
  }, [city]); // eslint-disable-line

  // Szybki kanał broadcast sesji (quiz-${id}) - łapie INSTANT push przejścia pytania
  // rozgłaszany przez uczestnika (advanceQuestion) oraz admina, bez czekania na wolny
  // postgres_changes/polling. Dzięki temu reveal kończy się równo z uczestnikiem.
  useEffect(() => {
    if (!sessionId || DEMO || !supabase) return;
    const ch = supabase.channel(`quiz-${sessionId}`)
      .on("broadcast", { event: "quiz_event" }, () => {
        // Sygnał do szybkiego odświeżenia - stan bierzemy z bazy, nie z payloadu (anty-spoofing).
        getSessionForCity(city).then(applySession);
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [sessionId]);

  // Projection ticker
  useEffect(() => {
    // idx = indeks w questionsRef; reveal bramkowany planem (sekcja 39).
    const fetchReveal = async (idx, { retry = false } = {}) => {
      const q = questionsRef.current[idx];
      const sid = sessionRef.current?.id;
      if (!sid || !q?.id) return;
      if (!detailed) {
        // Publiczny projektor (anon): tylko agregaty; poprawna odpowiedź dopiero po closes_at + 1,5 s.
        const s = await getAnswerSummaryV2(sid, q.id);
        if (lastIdxRef.current !== idx) return; // przyszło po zmianie pytania
        setRevealTotal(s.total || 0);
        setRevealCorrect(s.correct || 0);
        if (s.ans != null) setRevealAns(s.ans);
        else if (retry) setTimeout(() => { if (lastIdxRef.current === idx) fetchReveal(idx); }, 1000);
        return;
      }
      // Admin embed (authenticated): full per-participant list + counts.
      const stats = await getLiveQuestionStats(sid, q.id);
      setReveal(stats.answers || []);
      setRevealTotal(stats.total || 0);
      setRevealCorrect(stats.correct || 0);
    };

    const resetForIdx = (idx) => {
      if (idx === lastIdxRef.current) return;
      lastIdxRef.current = idx;
      revealFetchedRef.current = -1;
      setReveal([]); setLiveCount(0); setRevealTotal(0); setRevealCorrect(0); setRevealAns(null);
    };

    // Sesja z planem: faza i czas to funkcja (plan, kotwica, serverNow) - jak u uczestnika.
    const tickPlan = (s) => {
      const nowMs = serverNow();
      const v = projectPlanState({
        items: planRef.current,
        anchorMs: toMs(s.plan_anchor_at),
        pausedAtMs: toMs(s.plan_paused_at),
        status: s.status,
        nowMs,
        holdIdx: s.plan_hold_idx ?? null, // przerwa już obsłużona → brak powrotu do niej po wznowieniu
      });
      if (!v.item) {
        // lobby/legacy → waiting; results/ended → ended (G8) - do wypchnięcia podium
        setPhase(projectorIdlePhase(v, s.status)); setCdNum(null); setFirstOfModule(false); setBreakNext(null);
        return;
      }
      if (v.phase === "paused" && v.plannedBreak) {
        const nm = v.nextModule;
        setBreakNext(modulesRef.current.find((m) => m.id === nm) || { id: nm, name: `Moduł ${nm}`, icon: "📘", color: "#6B21E8" });
      } else {
        setBreakNext(null);
      }
      // Pytania z planu nie ma na liście → doładuj listę. Do tego czasu idx = -1 (brak
      // currentQ): lepiej chwilę bez treści niż cudze pytanie spod indeksu planu.
      const idx = questionsRef.current.findIndex((x) => x.id === v.item.id);
      if (idx < 0) refreshQuestions();
      resetForIdx(idx);
      setGIdx(idx);
      setQNum(v.idx + 1);
      setQTotal(planRef.current.length);
      setPlanMod(v.item.m ?? null);
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
        // finished: ≤ 1 s do przejścia zamiatacza w status results - zostajemy na reveal bez mignięcia.
        setPhase("reveal"); setCdNum(null);
        setAutoSec(v.phase === "finished" ? 0 : v.secondsLeft);
      } else if (v.phase === "paused") {
        setPhase("paused"); setCdNum(null);
      }

      // Reveal po bramce (zamiast setTimeout 1500): raz na pytanie.
      if ((v.phase === "reveal" || v.phase === "finished")
          && nowMs >= v.closesAt + REVEAL_GATE_MS + 100
          && idx >= 0 && revealFetchedRef.current !== idx) {
        revealFetchedRef.current = idx;
        fetchReveal(idx, { retry: true });
      }
    };

    const tick = () => {
      const s = sessionRef.current;
      if (planRef.current?.length && s?.plan_anchor_at) { tickPlan(s); return; }
      // Sesja bez planu albo plan jeszcze się pobiera → poczekalnia, bez licznika;
      // sesja już zakończona (results/ended) → ekran końca testu (G8).
      setPlanTpq(null);
      setPhase(projectorIdlePhase(null, s?.status)); setCdNum(null); setFirstOfModule(false); setBreakNext(null);
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
  // → odpyt co 5 s. Tylko liczba przez SECURITY DEFINER RPC - anon nie czyta
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

  // #5 - odbiór podium wypchniętego przez admina (kanał miasta).
  // UWAGA (residual risk): anon nie może czytać wyników z bazy (get_session_results
  // jest admin-only), więc podium MUSI przyjść broadcastem od admina i nie da się go
  // zweryfikować z bazy jak stanu quizu. Skutek ewentualnego sfałszowania jest
  // kosmetyczny i przejściowy (błędny ranking na projektorze), a admin re-broadcastuje
  // stan co 2 s, nadpisując podszywkę. Pełne domknięcie wymaga Realtime Authorization
  // (kanały prywatne z RLS) - świadomie poza zakresem tej poprawki.
  useEffect(() => {
    if (!city || DEMO || !supabase) return;
    const ch = supabase.channel(`podium-${encodeURIComponent(city)}`) // ASCII - zgodne z nadawcą (App)
      .on("broadcast", { event: "podium" }, ({ payload }) => { if (payload?.results) setPodium(payload); })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [city]);

  const currentQ = questions[gIdx];
  const mod      = MODULES.find((m) => m.id === (currentQ?.module ?? planMod));
  // Czas pytania wyłącznie z planu (SC4); mod służy tylko do nazwy/ikony/koloru.
  const timePerQ = planTpq ?? 0;

  return { phase, gIdx, qNum, qTotal, timer, autoSec, cdNum, firstOfModule, currentQ, questions, mod, timePerQ, reveal, revealTotal, revealCorrect, revealAns, liveCount, participantsTotal, bg, podium, breakNext };
}
