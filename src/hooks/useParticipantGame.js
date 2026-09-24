import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { DEMO, supabase, getParticipantState, submitAnswerV2 } from "../lib/supabase.js";
import { projectPlanState, REVEAL_GATE_MS } from "../lib/plan.js";
import { serverNow, addClockSample } from "../lib/serverClock.js";
import {
  loadGameCache, saveGameCache, saveParticipant,
  normalizeSnapshot, mergeSessionRow, revealAnsFor, applySnapshot, snapshotSessionId,
} from "../lib/participantState.js";

// ─── useParticipantGame (Faza 6) ──────────────────────────────────────────────
// Jedyne źródło fazy dla ekranu uczestnika. Model:
//  • PRAWDA = snapshot get_participant_state (plan + kotwica + moje odpowiedzi + reveal).
//  • Realtime to tylko SYGNAŁ „coś się zmieniło” (kanał publiczny — payloadu nie ufamy,
//    poza polami wiersza quiz_sessions z postgres_changes, które przechodzą przez RLS).
//  • Faza liczona lokalnie co klatkę z planu i serverNow() — działa też offline (SC3).
// Hook nie zna czasów modułów: wszystkie terminy są w zamrożonym planie (SC4).

const EMPTY_GAME = { session: null, plan: null, myAnswers: {}, reveal: null, correctTotal: 0 };
const SAFETY_NET_MS = 15000;
const RETRY_MS = 700;

// Liczba poprawnych = wpisy z correct === true (snapshot + lokalnie odsłonięte), więc
// odpowiedź nigdy nie jest liczona dwa razy.
function withCorrectTotal(g) {
  const correctTotal = Object.values(g.myAnswers || {}).filter((a) => a?.correct === true).length;
  return { ...g, correctTotal };
}

function computeView(g) {
  const s = g.session;
  if (!s) return { phase: "no_session" };
  return projectPlanState({
    items: g.plan, anchorMs: s.plan_anchor_at, pausedAtMs: s.plan_paused_at,
    status: s.status, nowMs: serverNow(),
  });
}

function viewKey(g, v) {
  return `${g.session?.id ?? ""}|${v.phase}|${v.idx ?? ""}|${v.secondsLeft ?? ""}|${v.opensAt ?? ""}`;
}

// View Transitions tylko gdy przeglądarka je ma, karta jest widoczna i użytkownik nie
// prosi o ograniczenie ruchu (prefers-reduced-motion). Brak = zwykła zmiana stanu.
function canViewTransition() {
  if (typeof document === "undefined" || typeof window === "undefined") return false;
  if (!("startViewTransition" in document) || document.hidden) return false;
  try {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  } catch (_) { /* brak matchMedia — traktujemy jak brak ograniczeń */ }
  return true;
}

