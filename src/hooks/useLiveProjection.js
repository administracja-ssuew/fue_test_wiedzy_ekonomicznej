import { useState, useEffect, useRef } from "react";
import {
  supabase, DEMO,
  getSessionForCity, getCityBg, getLiveQuestionStats, getLiveAnswerSummary, getLiveAnswerCount, getQuestions,
  getParticipantsInSession,
} from "../lib/supabase.js";
import { useModules } from "../context/ModulesContext.jsx";
import { REVEAL_SECONDS, projectLiveState } from "../lib/gameLogic.js";

const DEFAULT_BG = "linear-gradient(160deg,#070215 0%,#0E0435 50%,#070215 100%)";

// Pure projection of the DB session state for any "spectator" view (standalone
// LiveView, admin ghost embed). It runs NO quiz state machine of its own — a single
// 250ms ticker derives phase/timer/countdown from (status, current_question_idx,
// q_started_at, timePerQ). This keeps every spectator perfectly in sync with the
// participants and immune to pause/resume desync or stale module times.
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
  const [autoSec, setAutoSec]     = useState(REVEAL_SECONDS);
  const [bg, setBg]               = useState(DEFAULT_BG);
  const [liveCount, setLiveCount] = useState(0);
  const [participantsTotal, setParticipantsTotal] = useState(0);
  const [cdNum, setCdNum]         = useState(null);
  const [questions, setQuestions] = useState([]);

  const sessionRef       = useRef(null);
  const questionsRef     = useRef([]);
  const modulesRef       = useRef(MODULES);
  const phaseRef         = useRef("waiting");
  const lastIdxRef       = useRef(-1);
  const revealFetchedRef = useRef(-1);
  const liveRef          = useRef(null);

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
        if (sess) sessionRef.current = sess;
      });
  }, [city]); // eslint-disable-line

  // Realtime + poll → keep sessionRef fresh
  useEffect(() => {
    if (!city) return;
    const apply = (s) => { if (s) sessionRef.current = s; };
    if (!DEMO && supabase) {
      const ch = supabase.channel(`live-proj-${city}`)
        .on("broadcast", { event: "quiz_event" }, ({ payload }) => {
          if (!payload?.status) return;
          if (payload.id) apply(payload);
          else getSessionForCity(city).then(apply);
        })
        .on("postgres_changes", {
          event: "UPDATE", schema: "public", table: "quiz_sessions", filter: `city=eq.${city}`,
        }, ({ new: s }) => apply(s))
        .subscribe();
      const poll = setInterval(() => getSessionForCity(city).then(apply), 5000);
      return () => { supabase.removeChannel(ch); clearInterval(poll); };
    }
    const poll = setInterval(() => getSessionForCity(city).then(apply), 3000);
    return () => clearInterval(poll);
  }, [city]); // eslint-disable-line

  // Projection ticker
  useEffect(() => {
    const fetchReveal = async (idx) => {
      const q = questionsRef.current[idx];
      const sid = sessionRef.current?.id;
      if (!sid || !q?.id) return;
      if (detailed) {
        // Admin embed (authenticated): full per-participant list + counts.
        const stats = await getLiveQuestionStats(sid, q.id);
        setReveal(stats.answers || []);
        setRevealTotal(stats.total || 0);
        setRevealCorrect(stats.correct || 0);
      } else {
        // Public projector (anon): aggregate counts only — no per-person data.
        const s = await getLiveAnswerSummary(sid, q.id);
        setRevealTotal(s.total || 0);
        setRevealCorrect(s.correct || 0);
      }
    };

    const tick = () => {
      const { phase: p, idx, timer: t, autoSec: a, cdNum: cd } = projectLiveState({
        session: sessionRef.current,
        questions: questionsRef.current,
        modules: modulesRef.current,
      });

      if (idx !== lastIdxRef.current) {
        lastIdxRef.current = idx;
        revealFetchedRef.current = -1;
        setReveal([]); setLiveCount(0); setRevealTotal(0); setRevealCorrect(0);
      }
      setGIdx(idx);
      setPhase(p);
      setCdNum(cd);
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
  // → odpyt co 5 s. Anon może czytać participant_codes (codes_public_read).
  useEffect(() => {
    if (!city) return;
    const fetchTotal = () => {
      const sid = sessionRef.current?.id;
      if (sid) getParticipantsInSession(city, sid).then((p) => setParticipantsTotal(p.length));
    };
    fetchTotal();
    const iv = setInterval(fetchTotal, 5000);
    return () => clearInterval(iv);
  }, [city]);

  const currentQ = questions[gIdx];
  const mod      = MODULES.find((m) => m.id === currentQ?.module);
  const timePerQ = mod?.timePerQ || 60;

  return { phase, gIdx, timer, autoSec, cdNum, currentQ, questions, mod, timePerQ, reveal, revealTotal, revealCorrect, liveCount, participantsTotal, bg };
}
