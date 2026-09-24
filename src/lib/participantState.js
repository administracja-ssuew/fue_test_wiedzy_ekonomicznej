import { toMs } from "./plan.js";

// ─── Stan lokalny uczestnika (Faza 6) ─────────────────────────────────────────
// Czyste funkcje bez Supabase — testowalne bez sieci. Uczestnik i zamrożony plan żyją
// w localStorage (przeżywają zamknięcie karty / restart telefonu), a ważność cache
// wyznacza session_id: plan z innej sesji nigdy nie zostanie użyty.

export const PARTICIPANT_KEY = "fue_participant";   // { code, name, surname, city, sessionId? }
export const GAME_CACHE_KEY  = "fue_game_cache";    // { sessionId, plan, session, savedAt }
export const BG_KEY          = "fue_bg";

function readJson(storage, key) {
  const raw = storage.getItem(key);
  if (raw == null) return { ok: false, value: null };
  try { return { ok: true, value: JSON.parse(raw) }; } catch { return { ok: false, value: null, broken: true }; }
}

// localStorage → obiekt | null. Jednorazowa migracja ze starego sessionStorage (sprzed
// fazy 6): bez niej uczestnik zalogowany przed aktualizacją straciłby sesję po refreshu.
export function loadParticipant() {
  try {
    if (localStorage.getItem(PARTICIPANT_KEY) == null) {
      const legacy = sessionStorage.getItem(PARTICIPANT_KEY);
      if (legacy != null) {
        localStorage.setItem(PARTICIPANT_KEY, legacy);
        const bg = sessionStorage.getItem(BG_KEY);
        if (bg != null && localStorage.getItem(BG_KEY) == null) localStorage.setItem(BG_KEY, bg);
        sessionStorage.removeItem(PARTICIPANT_KEY);
        sessionStorage.removeItem(BG_KEY);
      }
    }
    const r = readJson(localStorage, PARTICIPANT_KEY);
    if (r.broken) { localStorage.removeItem(PARTICIPANT_KEY); return null; }
    return r.ok && r.value && typeof r.value === "object" ? r.value : null;
  } catch { return null; }
}

export function saveParticipant(p) {
  try { localStorage.setItem(PARTICIPANT_KEY, JSON.stringify(p)); } catch (_) { /* pełny magazyn — nieistotne */ }
}

export function clearParticipant() {
  for (const k of [PARTICIPANT_KEY, GAME_CACHE_KEY, BG_KEY]) {
    try { localStorage.removeItem(k); } catch (_) { /* nieistotne */ }
    try { sessionStorage.removeItem(k); } catch (_) { /* nieistotne */ }
  }
}

// myAnswers też trafia do cache: po refreshu blokada udzielonej odpowiedzi musi być widoczna
// od pierwszej klatki, a nie dopiero po snapshocie (SC2; sonda 06-08 złapała odblokowane
// kafle przez ~200 ms po reloadzie). Wywołanie bez myAnswers zachowuje te z cache.
export function saveGameCache(sessionId, { plan, session, myAnswers }) {
  if (!sessionId) return;
  try {
    let answers = myAnswers;
    if (answers === undefined) {
      const prev = readJson(localStorage, GAME_CACHE_KEY);
      answers = prev.ok && prev.value?.sessionId === sessionId ? prev.value.myAnswers : null;
    }
    localStorage.setItem(GAME_CACHE_KEY, JSON.stringify({
      sessionId, plan: plan ?? null, session: session ?? null, myAnswers: answers ?? null, savedAt: Date.now(),
    }));
  } catch (_) { /* ~20 KB planu — przy pełnym magazynie po prostu bez cache */ }
}

export function loadGameCache(sessionId) {
  if (!sessionId) return null;
  try {
    const r = readJson(localStorage, GAME_CACHE_KEY);
    if (!r.ok || !r.value || r.value.sessionId !== sessionId) return null;
    return r.value;
  } catch { return null; }
}