// URL-e obrazków z wartości CSS tła (np. `url("…") center/cover, linear-gradient(…)`).
function bgImageUrls(...values) {
  const out = [];
  for (const v of values) {
    if (typeof v !== "string" || !v.includes("url(")) continue;
    const re = /url\(\s*(['"]?)(.*?)\1\s*\)/g;
    let m;
    while ((m = re.exec(v)) !== null) if (m[2]) out.push(m[2]);
  }
  return out;
}

function initialGame(participant) {
  // Inicjalizacja SYNCHRONICZNA z cache: po refreshu pierwsza klatka pokazuje już
  // właściwą fazę z zapamiętanego planu, zanim wróci snapshot (SC2 — brak pustego ekranu).
  const c = participant?.sessionId ? loadGameCache(participant.sessionId) : null;
  if (!c?.session) return EMPTY_GAME;
  return { ...EMPTY_GAME, session: c.session, plan: c.plan ?? null };
}

export default function useParticipantGame(participant) {
  const [game, setGame] = useState(() => initialGame(participant));
  const [view, setView] = useState(() => computeView(initialGame(participant)));
  const [loadState, setLoadState] = useState(participant ? "loading" : "idle");

  const gameRef = useRef(game);
  const viewRef = useRef(view);
  const viewKeyRef = useRef(viewKey(game, view));
  const participantRef = useRef(participant);
  const loadStateRef = useRef(loadState);
  participantRef.current = participant;

  const inFlightRef = useRef(false);
  const pendingRef = useRef(null);            // jedno oczekujące wywołanie (najnowszy hint)
  const jitterRef = useRef(null);             // { timer, opts } — scalony rozrzucony snapshot
  const timeoutsRef = useRef(new Set());
  const disposedRef = useRef(false);
  const emptySentRef = useRef(new Set());     // item.id z wysłanym pustym zapisem
  const revealMissRef = useRef(new Set());    // idx, dla których dociągnięto brakujący reveal
  const planLoadRef = useRef(null);           // kotwica, dla której dociągamy plan

  // Publikacja nowego widoku. Zmiana fazy lub pytania (nie sam tik sekund) idzie przez
  // View Transitions. Pułapka 10: w React 18 setState jest asynchroniczny — bez flushSync
  // przeglądarka zrobiłaby zrzut „po” przed renderem (brak animacji / mignięcie).
  // Callback przejścia odpala się asynchronicznie, więc ustawia NAJNOWSZY widok z refa —
  // widok podmieniony w międzyczasie nie zostanie nadpisany starszym.
  const pushView = useCallback((v, k) => {
    const prev = viewRef.current;
    viewKeyRef.current = k;
    viewRef.current = v;
    const structural = prev?.phase !== v.phase || prev?.idx !== v.idx;
    if (structural && canViewTransition()) {
      try {
        document.startViewTransition(() => flushSync(() => setView(viewRef.current)));
        return;
      } catch (_) { /* przejście niedostępne — zwykła zmiana stanu */ }
    }
    setView(v);
  }, []);

  const commit = useCallback((next) => {
    gameRef.current = next;
    setGame(next);
    // Natychmiastowe przeliczenie widoku (nie czekamy na kolejną klatkę rAF).
    const v = computeView(next);
    const k = viewKey(next, v);
    if (k !== viewKeyRef.current) pushView(v, k);
  }, [pushView]);

  const setLoad = useCallback((s) => { loadStateRef.current = s; setLoadState(s); }, []);

  const later = useCallback((fn, ms) => {
    const t = setTimeout(() => { timeoutsRef.current.delete(t); fn(); }, ms);
    timeoutsRef.current.add(t);
    return t;
  }, []);

  // ── Snapshot ────────────────────────────────────────────────────────────────
  const snapshot = useCallback(async ({ includePlan, sessionIdHint } = {}) => {
    const p = participantRef.current;
    if (!p?.code || disposedRef.current) return;
    // Scalanie równoległych wywołań: jedno w locie + jedno oczekujące (z najnowszym hintem).
    if (inFlightRef.current) {
      const prev = pendingRef.current;
      pendingRef.current = {
        includePlan: !!(prev?.includePlan || includePlan),
        sessionIdHint: sessionIdHint ?? prev?.sessionIdHint,
      };
      return;
    }
    inFlightRef.current = true;
    let needPlan = false;
    try {
      const cur = gameRef.current;
      let inc = includePlan ?? !cur.plan;
      if (!cur.plan) inc = true;                                        // bez planu nie ma fazy
      if (sessionIdHint && sessionIdHint !== cur.session?.id) inc = true; // inna sesja = inny plan
      const { data, error, t0, t1 } = await getParticipantState(p.code, {
        sessionId: snapshotSessionId(sessionIdHint, cur.session), includePlan: inc,
      });
      if (disposedRef.current || participantRef.current?.code !== p.code) return;
      if (error || !data) {
        // Offline / błąd: projekcja z planu w pamięci działa dalej; „error” tylko gdy
        // nie mamy czego pokazać.
        if (!gameRef.current.session) setLoad("error");
        return;
      }
      addClockSample({ t0, t1, serverMs: Number(data.server_now) });
      if (data.error === "invalid code") { setLoad("invalid_code"); return; }

      const next = applySnapshot(gameRef.current, normalizeSnapshot(data));
      const { switched, ...g } = next;
      if (switched) {
        // Serwer zwrócił inną sesję niż przypięta (np. przypięta próba jest `ended`, a admin
        // utworzył nową) — refy per-sesja od zera, żeby nic ze starej sesji nie przeciekło.
        emptySentRef.current.clear();
        revealMissRef.current.clear();
        planLoadRef.current = null;
        if (g.session?.plan_anchor_at != null && !g.plan) needPlan = true;
      }
      commit(withCorrectTotal(g));
      if (g.session) saveGameCache(g.session.id, { plan: g.plan, session: g.session });
      // Przypinamy zawsze to, co zwrócił serwer (sam porzuca nieaktualne przypięcie, 39.6b).
      // NIE czyścimy id przy `ended` — zniknąłby ekran wyników.
      saveParticipant({ ...p, sessionId: g.session?.id ?? null });
      setLoad("ready");
    } finally {
      inFlightRef.current = false;
      if (needPlan) {
        const prev = pendingRef.current;
        pendingRef.current = { includePlan: true, sessionIdHint: prev?.sessionIdHint };
      }
      const pend = pendingRef.current;
      pendingRef.current = null;
      if (pend && !disposedRef.current) snapshot(pend);
    }
  }, [commit, setLoad]);

  // Snapshot z losowym opóźnieniem 0..maxMs. Sygnał Realtime dociera do ~500 telefonów
  // naraz — bez rozrzutu to 500 jednoczesnych RPC (na starcie z ~20 KB planu każdy).
  // Kolejne rozrzucone wywołania przed odpaleniem scalają się w jedno.
  const snapshotJittered = useCallback((opts = {}, maxMs = 1000) => {
    const j = jitterRef.current;
    if (j) {
      j.opts = { includePlan: !!(j.opts.includePlan || opts.includePlan), sessionIdHint: opts.sessionIdHint ?? j.opts.sessionIdHint };
      return;
    }
    const entry = { opts: { ...opts }, timer: null };
    jitterRef.current = entry;
    entry.timer = later(() => {
      if (jitterRef.current === entry) jitterRef.current = null;
      snapshot(entry.opts);
    }, Math.random() * maxMs);
  }, [later, snapshot]);

  const refresh = useCallback(
    (sessionIdHint) => snapshot({ includePlan: !gameRef.current.plan, sessionIdHint }),
    [snapshot],
  );

  // ── Montaż / zmiana uczestnika ──────────────────────────────────────────────
  const code = participant?.code ?? null;
  const mountedCodeRef = useRef(code);
  useEffect(() => {
    disposedRef.current = false;
    if (mountedCodeRef.current !== code) {
      // Inny uczestnik niż przy inicjalizacji — stan od nowa z jego cache.
      mountedCodeRef.current = code;
      emptySentRef.current.clear(); revealMissRef.current.clear(); planLoadRef.current = null;
      commit(initialGame(participantRef.current));
    }
    if (!code) { setLoad("idle"); return undefined; }
    if (loadStateRef.current === "idle") setLoad("loading");
    snapshot({}); // bez jitteru — akcja jednego klienta

    // Powrót karty / sieci (Pułapka 11): telefon z zablokowanym ekranem albo po zmianie
    // Wi-Fi → LTE ma przespane zdarzenia — jeden snapshot nadrabia wszystko.
    const onVisible = () => { if (!document.hidden) snapshot({}); };
    const onOnline = () => snapshot({});
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [code, commit, setLoad, snapshot]);

  // Sprzątanie przy odmontowaniu.
  useEffect(() => () => {
    disposedRef.current = true;
    for (const t of timeoutsRef.current) clearTimeout(t);
    timeoutsRef.current.clear();
    jitterRef.current = null;
  }, []);

  // ── Ticker rAF ─────────────────────────────────────────────────────────────
  // Faza z projekcji planu co klatkę, ale setView TYLKO przy zmianie klucza
  // (faza | idx | sekundy | otwarcie) — nie 60 renderów na sekundę. Zmiana fazy/pytania
  // przechodzi przez View Transitions (pushView), sam tik sekund — zwykłe setView.
  useEffect(() => {
    const raf = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
    const caf = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout;
    let id = null;
    const tick = () => {
      const g = gameRef.current;
      const v = computeView(g);
      const k = viewKey(g, v);
      if (k !== viewKeyRef.current) pushView(v, k);
      id = raf(tick);
    };
    id = raf(tick);
    return () => caf(id);
  }, [pushView]);

  // ── Prefetch ───────────────────────────────────────────────────────────────
  // Treść WSZYSTKICH pytań (q/opts) przychodzi w planie ze snapshotu i leży w cache
  // localStorage, więc następne pytanie jest lokalnie dostępne na długo przed otwarciem —
  // osobne pobieranie pytań byłoby zbędnym ruchem (×500 telefonów). Jedyne, co jeszcze
  // może dociągać się z sieci w chwili zmiany ekranu, to grafika tła sesji: wczytujemy ją
  // z wyprzedzeniem raz na sesję, żeby pierwszy ekran modułu nie mrugał pustym tłem.
  const prefetchedRef = useRef(null);
  const bgSessionId = game.session?.id ?? null;
  const bgDesktop = game.session?.bg ?? null;
  const bgMobile = game.session?.bg_mobile ?? null;
  useEffect(() => {
    if (!bgSessionId || prefetchedRef.current === bgSessionId) return;
    const urls = bgImageUrls(bgDesktop, bgMobile);
    if (!urls.length || typeof Image === "undefined") return;
    prefetchedRef.current = bgSessionId;
    for (const url of urls) {
      try { const img = new Image(); img.decoding = "async"; img.src = url; } catch (_) { /* nieistotne */ }
    }
  }, [bgSessionId, bgDesktop, bgMobile]);

  // ── Kanał Realtime (sygnał) + dozorca + siatka bezpieczeństwa ───────────────
  const sessionId = game.session?.id ?? null;
  useEffect(() => {
    if (!code || !sessionId) return undefined;

    if (DEMO) {
      // DEMO: brak Realtime — snapshot z localStorage co 1 s (tani, lokalny).
      const poll = setInterval(() => snapshot({ includePlan: false }), 1000);
      return () => clearInterval(poll);
    }

    let disposed = false;
    let ch = null;
    let subscribedOnce = false;

    const onRow = ({ new: row }) => {
      if (!row) return;
      const g = gameRef.current;
      if (g.session?.id !== sessionId) return;
      const prevStatus = g.session.status;
      const merged = mergeSessionRow(g.session, row);
      commit({ ...g, session: merged });
      saveGameCache(sessionId, { plan: g.plan, session: merged });
      // Koniec sesji → finalne is_correct / correct_total ze snapshotu.
      if ((merged.status === "results" || merged.status === "ended") && prevStatus !== merged.status) {
        snapshotJittered({ includePlan: false }, 1000);
      }
      // Kotwica przyszła przed planem (start sesji) → faza plan_loading + dociągnięcie planu.
      if (merged.plan_anchor_at != null && !g.plan) {
        planLoadRef.current = merged.plan_anchor_at;
        snapshotJittered({ includePlan: true }, 1000);
      }
    };

    const connect = () => {
      if (disposed) return;
      // Socket mógł zostać rozłączony przez removeChannel innego ekranu (lista kanałów
      // pusta → supabase-js zamyka socket) — bez tego subscribe() wisiałby na martwym.
      try { supabase.realtime.connect(); } catch (_) { /* nieistotne */ }
      ch = supabase.channel(`quiz-${sessionId}`)
        // Broadcast to tylko SYGNAŁ — kanał publiczny, payload mógłby być sfałszowany.
        .on("broadcast", { event: "quiz_event" }, () => snapshotJittered({ includePlan: false }, 1000))
        .on("postgres_changes", {
          event: "UPDATE", schema: "public", table: "quiz_sessions", filter: `id=eq.${sessionId}`,
        }, onRow)
        .subscribe((status) => {
          if (status !== "SUBSCRIBED" || disposed) return;
          // Pierwsze SUBSCRIBED pokrywa snapshot z montażu; każde kolejne = powrót po
          // zerwaniu (masowe po restarcie serwera Realtime) → nadrabiamy z rozrzutem.
          if (subscribedOnce) snapshotJittered({ includePlan: false }, 2000);
          subscribedOnce = true;
        });
    };
    connect();

    // Dozorca (wzorzec z App.jsx): kanał nie jest i nie staje się połączony → odtwórz.
    // Snapshot nadrabiający odpali ponowne SUBSCRIBED; dodatkowo rozrzucony tu na wypadek,
    // gdy kanał długo nie wraca (wywołania rozrzucone scalają się w jedno).
    const watchdog = setInterval(() => {
      if (disposed) return;
      const st = ch?.state;
      if (st === "joined" || st === "joining") return;
      try { supabase.removeChannel(ch); } catch (_) { /* nieistotne */ }
      subscribedOnce = true;
      connect();
      snapshotJittered({ includePlan: false }, 2000);
    }, 3000);

    // Siatka bezpieczeństwa co 15 s, start z losowym przesunięciem 0–15 s, żeby 500
    // telefonów nie pytało serwera w tej samej sekundzie.
    let net = null;
    const netStart = setTimeout(() => {
      if (disposed) return;
      snapshot({ includePlan: false });
      net = setInterval(() => snapshot({ includePlan: false }), SAFETY_NET_MS);
    }, Math.random() * SAFETY_NET_MS);

    return () => {
      disposed = true;
      try { supabase.removeChannel(ch); } catch (_) { /* nieistotne */ }
      clearInterval(watchdog);
      clearTimeout(netStart);
      if (net) clearInterval(net);
    };
  }, [code, sessionId, commit, snapshot, snapshotJittered]);

  // ── Reakcje na zmianę widoku ────────────────────────────────────────────────
  useEffect(() => {
    const g = gameRef.current;
    const v = view;

    // Kotwica bez planu (np. cache sprzed startu) → dociągnij plan, raz na kotwicę.
    if (v.phase === "plan_loading") {
      const anchor = g.session?.plan_anchor_at ?? null;
      if (planLoadRef.current !== anchor) {
        planLoadRef.current = anchor;
        snapshotJittered({ includePlan: true }, 1000);
      }
      return;
    }
    if (!v.item || loadStateRef.current !== "ready") return;
    const underReveal = v.phase === "reveal" || (v.phase === "paused" && v.underPhase === "reveal");

    // Pusty zapis po deadline (Pułapka 7): brak odpowiedzi → serwer zapisuje timeout, żeby
    // wyniki miały komplet wierszy. Rozrzut 0–1000 ms, raz na pytanie, bez zmiany UI.
    if (underReveal && !g.myAnswers[v.item.id] && !emptySentRef.current.has(v.item.id)) {
      const qid = v.item.id;
      const sid = g.session?.id;
      const p = participantRef.current;
      emptySentRef.current.add(qid);
      later(() => {
        if (!p || gameRef.current.session?.id !== sid || gameRef.current.myAnswers[qid]) return;
        submitAnswerV2({
          sessionId: sid, participantCode: p.code, participantName: `${p.name ?? ""} ${p.surname ?? ""}`.trim(),
          questionId: qid, chosen: null,
        });
      }, Math.random() * 1000);
    }

    // Brak poprawnej odpowiedzi długo po bramce (Pułapka 2: zgubione UPDATE z revealed_*)
    // → jeden rozrzucony snapshot na pytanie.
    if (v.phase === "reveal" && revealAnsFor(g.session, g.reveal, v.idx) == null
        && serverNow() > v.closesAt + 3000 && !revealMissRef.current.has(v.idx)) {
      revealMissRef.current.add(v.idx);
      snapshotJittered({ includePlan: false }, 1000);
    }
  }, [view, later, snapshotJittered]);

  // Poprawność moich odpowiedzi WYŁĄCZNIE z danych odsłoniętych przez serwer
  // (revealed_* z Realtime albo reveal ze snapshotu) — nigdy z odpowiedzi submit.
  useEffect(() => {
    const g = gameRef.current;
    if (!g.plan || !g.session) return;
    const pairs = [
      [g.session.revealed_idx, g.session.revealed_ans],
      [g.reveal?.idx, g.reveal?.ans],
    ];
    let changed = false;
    const myAnswers = { ...g.myAnswers };
    for (const [idx, ans] of pairs) {
      if (idx == null || ans == null) continue;
      const item = g.plan[idx];
      const a = item && myAnswers[item.id];
      if (!a || a.correct != null) continue;
      myAnswers[item.id] = { ...a, correct: a.chosen != null && a.chosen === ans };
      changed = true;
    }
    if (changed) commit(withCorrectTotal({ ...g, myAnswers }));
  }, [game.session, game.reveal, game.plan, game.myAnswers, commit]);

  // ── Wybór odpowiedzi ───────────────────────────────────────────────────────
  const setAnswer = useCallback((sid, qid, patch) => {
    const g = gameRef.current;
    if (g.session?.id !== sid) return; // sesja przełączona w międzyczasie
    const prev = g.myAnswers[qid] || {};
    commit(withCorrectTotal({ ...g, myAnswers: { ...g.myAnswers, [qid]: { ...prev, ...patch } } }));
  }, [commit]);

  const pick = useCallback((choice) => {
    const v = viewRef.current;
    const g = gameRef.current;
    const p = participantRef.current;
    if (!p || v.phase !== "quiz" || !v.item || !g.session) return false;
    const qid = v.item.id;
    if (g.myAnswers[qid]) return false;
    const sid = g.session.id;
    // Optymistyczna blokada: wybór widoczny od razu, zapis w tle.
    setAnswer(sid, qid, { chosen: choice, status: "pending", correct: null });

    const wait = (ms) => new Promise((r) => later(r, ms));
    (async () => {
      for (;;) {
        if (disposedRef.current || gameRef.current.session?.id !== sid) return;
        const r = await submitAnswerV2({
          sessionId: sid, participantCode: p.code,
          participantName: `${p.name ?? ""} ${p.surname ?? ""}`.trim(),
          questionId: qid, chosen: choice,
        });
        if (disposedRef.current) return;
        if (r.accepted) {
          // Duplikat → obowiązuje wybór zapisany wcześniej na serwerze.
          setAnswer(sid, qid, { chosen: r.chosen ?? choice, status: "saved" });
          return;
        }
        if (!r.retryable) { setAnswer(sid, qid, { status: "failed" }); return; }

        if (/session paused/i.test(r.error || "")) {
          // Pauza: czekamy, aż to samo pytanie znów będzie w fazie quiz (wznowienie
          // przesuwa kotwicę, więc closesAt liczymy na nowo), i ponawiamy.
          for (;;) {
            await wait(RETRY_MS);
            if (disposedRef.current || gameRef.current.session?.id !== sid) return;
            const cv = viewRef.current;
            if (cv.item?.id === qid && cv.phase === "quiz") break;
            if (cv.item?.id === qid && cv.phase === "paused") continue;
            // Po wznowieniu pytanie już się skończyło — ostatnia próba tylko w strefie tolerancji.
            if (cv.item?.id === qid && serverNow() <= cv.closesAt + REVEAL_GATE_MS) break;
            setAnswer(sid, qid, { status: "failed" });
            return;
          }
          continue;
        }

        // Błąd sieci: ponawiaj do closes_at + 1,5 s (strefa tolerancji serwera).
        const cv = viewRef.current;
        const closesAt = cv.item?.id === qid ? cv.closesAt : v.closesAt;
        if (serverNow() + RETRY_MS > closesAt + REVEAL_GATE_MS) {
          setAnswer(sid, qid, { status: "failed" });
          return;
        }
        await wait(RETRY_MS);
      }
    })();
    return true;
  }, [later, setAnswer]);

  const revealAns = view.idx != null ? revealAnsFor(game.session, game.reveal, view.idx) : null;

  return {
    loadState,
    session: game.session,
    plan: game.plan,
    view,
    myAnswers: game.myAnswers,
    correctTotal: game.correctTotal,
    revealAns,
    pick,
    refresh,
  };
}