// JSON get_participant_state → stan klienta. Znaczniki czasu są już w ms; toMs dla
// bezpieczeństwa (np. gdyby kiedyś przyszedł ISO).
export function normalizeSnapshot(json) {
  const j = json || {};
  const s = j.session || null;
  const session = s ? { ...s, plan_anchor_at: toMs(s.plan_anchor_at), plan_paused_at: toMs(s.plan_paused_at) } : null;
  const myAnswers = {};
  for (const a of j.my_answers || []) {
    myAnswers[a.question_id] = { chosen: a.chosen ?? null, status: "saved", correct: a.is_correct ?? null };
  }
  return {
    session,
    plan: Array.isArray(j.plan) ? j.plan : null,
    myAnswers,
    reveal: j.reveal ?? null,
    correctTotal: Number(j.correct_total) || 0,
    serverNowMs: j.server_now != null ? Number(j.server_now) : null,
    error: j.error ?? null,
  };
}

const ROW_FIELDS = ["status", "plan_anchor_at", "plan_paused_at", "revealed_idx", "revealed_ans"];
const MS_FIELDS = new Set(["plan_anchor_at", "plan_paused_at"]);

// UPDATE quiz_sessions z Realtime → scal do sesji. Pole nieobecne w wierszu zostaje;
// jawny null nadpisuje (wznowienie zeruje plan_paused_at).
export function mergeSessionRow(session, row) {
  const out = { ...(session || {}) };
  for (const k of ROW_FIELDS) {
    if (row && Object.prototype.hasOwnProperty.call(row, k)) out[k] = MS_FIELDS.has(k) ? toMs(row[k]) : row[k];
  }
  return out;
}

// Poprawna odpowiedź dla idx — WYŁĄCZNIE z danych odsłoniętych przez serwer.
export function revealAnsFor(session, reveal, idx) {
  if (idx == null) return null;
  if (session?.revealed_idx != null && session.revealed_idx === idx) return session.revealed_ans ?? null;
  if (reveal?.idx != null && reveal.idx === idx) return reveal.ans ?? null;
  return null;
}

// Czy zmienił się przebieg planu (kotwica / pauza / status). Tolerancja 1 ms na
// zaokrąglenia ISO ↔ epoch ms.
export function planChanged(prev, next) {
  if (!prev || !next) return prev !== next;
  const a = prev.plan_anchor_at, b = next.plan_anchor_at;
  if ((a == null) !== (b == null)) return true;
  if (a != null && Math.abs(a - b) >= 2) return true;
  if ((prev.plan_paused_at ?? null) !== (next.plan_paused_at ?? null)) return true;
  return prev.status !== next.status;
}

// p_session_id dla snapshotu: podpowiedź z Lobby ma pierwszeństwo przed przypiętym id.
export function snapshotSessionId(hint, currentSession) {
  return hint ?? currentSession?.id ?? null;
}

// prev = { session, plan, myAnswers, reveal, correctTotal } → nowy stan + switched.
export function applySnapshot(prev, normalized) {
  const p = prev || {};
  const n = normalized || {};
  const switched = (n.session?.id ?? null) !== (p.session?.id ?? null);
  if (switched) {
    // Inna sesja niż przypięta — nic ze starej nie może przeciec (plan, odpowiedzi, wynik).
    return {
      session: n.session ?? null,
      plan: n.plan ?? null,
      myAnswers: { ...(n.myAnswers || {}) },
      reveal: n.reveal ?? null,
      correctTotal: n.correctTotal || 0,
      switched: true,
    };
  }
  const myAnswers = { ...(n.myAnswers || {}) };
  for (const [qid, a] of Object.entries(p.myAnswers || {})) {
    const srv = myAnswers[qid];
    if (!srv) {
      // Zapis w locie (pending) albo nieudany — serwer jeszcze go nie zna; nie gubimy wyboru.
      if (a.status === "pending" || a.status === "failed") myAnswers[qid] = a;
    } else if (srv.correct == null && a.correct != null && a.chosen === srv.chosen) {
      // Poprawność odsłonięta lokalnie (revealed_*) a snapshot jeszcze przed bramką — zostaw.
      myAnswers[qid] = { ...srv, correct: a.correct };
    }
  }
  return {
    // Snapshot nie niesie revealed_* — zachowaj je z Realtime.
    session: n.session ? { ...(p.session || {}), ...n.session } : null,
    plan: n.plan ?? p.plan ?? null,
    myAnswers,
    reveal: n.reveal ?? p.reveal ?? null,
    correctTotal: n.correctTotal || 0,
    switched: false,
  };
}
