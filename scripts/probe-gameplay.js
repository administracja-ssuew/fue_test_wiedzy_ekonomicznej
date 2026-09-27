/**
 * FUE Quiz — SONDA ROZGRYWKI (end-to-end, prawdziwe przeglądarki)
 *
 * Uruchamia realną rozgrywkę: panel admina + N telefonów w osobnych kontekstach
 * przeglądarki, próbkuje ich ekrany co 250 ms i sprawdza, czy quiz jest PŁYNNY:
 *   • czy pytanie trwa tyle, ile ma trwać (czas modułu + okno odsłonięcia),
 *   • czy host widzi to samo pytanie co telefony,
 *   • czy telefony są ze sobą zsynchronizowane co do sekundy,
 *   • czy quiz nigdzie nie staje,
 *   • czy socket Realtime uczestnika ŻYJE przez cały przebieg.
 *
 * Ten ostatni punkt jest powodem, dla którego sonda w ogóle powstała. 23.09.2026
 * socket uczestnika umierał 0,9 s po starcie quizu i nigdy nie wracał — telefon
 * żył z polla co 10 s, zastygał na skończonym pytaniu i wskakiwał w kolejne
 * w locie. Żadna analiza kodu tego nie pokazała; pokazało dopiero podsłuchanie
 * ramek WebSocket. Dlatego sonda ich pilnuje na stałe.
 *
 * WYMAGA URUCHOMIONEJ APLIKACJI:
 *   npm run build && npm run preview          (w osobnym terminalu)
 *
 * CEL: staging NIE ISTNIEJE (klucze *_STAGE wskazują martwy projekt), a sonda bez
 * PROBE_TARGET preferuje staging. Dlatego ZAWSZE jawnie PROBE_TARGET=prod
 * + PROBE_CONFIRM=1. Sonda zakłada własne pytania, kody i konto admina, a po przebiegu
 * kasuje wszystko, co utworzyła (także plan sesji w session_plans), i przywraca sesję
 * miasta do stanu sprzed testu (łącznie z plan_anchor_at/plan_paused_at/revealed_*).
 *
 *   PowerShell:
 *     $env:PROBE_TARGET="prod"; $env:PROBE_CONFIRM="1"; npm run sonda
 *     $env:PROBE_TARGET="prod"; $env:PROBE_CONFIRM="1"; $env:PROBE_ADMIN_EXIT="1"; npm run sonda
 *   Bash:
 *     PROBE_TARGET=prod PROBE_CONFIRM=1 npm run sonda
 *     PROBE_TARGET=prod PROBE_CONFIRM=1 PROBE_REFRESH=1 PROBE_PHONES=2 npm run sonda
 *
 *   Pauza w zadanej fazie (diagnoza G2) + ślad przyczynowy (diagnoza G7):
 *   PowerShell:
 *     $env:PROBE_TARGET="prod"; $env:PROBE_CONFIRM="1"; $env:PROBE_PAUSE_PHASE="reveal"; $env:PROBE_TRACE="1"; npm run sonda
 *     $env:PROBE_TARGET="prod"; $env:PROBE_CONFIRM="1"; $env:PROBE_PAUSE_PHASE="countdown"; $env:PROBE_TPQ="60"; npm run sonda
 *   Bash:
 *     PROBE_TARGET=prod PROBE_CONFIRM=1 PROBE_PAUSE_PHASE=reveal PROBE_TRACE=1 npm run sonda
 *     PROBE_TARGET=prod PROBE_CONFIRM=1 PROBE_PAUSE_PHASE=countdown PROBE_PAUSE_Q=2 PROBE_TPQ=60 npm run sonda
 *
 *   Kod wyjścia: 0 = PASS, 1 = FAIL, 2 = przebieg pauzy NIEWYKONANY (pauza nie trafiła w
 *   zadaną fazę albo okno kliknięcia minęło) — taki przebieg się powtarza, nie jest wynikiem.
 *
 * Zmienne:
 *   PROBE_TARGET=prod                     cel (jawnie — staging nie istnieje)
 *   PROBE_CONFIRM=1                       świadoma zgoda na przebieg na produkcji
 *   PROBE_APP_URL=http://localhost:4173   adres działającej aplikacji
 *   PROBE_CITY=Kraków                     miasto testowe (musi być z listy CITIES)
 *   PROBE_PHONES=2                        ile telefonów
 *   PROBE_QUESTIONS=3                     ile pytań zasiać
 *   PROBE_TPQ=20                          czas pytania na czas testu (FULL/OFFLINE albo jawnie)
 *   PROBE_RUN_MS=150000                   maksymalny czas przebiegu
 *   PROBE_FULL=1                          pełna ścieżka: 5 modułów, pauza/wznowienie, wyniki
 *   PROBE_ADMIN_EXIT=1                    (SC1) po starcie zamyka przeglądarkę admina — quiz
 *                                         ma dojść do wyników sam (zamiatacz pg_cron)
 *   PROBE_REFRESH=1                       (SC2) telefon 2 robi reload w każdej fazie
 *                                         (intro, countdown, quiz przed/po odpowiedzi, reveal)
 *   PROBE_OFFLINE=1                       (SC3) telefon 2 jest 10 s offline w pytaniu 2
 *                                         i odpowiada w trakcie offline
 *   PROBE_PAUSE_PHASE=reveal|countdown    (G2) pauza admina w zadanej fazie pytania PROBE_PAUSE_Q:
 *                                         reveal TEGO pytania albo odliczanie PO nim; asercje P1–P6
 *                                         (wejście w pauzę, pytanie w pauzie, stan po wznowieniu,
 *                                         ucieczka z pauzy / utknięcie w pauzie, faza lądowania).
 *                                         Wymaga przeglądarki admina — nie łączy się z PROBE_ADMIN_EXIT.
 *   PROBE_PAUSE_Q=2                       numer pytania (1-based) dla PROBE_PAUSE_PHASE
 *   PROBE_PAUSE_HOLD_MS=8000              jak długo trzymać pauzę przed „Wznów quiz”
 *   PROBE_TRACE=1                         ślad zmian stanu + DIAGNOZA przyczynowa (View Transitions,
 *                                         offset zegara telefonu, snapshot vs Realtime, start z DOM)
 *                                         i zrzut surowych danych do test-results/probe-trace-*.json
 * PROBE_FULL przechodzi też przez przerwy planowe po modułach 2 i 4 (klika „Wznów quiz” po 5 s).
 * Tryby łączą się ze sobą i z PROBE_FULL. Każdy przebieg sprawdza też SC5: przed końcem
 * czasu pytania ani submit_answer_v2, ani snapshot, ani summary nie ujawniają poprawności.
 */

import fs from "node:fs";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { planPosition, toMs } from "../src/lib/plan.js";

// PROBE_TARGET=stage|prod. Domyślnie staging, jeśli klucze *_STAGE są w .env.
// Jawny wybór jest potrzebny, bo staging bywa wyłączony, a wtedy „preferuj staging"
// kieruje sondę pod martwy adres.
const wantStage = process.env.PROBE_TARGET
  ? process.env.PROBE_TARGET === "stage"
  : !!process.env.VITE_SUPABASE_URL_STAGE;
const STAGE = wantStage && !!process.env.VITE_SUPABASE_URL_STAGE;
const URL_SB = STAGE ? process.env.VITE_SUPABASE_URL_STAGE : process.env.VITE_SUPABASE_URL;
const ANON = STAGE ? process.env.VITE_SUPABASE_ANON_KEY_STAGE : process.env.VITE_SUPABASE_ANON_KEY;
const SVC = STAGE ? process.env.SUPABASE_SERVICE_KEY_STAGE : process.env.SUPABASE_SERVICE_KEY;

const APP = process.env.PROBE_APP_URL || "http://localhost:4173";
const CITY = process.env.PROBE_CITY || "Kraków";
// Tryby z ROADMAP fazy 6 (łączą się ze sobą i z PROBE_FULL):
//   PROBE_ADMIN_EXIT=1 (SC1) — admin zamyka przeglądarkę po starcie,
//   PROBE_REFRESH=1    (SC2) — telefon 2 robi reload w każdej fazie,
//   PROBE_OFFLINE=1    (SC3) — telefon 2 (albo 3, gdy razem z REFRESH) 10 s offline w pytaniu 2.
//   PROBE_PAUSE_PHASE=reveal|countdown (G2) — pauza w zadanej fazie pytania PROBE_PAUSE_Q (P1–P6),
//   PROBE_TRACE=1      (G7) — ślad przyczynowy per telefon (VT, zegar, snapshot vs Realtime, DOM).
// Telefon 1 jest zawsze referencyjny.
const ADMIN_EXIT = process.env.PROBE_ADMIN_EXIT === "1";
const REFRESH = process.env.PROBE_REFRESH === "1";
const OFFLINE = process.env.PROBE_OFFLINE === "1";
const TRACE = process.env.PROBE_TRACE === "1";
const PAUSE_PHASE = process.env.PROBE_PAUSE_PHASE || "";
if (!["", "reveal", "countdown"].includes(PAUSE_PHASE)) {
  console.error(`❌ PROBE_PAUSE_PHASE="${PAUSE_PHASE}" — dozwolone: reveal, countdown.`);
  process.exit(1);
}
if (PAUSE_PHASE && ADMIN_EXIT) {
  console.error("❌ PROBE_PAUSE_PHASE wymaga przeglądarki admina — nie łącz z PROBE_ADMIN_EXIT.");
  process.exit(1);
}
const PAUSE_Q = Math.max(1, parseInt(process.env.PROBE_PAUSE_Q || "2", 10));   // 1-based
const PAUSE_HOLD_MS = parseInt(process.env.PROBE_PAUSE_HOLD_MS || "8000", 10);
const MIN_PHONES = REFRESH && OFFLINE ? 3 : REFRESH || OFFLINE ? 2 : 1;
const PHONES = Math.max(MIN_PHONES, parseInt(process.env.PROBE_PHONES || "2", 10));
const REF_PI = 1;                        // telefon testowany w REFRESH (indeks 0-based)
const OFF_PI = REFRESH ? 2 : 1;          // telefon testowany w OFFLINE
// PROBE_FULL=1 — pełna ścieżka wydarzenia: wszystkie 5 modułów, zapowiedzi modułów,
// pauza i wznowienie, ogłoszenie wyników, ekran końcowy. Domyślnie sonda robi szybki
// przebieg na jednym module (sensowny jako bramka przed każdym deployem).
const FULL = process.env.PROBE_FULL === "1";
const QPM = Math.max(1, parseInt(process.env.PROBE_QPM || "2", 10));   // pytań na moduł (full)
// REFRESH potrzebuje 3 pytań (intro/quiz pyt.1, countdown/quiz-po-odpowiedzi pyt.2, reveal pyt.3),
// OFFLINE — 2 (offline w pytaniu 2).
// PAUSE_PHASE potrzebuje pytania PAUSE_Q i następnego (odliczanie / stan po wznowieniu).
// (FULL sieje zawsze QPM × 5 pytań — PAUSE_Q musi się w nich zmieścić, inaczej przebieg NIEWYKONANY.)
const NQ = FULL ? QPM * 5
  : Math.max(REFRESH ? 3 : OFFLINE ? 2 : 1, PAUSE_PHASE ? PAUSE_Q + 1 : 1, parseInt(process.env.PROBE_QUESTIONS || "3", 10));
const TPQ_OVERRIDE = parseInt(process.env.PROBE_TPQ || "20", 10);      // czas modułu na czas testu
// OFFLINE: powrót (5 s + 10 s od otwarcia pytania) musi wypaść przed terminem pytania,
// więc czas pytania ustawiamy jawnie (domyślnie 20 s), niezależnie od konfiguracji produkcji.
const OVERRIDE_TPQ = FULL || OFFLINE || !!process.env.PROBE_TPQ;
// FULL: przerwy planowe po modułach 2 i 4 + reveal 11,5 s (sekcja 42) → 900000.
// PAUSE_PHASE: 3 pytania + pauza; przy PROBE_TPQ=60 sam plan to ~233 s, więc 360000
// (pętla i tak kończy się na ekranie wyników — limit to tylko bezpiecznik).
const RUN_MS = parseInt(process.env.PROBE_RUN_MS || (FULL ? "900000" : PAUSE_PHASE ? "360000" : "150000"), 10);
const TAG = "[SONDA]";

if (!URL_SB || !ANON || !SVC) {
  console.error("❌ Brak kluczy Supabase w .env (URL / ANON / SERVICE).");
  process.exit(1);
}
if (!STAGE && process.env.PROBE_CONFIRM !== "1") {
  console.error("⛔ Brak kluczy *_STAGE — sonda uderzyłaby w PRODUKCJĘ.");
  console.error(`   Cel: ${URL_SB}`);
  console.error("   Sonda zakłada i kasuje własne pytania, kody i konto admina,");
  console.error("   a sesję miasta przywraca do stanu sprzed testu — ale to wciąż produkcja.");
  console.error("   Świadomie? Ustaw PROBE_CONFIRM=1.");
  process.exit(1);
}

const svc = createClient(URL_SB, SVC, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const projectRef = new global.URL(URL_SB).hostname.split(".")[0];

const state = {
  adminId: null, adminEmail: null, adminPass: null, qIds: [], codes: [], sessionId: null, sessionBefore: null, modulesBefore: [],
  plan: null, anchorMs: null,   // zamrożony plan sesji (session_plans.items) i kotwica z bazy
  clockOff: 0,                  // zegar serwera − zegar sondy (ms), jak serverNow() w aplikacji
  monitor: [],                  // odczyty wiersza sesji co 1 s: { srv, status, idx, anchorMs, pausedMs }
  sc5: [],                      // asercje SC5: { what, ok, detail }
  sc5Submit: 0,                 // ile odpowiedzi submit_answer_v2 sprawdzono
};
const srvNow = () => Date.now() + state.clockOff;
// Scenariusze trybów (REFRESH/OFFLINE) biegną równolegle z pętlą próbkowania;
// pętla nie kończy się, dopóki któryś jeszcze porównuje próbki.
const scenarios = [];
const scenariosDone = () => scenarios.every((s) => s.done);
// Okna [od, do] (czas serwera) per telefon, w których telefon był w trakcie reloadu —
// start pytania wypadający w takim oknie nie jest oceniany.
const blind = {};
const wsLog = [];
const wsFrames = { n: 0 };
// PROBE_TRACE: snapshoty get_participant_state (wysłanie/odbiór/stan) i wiersze Realtime
// quiz_sessions — per telefon (pi), czasy w zegarze maszyny sondy (Date.now()).
const trace = { snaps: [], rows: [] };
const consoleLog = [];

// ─── SETUP ───────────────────────────────────────────────────────────────────
async function preflight() {
  // Czy cel w ogóle odpowiada? Bez tego dostajemy gołe "fetch failed" w środku setupu.
  try {
    const r = await fetch(`${URL_SB}/auth/v1/health`, { headers: { apikey: ANON } });
    if (!r.ok && r.status >= 500) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    console.error(`\n❌ Cel nie odpowiada: ${URL_SB}`);
    console.error(`   ${e.cause?.code === "ENOTFOUND" ? "Host nie istnieje (projekt usunięty lub uśpiony?)" : e.message}`);
    if (STAGE) console.error("   Staging nieczynny → uruchom z PROBE_TARGET=prod (świadomie, na produkcję).");
    process.exit(1);
  }
}

async function setup() {
  console.log(`\n🌐 Cel: ${URL_SB}  ${STAGE ? "(STAGING ✓)" : "⚠️  (PRODUKCJA)"}`);
  console.log(`🖥️  Aplikacja: ${APP}`);
  console.log(`👥 Telefony: ${PHONES}  ·  Pytania: ${NQ}  ·  Miasto: ${CITY}`);
  const modes = [FULL && "FULL", ADMIN_EXIT && "ADMIN_EXIT", REFRESH && "REFRESH", OFFLINE && "OFFLINE",
    PAUSE_PHASE && `PAUSE_${PAUSE_PHASE.toUpperCase()}(pyt.${PAUSE_Q})`, TRACE && "TRACE"].filter(Boolean);
  console.log(`🧪 Tryby: ${modes.length ? modes.join(" + ") : "podstawowy"}\n`);
  console.log("SETUP");

  state.adminEmail = `probe-${Date.now()}@twe.2026.fue.pl`;
  state.adminPass = "Probe!" + Math.random().toString(36).slice(2, 10);
  const { data: u, error: ue } = await svc.auth.admin.createUser({
    email: state.adminEmail, password: state.adminPass, email_confirm: true,
  });
  if (ue) throw new Error("createUser: " + ue.message);
  state.adminId = u.user.id;
  const { error: pe } = await svc.from("profiles").insert({
    id: state.adminId, full_name: "Sonda rozgrywki", role: "city_admin", city: CITY,
  });
  if (pe) throw new Error("profile: " + pe.message);

  // W trybie pełnym rozkładamy pytania na 5 modułów — dzięki temu test przechodzi
  // przez zapowiedzi modułów i przez przerwy po module 2 i 4.
  const rows = FULL
    ? [1, 2, 3, 4, 5].flatMap((m) => Array.from({ length: QPM }, (_, i) => ({
        city: CITY, module: m, q: `${TAG} M${m} Pytanie ${i + 1}`,
        opts: ["A", "B", "C", "D"], ans: 0, is_practice: false, sort_order: i + 1,
      })))
    : Array.from({ length: NQ }, (_, i) => ({
        city: CITY, module: 1, q: `${TAG} Pytanie ${i + 1}`,
        opts: ["A", "B", "C", "D"], ans: 0, is_practice: false, sort_order: i + 1,
      }));
  const { data: qs, error: qe } = await svc.from("questions").insert(rows).select("id");
  if (qe) throw new Error("questions: " + qe.message);
  state.qIds = qs.map((q) => q.id);

  const codeRows = Array.from({ length: PHONES }, (_, i) => ({
    code: `PRB-${Date.now().toString().slice(-6)}${i}`, name: `Telefon${i + 1}`, surname: "Sonda", city: CITY,
  }));
  const { data: cs, error: ce } = await svc.from("participant_codes").insert(codeRows).select("code,name,surname,city");
  if (ce) throw new Error("codes: " + ce.message);
  state.codes = cs;

  const { data: sess } = await svc.from("quiz_sessions").select("*")
    .eq("city", CITY).eq("is_practice", false).neq("status", "ended")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!sess) throw new Error(`Brak oczekującej sesji dla miasta ${CITY} — utwórz ją w panelu.`);
  state.sessionId = sess.id;
  // Nowe kolumny planu (sekcja 39) jawnie — cleanup przywraca je do wartości sprzed testu
  // (zwykle NULL); inaczej po sondzie sesja miasta zostałaby „z planem” i zamiatacz by ją ruszał.
  state.sessionBefore = {
    status: sess.status, current_question_idx: sess.current_question_idx, q_started_at: sess.q_started_at,
    plan_anchor_at: sess.plan_anchor_at ?? null, plan_paused_at: sess.plan_paused_at ?? null,
    revealed_idx: sess.revealed_idx ?? null, revealed_ans: sess.revealed_ans ?? null,
  };
  // plan_hold_idx (sekcja 42) — tylko gdy kolumna istnieje (select("*") zwraca klucz).
  state.hasHoldIdx = "plan_hold_idx" in sess;
  if (state.hasHoldIdx) state.sessionBefore.plan_hold_idx = sess.plan_hold_idx ?? null;
  // Plan sprzed testu (normalnie brak) — zapamiętany, żeby cleanup mógł go odtworzyć.
  const { data: planBefore } = await svc.from("session_plans").select("items").eq("session_id", sess.id).maybeSingle();
  state.planBefore = planBefore?.items ?? null;
  await svc.from("session_plans").delete().eq("session_id", sess.id);
  await svc.from("quiz_sessions").update({
    status: "waiting", current_question_idx: 0, q_started_at: null,
    plan_anchor_at: null, plan_paused_at: null, revealed_idx: null, revealed_ans: null,
    ...(state.hasHoldIdx ? { plan_hold_idx: null } : {}),
  }).eq("id", sess.id);

  // Czasy modułów na produkcji są różne (20/30/60/75/20), a pełny przebieg z nimi
  // trwałby ~15 minut. Na czas testu ustawiamy jeden czas i PRZYWRACAMY oryginały
  // w cleanup — inaczej sonda cicho zmieniłaby konfigurację wydarzenia.
  const { data: modsBefore } = await svc.from("modules").select("id, time_per_q").order("id");
  state.modulesBefore = modsBefore || [];
  let tpq;
  if (OVERRIDE_TPQ) {
    for (const m of state.modulesBefore) {
      await svc.from("modules").update({ time_per_q: TPQ_OVERRIDE }).eq("id", m.id);
    }
    tpq = TPQ_OVERRIDE;
    console.log(`  czasy modułów tymczasowo na ${TPQ_OVERRIDE}s (oryginały: ${state.modulesBefore.map((m) => m.time_per_q).join("/")})`);
  } else {
    tpq = state.modulesBefore.find((m) => m.id === 1)?.time_per_q || 60;
  }
  console.log(`  pytania: ${NQ}  kody: ${state.codes.map((c) => c.code).join(", ")}`);
  console.log(`  sesja: ${state.sessionId}  czas na pytanie: ${tpq}s\n`);
  return tpq;
}

async function cleanup() {
  console.log("\n🧹 SPRZĄTANIE");
  const codes = state.codes.map((c) => c.code);
  try { if (codes.length) await svc.from("answers").delete().in("participant_code", codes); } catch {}
  try { if (state.qIds.length) await svc.from("answers").delete().in("question_id", state.qIds); } catch {}
  try { if (state.qIds.length) await svc.from("questions").delete().in("id", state.qIds); } catch {}
  try { if (codes.length) await svc.from("participant_codes").delete().in("code", codes); } catch {}
  // Plan sesji z przebiegu sondy — sesja nie jest kasowana, więc ON DELETE CASCADE
  // nie zadziała; bez jawnego DELETE zostałby plan z pytaniami, których już nie ma.
  if (state.sessionId) {
    try { await svc.from("session_plans").delete().eq("session_id", state.sessionId); } catch {}
    if (state.planBefore) {
      try { await svc.from("session_plans").insert({ session_id: state.sessionId, items: state.planBefore }); } catch {}
    }
  }
  if (state.sessionId && state.sessionBefore) {
    try { await svc.from("quiz_sessions").update(state.sessionBefore).eq("id", state.sessionId); } catch {}
  }
  if (state.adminId) {
    try { await svc.from("profiles").delete().eq("id", state.adminId); } catch {}
    try { await svc.auth.admin.deleteUser(state.adminId); } catch {}
  }
  // Przywróć oryginalne czasy modułów — narzędzie testowe nie może zostawić po sobie
  // zmienionej konfiguracji wydarzenia.
  for (const m of state.modulesBefore || []) {
    try { await svc.from("modules").update({ time_per_q: m.time_per_q }).eq("id", m.id); } catch {}
  }
  const { data: leftQ } = await svc.from("questions").select("id").ilike("q", `%${TAG}%`);
  const { data: leftC } = codes.length ? await svc.from("participant_codes").select("code").in("code", codes) : { data: [] };
  // „Plany sondy” = plan na sesji testowej, którego przed testem nie było.
  let leftP = 0;
  if (state.sessionId && !state.planBefore) {
    const { data: lp } = await svc.from("session_plans").select("session_id").eq("session_id", state.sessionId);
    leftP = lp?.length ?? 0;
  }
  const ok = (leftQ?.length ?? 0) === 0 && (leftC?.length ?? 0) === 0 && leftP === 0;
  console.log(`  pytania sondy: ${leftQ?.length ?? "?"}   kody sondy: ${leftC?.length ?? "?"}   plany sondy: ${leftP}   ${ok ? "✅ czysto" : "⚠️ zostały resztki"}`);
}

// ─── ZEGAR, PLAN, MONITOR BAZY ───────────────────────────────────────────────
// Terminy planu są w czasie serwera. Zegar maszyny sondy (Windows) bywa rozjechany
// o sekundy, więc — tak jak aplikacja — mierzymy offset przez RPC server_now (pasmo min-RTT).
async function syncClock(cli) {
  const list = [];
  for (let i = 0; i < 7; i++) {
    const t0 = Date.now();
    const { data, error } = await cli.rpc("server_now");
    const t1 = Date.now();
    const ms = Number(data);
    if (!error && Number.isFinite(ms)) list.push({ rtt: t1 - t0, off: ms - (t0 + t1) / 2 });
  }
  if (!list.length) { console.log("  ⚠️ server_now niedostępne — zegar sondy bez korekty"); return; }
  const minRtt = Math.min(...list.map((x) => x.rtt));
  const band = list.filter((x) => x.rtt <= minRtt * 1.5 + 10).map((x) => x.off).sort((a, b) => a - b);
  state.clockOff = Math.round(band[Math.floor(band.length / 2)]);
  console.log(`  zegar serwera: offset ${state.clockOff} ms (min RTT ${minRtt} ms)`);
}

// Po kliknięciu Start: status 'running' + kotwica w bazie, potem plan z session_plans.
// Brak planu = panel nie wywołał start_quiz_session_v2 (stary bundle / fallback) → FAIL.
async function loadPlanAfterStart() {
  const until = Date.now() + 15000;
  let row = null;
  while (Date.now() < until) {
    const { data } = await svc.from("quiz_sessions").select("status, plan_anchor_at").eq("id", state.sessionId).single();
    row = data;
    if (row?.status === "running" && row.plan_anchor_at) break;
    await sleep(300);
  }
  if (row?.status !== "running") throw new Error(`sesja nie przeszła w 'running' po kliknięciu Start (status: ${row?.status})`);
  const { data: p } = await svc.from("session_plans").select("items").eq("session_id", state.sessionId).maybeSingle();
  if (!row.plan_anchor_at || !p?.items?.length) {
    throw new Error("sesja bez planu — nowy panel nie wywołał start_quiz_session_v2");
  }
  state.plan = p.items;
  state.anchorMs = toMs(row.plan_anchor_at);
  const last = state.plan[state.plan.length - 1];
  console.log(`  plan: ${state.plan.length} pytań, kotwica ${new Date(state.anchorMs).toISOString()}, koniec r=${(last.r / 1000).toFixed(0)}s`);
}

// Kotwica obowiązująca w chwili srv (pauza/wznowienie ją przesuwa — bierzemy ostatni
// odczyt monitora sprzed srv, a przed pierwszym odczytem kotwicę ze startu).
function anchorAt(srv) {
  let a = state.anchorMs, p = null;
  for (const m of state.monitor) { if (m.srv > srv) break; if (m.anchorMs != null) { a = m.anchorMs; p = m.pausedMs; } }
  return { anchorMs: a, pausedMs: p };
}
// Czy chwila srv leży blisko granicy fazy w planie (ticki obu telefonów mogą ją
// przeciąć w różnych momentach — takich próbek nie porównujemy).
function nearBoundary(srv, marginMs = 700) {
  if (!state.plan) return false;
  const { anchorMs } = anchorAt(srv);
  if (anchorMs == null) return false;
  const t = srv - anchorMs;
  return state.plan.some((it) => [it.o, it.c, it.r].some((b) => Math.abs(t - b) <= marginMs));
}

// Odczyt wiersza sesji co 1 s (svc). Służy do: zgodności current_question_idx z planem,
// momentu ustawienia status='results' przez zamiatacz i historii kotwicy (pauza).
async function monitorLoop(stopRef) {
  while (!stopRef.stop) {
    const t0 = Date.now();
    // select("*"): kolumna plan_hold_idx istnieje dopiero po sekcji 42 — gwiazdka działa przed i po.
    const { data } = await svc.from("quiz_sessions").select("*").eq("id", state.sessionId).single();
    const t1 = Date.now();
    if (data) state.monitor.push({
      srv: (t0 + t1) / 2 + state.clockOff, status: data.status, idx: data.current_question_idx,
      anchorMs: toMs(data.plan_anchor_at), pausedMs: toMs(data.plan_paused_at),
      holdIdx: data.plan_hold_idx ?? null,
    });
    await sleep(Math.max(0, 1000 - (Date.now() - t0)));
  }
}

// ─── SC5: poprawność niewidoczna przed końcem czasu ──────────────────────────
function sc5(what, ok, detail = "") {
  state.sc5.push({ what, ok, detail });
  if (!ok) console.log(`   ❌ SC5: ${what} ${detail}`);
}
// (a) body odpowiedzi submit_answer_v2 nie może nieść poprawności.
function attachSubmitGuard(page) {
  page.on("response", async (res) => {
    if (!res.url().includes("/rpc/submit_answer_v2")) return;
    let body = null;
    try { body = await res.json(); } catch { return; }
    state.sc5Submit++;
    const keys = JSON.stringify(body);
    const leak = /"is_correct"|"correct_ans"/.test(keys);
    sc5("submit_answer_v2 bez is_correct/correct_ans", !leak, leak ? keys.slice(0, 120) : "");
  });
}
// (b) snapshot i summary v2 wołane anonimowo w trakcie fazy quiz pytania idx.
async function sc5Check(anon, idx, when) {
  const it = state.plan?.[idx];
  if (!it) return;
  const { data: st, error: e1 } = await anon.rpc("get_participant_state", {
    p_code: state.codes[0].code, p_session_id: state.sessionId, p_include_plan: false,
  });
  // Serwer liczył odpowiedź najpóźniej w chwili jej odebrania: jeśli to przed bramką
  // (closes + 1,5 s), poprawność MUSI być ukryta. Po bramce pomiar nie ma znaczenia.
  const { anchorMs } = anchorAt(srvNow());
  const gate = (a) => a != null && srvNow() - a < it.c + 1500;
  const stillOpen = gate(anchorMs);
  if (e1 || !st) { sc5(`snapshot pyt.${idx + 1} (${when})`, false, e1?.message || "brak danych"); return; }
  if (!stillOpen) return;
  const rev = st.reveal;
  const revOk = rev == null || (typeof rev.idx === "number" && rev.idx < idx);
  sc5(`snapshot pyt.${idx + 1} (${when}): reveal`, revOk, revOk ? "" : JSON.stringify(rev));
  const mine = (st.my_answers || []).filter((a) => a.question_id === it.id);
  const mineOk = mine.every((a) => a.is_correct === null || a.is_correct === undefined);
  sc5(`snapshot pyt.${idx + 1} (${when}): my_answers.is_correct`, mineOk, mineOk ? "" : JSON.stringify(mine));
  const { data: sm, error: e2 } = await anon.rpc("get_answer_summary_v2", { p_session_id: state.sessionId, p_question_id: it.id });
  if (e2) { sc5(`summary pyt.${idx + 1} (${when})`, false, e2.message); return; }
  if (!gate(anchorMs)) return;
  const smOk = sm?.correct == null && sm?.ans == null;
  sc5(`get_answer_summary_v2 pyt.${idx + 1} (${when})`, smOk, smOk ? "" : JSON.stringify(sm));
}

// ─── ODCZYT EKRANU ───────────────────────────────────────────────────────────
// Uwaga na wielkość liter: panel renderuje "PYT. 1/3" wielkimi przez CSS
// text-transform, a innerText zwraca już przetransformowany tekst.
// Nowy klient (06-05) wystawia fazę na document.body.dataset (data-fue-*) — to odczyt
// podstawowy. Regexy po innerText zostają jako fallback dla panelu admina i starego bundla.
const READ = `(() => {
  const d = document.body.dataset;
  if (document.body.dataset.fuePhase) return {
    src: "data", phase: d.fuePhase, q: d.fueQ ? Number(d.fueQ) : null,
    timer: d.fueRemaining !== undefined && d.fueRemaining !== "" ? Number(d.fueRemaining) : null,
    locked: d.fueLocked === "1", choice: d.fueChoice || null,
    brk: d.fueBreak !== undefined ? d.fueBreak : null,
    saveFailed: (document.body.innerText || "").includes("Nie udało się zapisać odpowiedzi"),
  };
  const t = document.body.innerText || "";
  const out = { src: "text", phase: "?", q: null, timer: null };
  const mPart  = t.match(/Pytanie (\\d+) \\/ (\\d+) · #(\\d+)\\/(\\d+)/);
  const mAdmin = t.match(/Pytanie (\\d+)\\/(\\d+)/);
  if (mPart) { out.phase = "quiz"; out.q = Number(mPart[3]); }
  else if (mAdmin) { out.phase = "host"; out.q = Number(mAdmin[1]); }
  // Uwaga: sporo napisów ma text-transform:uppercase, a innerText zwraca tekst PO
  // transformacji — stąd wszędzie /i. Na tym już raz poległ parser panelu admina.
  if (/Oczekiwanie na start|Łączenie z sesją/i.test(t)) out.phase = "lobby";
  if (/START!|Start za/i.test(t)) out.phase = "odliczanie";
  if (/Następny moduł|MODUŁ \\d+ \\//i.test(t)) out.phase = "zapowiedz";
  if (/Przerwa|Wstrzymano/i.test(t)) out.phase = "przerwa";
  if (/Koniec testu|Wszystkie pytania zosta/i.test(t)) out.phase = "czekam_wyniki";
  if (/Poczekaj na ogłoszenie organizatora|poprawnych odpowiedzi/i.test(t)) out.phase = "wynik";
  if (out.phase === "quiz") {
    const svg = document.querySelector('svg[width="54"]');
    const sp = svg && svg.parentElement ? svg.parentElement.querySelector("span") : null;
    if (sp) { const n = parseInt(sp.textContent, 10); if (Number.isFinite(n) && n <= 600) out.timer = n; }
  }
  return out;
})()`;

// Jedna nazwa fazy w całym raporcie: nazwy z data-fue-phase (nowy klient) są kanoniczne,
// nazwy z regexów (stary bundle) mapujemy na nie. „ended” ≡ „results” (ekran wyniku).
const LEGACY_NAMES = { zapowiedz: "intro", odliczanie: "countdown", przerwa: "paused", czekam_wyniki: "finished", wynik: "results", ended: "results" };
function normPhase(r) {
  if (!r || typeof r !== "object") return { phase: "err" };
  return { ...r, phase: LEGACY_NAMES[r.phase] || r.phase };
}
// Koniec gry: finished i results to ten sam etap z perspektywy zgodności telefonów —
// status „results” ustawia zamiatacz ≤ 1 s po ostatnim reveal, telefony dostają go sygnałem.
const endish = (p) => p === "finished" || p === "results";
const samePhase = (a, b) => a === b || (endish(a) && endish(b));

// ─── PRZEBIEG ────────────────────────────────────────────────────────────────
async function main() {
  await preflight();
  const tpq = await setup();
  // Bez tych flag Chromium dławi timery i sieć w kartach w tle, a wszystkie
  // konteksty poza jednym SĄ w tle — nie dałoby się odróżnić realnego opóźnienia
  // aplikacji od artefaktu pomiaru.
  const browser = await chromium.launch({
    args: [
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ],
  });
  const samples = [];
  const pages = [];
  let t0 = 0;
  const monStop = { stop: false };
  let monDone = null;

  try {
    const cli = createClient(URL_SB, ANON, { auth: { persistSession: false } });
    const { data: sIn, error: sErr } = await cli.auth.signInWithPassword({ email: state.adminEmail, password: state.adminPass });
    if (sErr) throw new Error("logowanie sondy: " + sErr.message);

    const ctxAdmin = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    // Pauza i ogłoszenie wyników są za confirm() — bez tego klik wisi.
    ctxAdmin.on("page", (pg) => pg.on("dialog", (d) => d.accept().catch(() => {})));
    await ctxAdmin.addInitScript(([k, v]) => localStorage.setItem(k, v),
      [`sb-${projectRef}-auth-token`, JSON.stringify(sIn.session)]);
    let admin = await ctxAdmin.newPage();
    // Kontrola zgodności celu: aplikacja ma wkompilowany URL Supabase w bundlu, więc
    // mogłaby cicho gadać z INNYM projektem niż ten, który sonda zasiewa. Wtedy wynik
    // byłby bezsensowny („nikt nie dołączył"), a przyczyna nieoczywista. Wyłapujemy to
    // z adresu socketu Realtime, który aplikacja otwiera sama.
    let appRef = null;
    admin.on("websocket", (ws) => {
      const u = ws.url();
      if (u.includes("realtime") && !appRef) appRef = new global.URL(u).hostname.split(".")[0];
    });
    await admin.goto(APP, { waitUntil: "domcontentloaded" });

    for (const c of state.codes) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      // Nowy klient trzyma uczestnika w localStorage. Init script działa przy KAŻDYM
      // reloadzie — ustawiamy tylko, gdy klucza brak, żeby REFRESH testował prawdziwy restore
      // (z sessionId przypiętym przez aplikację), a nie świeże „wejście z kodem”.
      await ctx.addInitScript((p) => { if (!localStorage.getItem("fue_participant")) localStorage.setItem("fue_participant", p); },
        JSON.stringify({ code: c.code, name: c.name, surname: c.surname, city: c.city, sessionId: null }));
      // Historia KAŻDEJ zmiany data-fue-phase (MutationObserver) — próbkowanie co 250 ms
      // gubi jednoklatkowe mignięcia (np. poczekalnia tuż po refreshu), a to realny błąd UX.
      await ctx.addInitScript(() => {
        window.__fuePhases = [];
        new MutationObserver((ms) => {
          for (const m of ms) {
            const d = m.target?.dataset;
            if (m.target === document.body && d?.fuePhase) {
              window.__fuePhases.push({ t: Date.now(), phase: d.fuePhase, q: d.fueQ ? Number(d.fueQ) : null, locked: d.fueLocked === "1", choice: d.fueChoice || null });
            }
          }
        // `document`, nie documentElement — ten ostatni nie istnieje jeszcze w chwili init scriptu.
        }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-fue-phase", "data-fue-q", "data-fue-locked"] });
      });
      if (TRACE) {
        // Ślad przyczynowy: dziennik próbek zegara (serverClock.js pisze tylko, gdy tablica
        // istnieje) i owinięcie startViewTransition (call → callback → updateCallbackDone).
        await ctx.addInitScript(() => {
          window.__fueClockLog = [];
          window.__fueVT = [];
          const orig = document.startViewTransition ? document.startViewTransition.bind(document) : null;
          if (orig) document.startViewTransition = (cb) => {
            const rec = { call: Date.now(), cb: null, done: null, overlap: window.__fueVT.some((r) => r.done == null) };
            window.__fueVT.push(rec);
            const vt = orig(() => { rec.cb = Date.now(); return cb && cb(); });
            vt?.updateCallbackDone?.then(() => { rec.done = Date.now(); }, () => { rec.done = -1; });
            return vt;
          };
        });
      }
      const p = await ctx.newPage();
      // Podsłuch WebSocket na PIERWSZYM telefonie — to jedyny sposób, żeby odróżnić
      // "aplikacja nie zareagowała" od "zdarzenie w ogóle nie dotarło".
      if (pages.length === 0) { attachWs(p); attachConsole(p); attachSubmitGuard(p); }
      if (TRACE) attachTrace(p, pages.length);
      await p.goto(APP, { waitUntil: "domcontentloaded" });
      pages.push({ code: c.code, page: p, ctx });
    }

    await sleep(6000);
    if (appRef && appRef !== projectRef) {
      throw new Error(
        `Aplikacja pod ${APP} łączy się z projektem "${appRef}", a sonda zasiewa "${projectRef}".\n` +
        `   Przebuduj aplikację pod ten sam cel (npm run build && npm run preview) albo zmień PROBE_TARGET.`
      );
    }
    const anon = createClient(URL_SB, ANON, { auth: { persistSession: false } });
    await syncClock(anon);
    // Stan telefonów tuż przed startem — pętla próbkowania rusza dopiero po kliknięciu,
    // więc bez tego etap „poczekalnia” byłby niewidoczny.
    state.preStart = (await Promise.all(pages.map((x) => x.page.evaluate(READ).catch(() => ({ phase: "err" }))))).map(normPhase);
    console.log(`  przed startem: ${state.preStart.map((p, i) => `t${i + 1} ${p.phase}`).join(", ")}`);
    console.log("▶️  START QUIZU\n");
    await admin.getByRole("button", { name: /Start quizu/ }).click({ timeout: 20000 });
    t0 = Date.now();
    await loadPlanAfterStart();
    if (FULL && ADMIN_EXIT && state.plan.some((x) => x.h)) {
      throw new Error("PROBE_FULL z przerwami planowymi wymaga admina — nie łącz z PROBE_ADMIN_EXIT");
    }
    monDone = monitorLoop(monStop);

    // SC1: od tej chwili nikt nie „prowadzi” quizu z przeglądarki — przejścia pytań
    // i przejście do wyników musi wykonać zamiatacz pg_cron według planu.
    if (ADMIN_EXIT) {
      await ctxAdmin.close();
      admin = null;
      console.log("   🚪 przeglądarka admina zamknięta po starcie");
    }

    const answered = new Set();
    const noAuto = new Set();   // klucze `${telefon}:${pytanie}`, na które odpowiada scenariusz, nie pętla
    const sc5Seen = new Set();
    const sctx = { samples, pages, noAuto, admin };
    if (REFRESH) {
      noAuto.add(`${REF_PI}:1`); noAuto.add(`${REF_PI}:2`);
      startScenario("REFRESH", () => refreshScenario(sctx));
    }
    if (OFFLINE) {
      noAuto.add(`${OFF_PI}:2`);
      startScenario("OFFLINE", () => offlineScenario(sctx));
    }
    if (PAUSE_PHASE) startScenario("PAUSE_" + PAUSE_PHASE.toUpperCase(), () => pausePhaseScenario(sctx));
    const flow = {
      paused: false, pausedAt: 0, resumed: false, pauseSeen: false, before: null, during: null, after: null,
      breaks: new Set(), breakLog: [], brk: null,   // przerwy planowe (sekcja 42) obsłużone przez sondę
    };
    // Moduły, po których jest przerwa planowa — pauza sondy w FULL wybiera pytanie spoza nich,
    // żeby wznowienie pauzy sondy nie mieszało się z przerwą planową.
    const brkMods = new Set((state.plan || []).filter((x) => x.h).map((x) => x.m));
    globalThis.__flow = flow;
    while (Date.now() - t0 < RUN_MS) {
      const at = Date.now() - t0;
      const r0 = Date.now();
      const [a, ...ps] = (await Promise.all([
        admin ? admin.evaluate(READ).catch(() => ({ phase: "err" })) : { phase: "closed" },
        ...pages.map((x) => x.page.evaluate(READ).catch(() => ({ phase: "err" }))),
      ])).map(normPhase);
      const srv = (r0 + Date.now()) / 2 + state.clockOff;
      samples.push({ at, srv, admin: a, phones: ps });

      // Telefony odpowiadają ~3 s po pojawieniu się pytania — bez tego ścieżka
      // wcześniejszego zakończenia w ogóle się nie uruchamia.
      for (let i = 0; i < pages.length; i++) {
        const st = ps[i];
        if (st?.phase !== "quiz" || st.q == null || st.timer == null) continue;
        const key = `${i}:${st.q}`;
        const qTpq = state.plan?.[st.q - 1]?.tpq ?? tpq;
        if (answered.has(key) || noAuto.has(key) || st.timer > qTpq - 3) continue;
        answered.add(key);
        pages[i].page.locator("button.ans-btn").first().click({ timeout: 3000 }).catch(() => {});
      }

      // SC5: w pierwszej sekundzie pytania i po zablokowaniu odpowiedzi telefonu 1
      // pytamy bazę anonimowo o snapshot i summary (asynchronicznie, bez blokowania pętli).
      const p1 = ps[0];
      if (p1?.phase === "quiz" && p1.q != null && p1.timer != null) {
        const qTpq = state.plan?.[p1.q - 1]?.tpq ?? tpq;
        const kOpen = `open:${p1.q}`, kLock = `lock:${p1.q}`;
        if (!sc5Seen.has(kOpen) && p1.timer >= qTpq - 1) { sc5Seen.add(kOpen); sc5Check(anon, p1.q - 1, "1. sekunda").catch(() => {}); }
        if (!sc5Seen.has(kLock) && p1.locked && p1.timer >= 3) { sc5Seen.add(kLock); sc5Check(anon, p1.q - 1, "po odpowiedzi").catch(() => {}); }
      }

      // ── Sterowanie pełną ścieżką ────────────────────────────────────────────
      if (FULL) {
        const ph = ps[0]?.phase;
        // Przerwa planowa (sekcja 42): zamiatacz ustawia status='paused' + plan_hold_idx.
        // Sonda zapisuje stan telefonów, po 5 s klika „Wznów quiz” (bez blokowania pętli).
        const lm = state.monitor[state.monitor.length - 1];
        const probePauseActive = flow.paused && !flow.resumed;
        if (admin && !flow.brk && lm?.status === "paused" && lm.holdIdx != null && !flow.breaks.has(lm.holdIdx) && !probePauseActive) {
          flow.brk = { holdIdx: lm.holdIdx, seenAt: Date.now(), seenSrv: srv, phones: ps.map((p) => ({ phase: p?.phase, q: p?.q, brk: p?.brk ?? null })) };
          console.log(`   ☕ przerwa planowa po pytaniu ${lm.holdIdx + 1} (telefony: ${flow.brk.phones.map((p) => p.phase).join(", ")})`);
        } else if (admin && flow.brk && Date.now() - flow.brk.seenAt >= 5000) {
          const b = flow.brk;
          flow.brk = null;
          b.clickSrv = srvNow();
          flow.breakLog.push(b);
          flow.breaks.add(b.holdIdx);
          console.log(`   ▶️  wznowienie po przerwie planowej ${b.holdIdx + 1}`);
          await admin.getByRole("button", { name: /Wznów quiz/ }).click({ timeout: 10000 }).catch((e) => console.log("   ⚠️ wznów po przerwie:", e.message.slice(0, 60)));
        }
        // Pauza w środku przebiegu — czy uczestnik realnie widzi „Wstrzymano” i czy po
        // wznowieniu ma tę samą fazę, pytanie i licznik co przed pauzą (±1 s).
        // Pauzujemy w połowie pytania, z dala od granic faz, żeby porównanie było jednoznaczne.
        // Z PROBE_PAUSE_PHASE pauzą steruje scenariusz — własna pauza FULL jest wtedy wyłączona.
        if (admin && !PAUSE_PHASE && !flow.paused && !flow.brk && ph === "quiz" && ps[0]?.q >= Math.ceil(NQ / 2) && !brkMods.has(state.plan?.[ps[0].q - 1]?.m) && ps[0].timer != null && ps[0].timer <= (state.plan?.[ps[0].q - 1]?.tpq ?? tpq) - 5 && ps[0].timer >= 8) {
          flow.paused = true; flow.pausedAt = at;
          flow.before = ps.map((p) => ({ phase: p.phase, q: p.q, timer: p.timer }));
          console.log(`   ⏸  pauza (pytanie ${ps[0].q}, licznik ${ps[0].timer}s)`);
          await admin.getByRole("button", { name: /Pauza/ }).click({ timeout: 10000 }).catch((e) => console.log("   ⚠️ pauza:", e.message.slice(0, 60)));
        } else if (flow.paused && !flow.resumed && at - flow.pausedAt > 10000) {
          flow.resumed = true; flow.resumedAt = at;
          flow.pauseSeen = samples.some((s) => s.at > flow.pausedAt && s.phones[0]?.phase === "paused");
          flow.during = [...samples].reverse().find((s) => s.phones.every((p) => p?.phase === "paused"))?.phones.map((p) => ({ q: p.q, timer: p.timer })) ?? null;
          console.log(`   ▶️  wznowienie (uczestnik widział przerwę: ${flow.pauseSeen ? "TAK" : "NIE"})`);
          await admin.getByRole("button", { name: /Wznów quiz/ }).click({ timeout: 10000 }).catch((e) => console.log("   ⚠️ wznów:", e.message.slice(0, 60)));
        } else if (flow.resumed && !flow.after && ps.every((p) => p?.phase !== "paused" && p?.src === "data")) {
          flow.after = ps.map((p) => ({ phase: p.phase, q: p.q, timer: p.timer }));
        }
        // Koniec pytań: „Ogłoś wyniki” nie jest już potrzebne — po ostatnim reveal
        // status='results' ustawia zamiatacz (decyzja „Koniec quizu”). Sprawdza to raport.
      }

      // Koniec: wszystkie telefony na ekranie wyniku, baza w 'results', scenariusze skończone.
      const dbResults = state.monitor.some((m) => m.status === "results");
      if (ps.length && ps.every((p) => p?.phase === "results") && dbResults && scenariosDone()) break;
      await sleep(250);
    }
  } finally {
    monStop.stop = true;
    try { await monDone; } catch {}
    // Historia faz z DOM (zawsze — start pytań z DOM) oraz VT / dziennik zegara (PROBE_TRACE).
    const emptyTrace = { phases: [], vt: [], clock: [] };
    state.phoneTrace = await Promise.all(pages.map((x) => Promise.race([
      x.page.evaluate("({ phases: window.__fuePhases || [], vt: window.__fueVT || [], clock: window.__fueClockLog || [] })")
        .catch(() => emptyTrace),
      sleep(5000).then(() => emptyTrace),
    ])));
    try { await browser.close(); } catch {}
  }

  const failures = report(samples, tpq, t0);
  await cleanup();
  console.log(failures.length ? `\n❌ SONDA: ${failures.length} PROBLEM(ÓW)\n` : "\n✅ SONDA: rozgrywka płynna\n");
  // 0 = PASS, 1 = FAIL, 2 = przebieg pauzy niewykonany (powtórz) — 2 ma pierwszeństwo,
  // bo bez pauzy w zadanej fazie przebieg nie odpowiada na pytanie diagnozy.
  if (state.pauseNotRun) console.log("⚠️  PAUZA: przebieg niewykonany — powtórz (kod 2)\n");
  process.exit(state.pauseNotRun ? 2 : failures.length ? 1 : 0);
}

// Błędy z konsoli telefonu. Bez tego diagnoza kończyła się na wnioskowaniu: widać
// było ROZJAZD timerów, ale nie POWÓD (nieudane pobranie konfiguracji modułów,
// wyjątek w pętli ponowień). Te linie zamieniają domysł w dowód.
function attachConsole(page) {
  page.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    const t = m.text();
    if (/fetchModules|ModulesProvider|modules|Supabase|realtime|Failed to fetch|NetworkError/i.test(t))
      consoleLog.push({ at: Date.now(), kind: m.type(), text: t.slice(0, 160) });
  });
  page.on("pageerror", (e) => consoleLog.push({ at: Date.now(), kind: "pageerror", text: String(e?.message || e).slice(0, 160) }));
}

// Ile razy telefon WSZEDŁ w daną fazę (a nie ile próbek w niej spędził).
function countTransitions(samples, phase) {
  let n = 0, prev = null;
  for (const s of samples) {
    const p = s.phones[0]?.phase;
    if (p === phase && prev !== phase) n++;
    prev = p;
  }
  return n;
}

function attachWs(page) {
  const dec = (pl) => (typeof pl === "string" ? pl : Buffer.isBuffer(pl) ? pl.toString("utf8") : String(pl ?? ""));
  page.on("websocket", (ws) => {
    if (!ws.url().includes("realtime")) return;
    wsLog.push({ at: Date.now(), kind: "OPEN", info: "" });
    ws.on("close", () => wsLog.push({ at: Date.now(), kind: "CLOSE", info: "" }));
    ws.on("framereceived", (f) => {
      wsFrames.n++;
      const d = dec(f.payload);
      if (d.includes("quiz_event")) wsLog.push({ at: Date.now(), kind: "BROADCAST", info: "" });
      // realtime-js ≥ 2.x domyślnie mówi protokołem vsn 2.0.0: ramka to tablica
      // [join_ref, ref, topic, event, payload], więc zdarzenie ma postać ,"postgres_changes",
      // a nie "event":"postgres_changes" (vsn 1.0.0). Obsługujemy oba formaty — inaczej
      // zmiany wiersza sesji od zamiatacza były niewidoczne i sonda krzyczała „GŁUCHY”.
      else if (/"event":"postgres_changes"|,"postgres_changes",/.test(d)) wsLog.push({ at: Date.now(), kind: "PG_CHANGES", info: "" });
    });
  });
}

// PROBE_TRACE, KAŻDY telefon: snapshoty get_participant_state (wysłanie → odbiór → stan sesji)
// i wiersze Realtime quiz_sessions. Z nich H1: „stary snapshot” = odpowiedź wysłana PRZED
// wierszem Realtime, odebrana PO nim, z innym stanem (status / plan_paused_at / plan_anchor_at).
function attachTrace(page, pi) {
  const pend = new Map();
  page.on("request", (rq) => {
    if (rq.url().includes("/rpc/get_participant_state")) pend.set(rq, { pi, req: Date.now() });
  });
  page.on("response", async (rs) => {
    const rec = pend.get(rs.request());
    if (!rec) return;
    pend.delete(rs.request());
    rec.resp = Date.now();
    rec.http = rs.status();
    try {
      const s = (await rs.json())?.session;
      rec.status = s?.status ?? null;
      rec.pausedMs = toMs(s?.plan_paused_at ?? null);
      rec.anchorMs = toMs(s?.plan_anchor_at ?? null);
      rec.holdIdx = s?.plan_hold_idx ?? null;
    } catch {}
    trace.snaps.push(rec);
  });
  attachWsTrace(page, pi);
}
// Osobny nasłuch WebSocket (nie rusza licznika wsLog telefonu 1): pola wiersza quiz_sessions
// z ramek postgres_changes (regex na tekście ramki; oba formaty protokołu vsn 1.0/2.0).
function attachWsTrace(page, pi) {
  const dec = (pl) => (typeof pl === "string" ? pl : Buffer.isBuffer(pl) ? pl.toString("utf8") : String(pl ?? ""));
  const num = (v) => (v == null ? null : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : toMs(v));
  page.on("websocket", (ws) => {
    if (!ws.url().includes("realtime")) return;
    ws.on("framereceived", (f) => {
      const d = dec(f.payload);
      if (!/postgres_changes/.test(d) || !d.includes("plan_anchor_at")) return;
      if ((trace.raw ||= []).length < 4) trace.raw.push({ pi, frame: d.slice(0, 3000) });
      // Ramka to JSON: vsn 2.0 → [join_ref, ref, topic, event, payload], vsn 1.0 → { payload }.
      // Rekord Realtime ma spacje po dwukropku ("status": "running") — regex tylko jako fallback.
      let rec = null;
      try { const j = JSON.parse(d); rec = (Array.isArray(j) ? j[4] : j?.payload)?.data?.record ?? null; } catch {}
      const i = d.indexOf('"record"');
      const body = i >= 0 ? d.slice(i) : d;
      const g = (k) => {
        if (rec) return rec[k] == null ? null : String(rec[k]);
        const m = body.match(new RegExp(`"${k}":\\s*(null|"[^"]*"|-?\\d+(?:\\.\\d+)?)`));
        return !m || m[1] === "null" ? null : m[1].replace(/"/g, "");
      };
      // Ramka bez rozpoznanego wiersza (np. odpowiedź systemowa z listą kolumn) nie jest
      // stanem sesji — bez tego H1 liczyło fałszywe „stare snapshoty” (status ?, kotwica ∅).
      if (g("status") == null) return;
      trace.rows.push({ pi, t: Date.now(), status: g("status"),pausedMs: num(g("plan_paused_at")), anchorMs: num(g("plan_anchor_at")), holdIdx: g("plan_hold_idx") });
    });
  });
}

// ─── SCENARIUSZE TRYBÓW ──────────────────────────────────────────────────────
const modeRes = { refresh: [], offline: null, pause: null, errors: [] };
function startScenario(name, fn) {
  const sc = { name, done: false };
  scenarios.push(sc);
  fn().catch((e) => { modeRes.errors.push(`${name}: ${e.message}`); console.log(`   💥 scenariusz ${name}: ${e.message}`); })
    .finally(() => { sc.done = true; });
}
const rnd = (lo, hi) => lo + Math.random() * Math.max(0, hi - lo);
const planAt = (it, key) => anchorAt(srvNow()).anchorMs + it[key];   // termin planu w czasie serwera
async function waitSrv(target) { while (srvNow() < target) await sleep(Math.min(100, Math.max(5, target - srvNow()))); }
async function waitSample(samples, pred, timeoutMs, afterSrv = -Infinity) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const s = samples[samples.length - 1];
    if (s && s.srv > afterSrv && pred(s)) return s;
    await sleep(50);
  }
  return null;
}

// Porównanie telefonu pi z referencyjnym (0) na próbkach z okna [from, to] (czas serwera).
// Próbki przy granicach faz planu pomijamy — oba telefony przecinają granicę w innym ticku.
function compareWindow(samples, pi, from, to, { lock } = {}) {
  const r = { compared: 0, maxDiff: 0, mismatches: [] };
  for (const s of samples) {
    if (s.srv < from || s.srv > to) continue;
    const a = s.phones[0], b = s.phones[pi];
    if (a?.src !== "data" || b?.src !== "data") { r.mismatches.push(`${(s.at / 1000).toFixed(1)}s: telefon ${pi + 1} nie gotowy (${b?.phase})`); continue; }
    if (lock && b.q === lock.q && (!b.locked || b.choice !== lock.choice)) {
      r.mismatches.push(`${(s.at / 1000).toFixed(1)}s: odpowiedź q${lock.q} nie zablokowana (locked=${b.locked}, wybór ${b.choice} ≠ ${lock.choice})`);
    }
    if (nearBoundary(s.srv)) continue;
    r.compared++;
    if (!samePhase(a.phase, b.phase) || a.q !== b.q) { r.mismatches.push(`${(s.at / 1000).toFixed(1)}s: t1 ${a.phase} q${a.q} ≠ t${pi + 1} ${b.phase} q${b.q}`); continue; }
    if (a.timer != null && b.timer != null) {
      const d = Math.abs(a.timer - b.timer);
      r.maxDiff = Math.max(r.maxDiff, d);
      if (d > 1) r.mismatches.push(`${(s.at / 1000).toFixed(1)}s: licznik t1 ${a.timer}s ≠ t${pi + 1} ${b.timer}s`);
    }
  }
  return r;
}

// Jeden reload telefonu REF_PI w bieżącej fazie + porównanie przez 2 s po gotowości.
async function reloadAndCompare(ctx, label, lock = null) {
  const { samples, pages } = ctx;
  const pg = pages[REF_PI].page;
  const before = samples[samples.length - 1]?.phones[REF_PI];
  const res = { label, q: before?.q ?? null, phaseBefore: before?.phase, readyMs: null, maxDiff: null, compared: 0, problems: [] };
  const tStart = srvNow();
  console.log(`   🔄 reload telefonu ${REF_PI + 1}: ${label} (faza ${before?.phase}, q${before?.q}, licznik ${before?.timer}s)`);
  try { await pg.reload({ waitUntil: "domcontentloaded", timeout: 10000 }); } catch (e) { res.problems.push("reload: " + e.message.slice(0, 80)); }
  const tLoaded = srvNow();
  const ready = await waitSample(samples, (s) => s.phones[REF_PI]?.src === "data" && s.phones[REF_PI].phase !== "loading", 3000, tLoaded);
  (blind[REF_PI] ||= []).push([tStart, ready?.srv ?? srvNow()]);
  if (!ready) { res.problems.push("telefon nie odzyskał fazy w 3 s po reloadzie"); modeRes.refresh.push(res); return res; }
  res.readyMs = Math.round(ready.srv - tStart);
  await waitSrv(ready.srv + 2000);
  await sleep(300);   // ostatnia próbka okna musi trafić do tablicy
  const cmp = compareWindow(samples, REF_PI, ready.srv, ready.srv + 2000, { lock });
  res.maxDiff = cmp.maxDiff; res.compared = cmp.compared;
  res.problems.push(...cmp.mismatches);
  // Każda faza wystawiona po reloadzie (poza „loading”) musi zgadzać się z telefonem
  // referencyjnym z tej samej chwili — łapie mignięcia krótsze niż tick próbkowania.
  const hist = await pg.evaluate("window.__fuePhases || []").catch(() => []);
  for (const h of hist) {
    const srv = h.t + state.clockOff;
    if (h.phase === "loading" || srv > ready.srv + 2000) continue;
    // Udzielona przed reloadem odpowiedź musi być zablokowana od pierwszej klatki po reloadzie.
    if (lock && h.q === lock.q && (!h.locked || h.choice !== lock.choice)) {
      res.problems.push(`mignięcie odblokowanej odpowiedzi q${lock.q} ${Math.round(srv - tStart)} ms po reloadzie (${h.phase}, wybór ${h.choice})`);
    }
    if (nearBoundary(srv)) continue;
    const ref = samples.reduce((best, s) => (Math.abs(s.srv - srv) < Math.abs((best?.srv ?? Infinity) - srv) ? s : best), null)?.phones[0];
    if (ref?.src === "data" && !samePhase(ref.phase, h.phase)) {
      res.problems.push(`mignięcie fazy „${h.phase}” ${Math.round(srv - tStart)} ms po reloadzie (telefon 1: ${ref.phase})`);
    }
  }
  res.phaseSeq = hist.map((h) => h.phase).filter((p, i, a) => p !== a[i - 1]).join("→");
  if (!cmp.compared) res.problems.push("brak porównywalnych próbek w 2 s po reloadzie");
  modeRes.refresh.push(res);
  return res;
}

// SC2: reload w każdej fazie: intro (pyt.1), quiz przed odpowiedzią (pyt.1), countdown (pyt.2),
// quiz po odpowiedzi (pyt.2), reveal (pyt.3). Moment losowy w fazie, ≥ 1,5 s przed jej końcem.
async function refreshScenario(ctx) {
  const P = state.plan;
  const phaseOf = (it) => (it.lead >= 10 ? "intro" : "countdown");
  const at = async (lo, hi, label) => {
    const now = srvNow();
    const from = Math.max(lo, now + 300);
    if (from > hi) { modeRes.refresh.push({ label, problems: [`okno fazy minęło przed reloadem (spóźnienie ${Math.round(from - hi)} ms)`] }); return false; }
    await waitSrv(rnd(from, hi));
    return true;
  };
  // 1. intro/zapowiedź pytania 1
  if (await at(anchorAt(srvNow()).anchorMs + 500, planAt(P[0], "o") - 1500, `${phaseOf(P[0])} pyt.1`)) await reloadAndCompare(ctx, `${phaseOf(P[0])} pyt.1`);
  // 2. quiz pytania 1, zanim telefon odpowiedział
  if (await at(planAt(P[0], "o") + 500, planAt(P[0], "o") + Math.max(1000, (P[0].tpq - 8) * 1000), "quiz pyt.1 przed odpowiedzią")) {
    await reloadAndCompare(ctx, "quiz pyt.1 przed odpowiedzią");
  }
  ctx.noAuto.delete(`${REF_PI}:1`);   // teraz pętla może odpowiedzieć na pytanie 1
  // 3. odliczanie przed pytaniem 2
  if (await at(planAt(P[0], "r") + 300, planAt(P[1], "o") - 1500, `${phaseOf(P[1])} pyt.2`)) await reloadAndCompare(ctx, `${phaseOf(P[1])} pyt.2`);
  // 4. quiz pytania 2 po odpowiedzi: klik, czekamy na blokadę, reload — wybór ma przetrwać
  const q2 = await waitSample(ctx.samples, (s) => s.phones[REF_PI]?.phase === "quiz" && s.phones[REF_PI]?.q === 2, 15000);
  if (!q2) modeRes.refresh.push({ label: "quiz pyt.2 po odpowiedzi", problems: ["telefon nie wszedł w pytanie 2"] });
  else {
    const k = Math.floor(Math.random() * 4);
    await ctx.pages[REF_PI].page.locator("button.ans-btn").nth(k).click({ timeout: 3000 }).catch(() => {});
    const lockedS = await waitSample(ctx.samples, (s) => s.phones[REF_PI]?.locked && s.phones[REF_PI]?.q === 2, 3000);
    const choice = lockedS?.phones[REF_PI]?.choice ?? null;
    if (!lockedS || choice !== "ABCD"[k]) modeRes.refresh.push({ label: "quiz pyt.2 po odpowiedzi", problems: [`odpowiedź ${"ABCD"[k]} nie zablokowała się przed reloadem (wybór ${choice})`] });
    else if (await at(srvNow() + 300, planAt(P[1], "c") - 5500, "quiz pyt.2 po odpowiedzi")) {
      await reloadAndCompare(ctx, "quiz pyt.2 po odpowiedzi", { q: 2, choice });
    }
  }
  // 5. odsłonięcie pytania 3
  if (await at(planAt(P[2], "c") + 300, planAt(P[2], "r") - 1500, "reveal pyt.3")) await reloadAndCompare(ctx, "reveal pyt.3");
}

// SC3: telefon OFF_PI offline 10 s w środku pytania 2, odpowiedź klikana w trakcie offline.
async function offlineScenario(ctx) {
  const it = state.plan[1];
  const page = ctx.pages[OFF_PI].page, bctx = ctx.pages[OFF_PI].ctx;
  const res = { tpq: it.tpq, problems: [], choice: null, lockedOffline: false, variant: null, syncMs: null, maxDiffOffline: 0, maxDiffAfter: 0, dbChosen: undefined };
  modeRes.offline = res;
  await waitSrv(planAt(it, "o") + 5000);
  const tOff = srvNow();
  await bctx.setOffline(true);
  console.log(`   📴 telefon ${OFF_PI + 1} offline (pytanie 2, ${((tOff - planAt(it, "o")) / 1000).toFixed(1)} s po otwarciu)`);
  await sleep(2000);
  const k = Math.floor(Math.random() * 4);
  res.choice = "ABCD"[k];
  await page.locator("button.ans-btn").nth(k).click({ timeout: 3000 }).catch((e) => res.problems.push("klik offline: " + e.message.slice(0, 60)));
  const lk = await waitSample(ctx.samples, (s) => s.phones[OFF_PI]?.locked && s.phones[OFF_PI]?.q === 2, 2000);
  res.lockedOffline = !!lk && lk.phones[OFF_PI].choice === res.choice;
  await waitSrv(tOff + 10000);
  const tOn = srvNow();
  await bctx.setOffline(false);
  const closesGate = planAt(it, "c") + 1500;
  res.variant = tOn < closesGate ? "powrót przed terminem → zapis w bazie" : "powrót po terminie → komunikat o niezapisaniu";
  console.log(`   📶 telefon ${OFF_PI + 1} online (${((closesGate - tOn) / 1000).toFixed(1)} s przed bramką pytania)`);
  await waitSrv(tOn + 4000);
  await sleep(300);
  // przez cały czas offline: faza/pytanie/licznik zgodne z telefonem 1 (projekcja lokalna)
  const off = compareWindow(ctx.samples, OFF_PI, tOff + 300, tOn);
  res.maxDiffOffline = off.maxDiff;
  if (!off.compared) res.problems.push("offline: brak porównywalnych próbek");
  res.problems.push(...off.mismatches.map((m) => "offline " + m));
  // ≤ 1 s po powrocie: pełna zgodność (faza, pytanie, licznik, zablokowany wybór)
  const lock = { q: 2, choice: res.choice };
  const aft = compareWindow(ctx.samples, OFF_PI, tOn + 1000, tOn + 4000, { lock });
  res.maxDiffAfter = aft.maxDiff;
  res.problems.push(...aft.mismatches.map((m) => "po powrocie " + m));
  const firstSync = ctx.samples.find((s) => s.srv >= tOn && compareWindow([s], OFF_PI, s.srv, s.srv, { lock }).mismatches.length === 0);
  res.syncMs = firstSync ? Math.max(0, Math.round(firstSync.srv - tOn)) : null;
  // odpowiedź z offline
  if (tOn < closesGate) {
    const until = Date.now() + 8000;
    let row = null;
    while (Date.now() < until) {
      const { data } = await svc.from("answers").select("chosen").eq("session_id", state.sessionId)
        .eq("participant_code", state.codes[OFF_PI].code).eq("question_id", it.id).maybeSingle();
      if (data) { row = data; break; }
      await sleep(500);
    }
    res.dbChosen = row ? row.chosen : null;
    if (!row) res.problems.push("odpowiedź z czasu offline nie trafiła do bazy");
    else if (row.chosen !== k) res.problems.push(`w bazie zapisano ${row.chosen} zamiast ${k}`);
  } else {
    const failedShown = ctx.samples.some((s) => s.srv >= tOn && s.phones[OFF_PI]?.saveFailed);
    if (!failedShown) res.problems.push("powrót po terminie, a telefon nie pokazał „Nie udało się zapisać odpowiedzi”");
  }
}

// ─── PAUZA W ZADANEJ FAZIE (PROBE_PAUSE_PHASE, diagnoza G2) ─────────────────
// Koniec fazy `pos` (z planPosition) przy kotwicy `anchor`: quiz → c, reveal → r, intro/countdown → o.
function phaseEnd(pos, anchor) {
  if (!pos?.item || anchor == null) return null;
  if (pos.phase === "quiz") return anchor + pos.item.c;
  if (pos.phase === "reveal") return anchor + pos.item.r;
  return anchor + pos.item.o;
}
// Oś czasu faz telefonu (czas serwera): z historii MutationObserver (dokładna chwila zmiany
// w DOM), a gdy jej brak — z próbek co 250 ms.
function phoneTimeline(hist, samples, pi) {
  if (hist && hist.length) return hist.map((h) => ({ srv: h.t + state.clockOff, phase: h.phase, q: h.q, src: "dom" }));
  return samples.map((s) => ({ srv: s.srv, phase: s.phones[pi]?.phase, q: s.phones[pi]?.q, src: "próbki" }));
}
// Stany telefonu w oknie [from, to]: stan obowiązujący na początku okna + każda zmiana w oknie.
function phasesIn(tl, from, to) {
  let lastBefore = null;
  const out = [];
  for (const e of tl) { if (e.srv <= from) lastBefore = e; else if (e.srv <= to) out.push(e); }
  return lastBefore ? [{ ...lastBefore, srv: from }, ...out] : out;
}
async function waitMonitor(pred, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const m = state.monitor.find(pred);
    if (m) return m;
    await sleep(100);
  }
  return null;
}

async function pausePhaseScenario(ctx) {
  const { samples, pages, admin } = ctx;
  const P = state.plan;
  const reveal = PAUSE_PHASE === "reveal";
  const it = P[PAUSE_Q - 1], nx = P[PAUSE_Q];
  const expQ = reveal ? PAUSE_Q : PAUSE_Q + 1;
  const res = { phase: PAUSE_PHASE, q: PAUSE_Q, expQ, status: "OK", reason: null, problems: [], phones: [] };
  modeRes.pause = res;
  if (!it || !nx) { res.status = "NIEWYKONANY"; res.reason = `plan ma ${P.length} pytań — za mało dla pytania ${PAUSE_Q}`; return; }
  // Nazwa fazy w data-fue-phase: odliczanie przed pierwszym pytaniem modułu to „intro”.
  const wantPhase = reveal ? "reveal" : (nx.lead >= 10 ? "intro" : "countdown");
  res.wantPhase = wantPhase;

  // a. Okno kliknięcia liczone NA BIEŻĄCO — auto-skrót (tpq ≥ 45 s) i każda zmiana kotwicy
  //    przesuwają terminy; cel zachowuje względną pozycję w oknie.
  const win = (a) => (reveal ? [a + it.c + 2000, a + it.r - 2000] : [a + it.r + 500, a + nx.o - 1500]);
  const frac = Math.random();
  let anchor, lo = 0, hi = 0, target = 0;
  for (;;) {
    const a = anchorAt(srvNow()).anchorMs;
    if (a !== anchor) { anchor = a; [lo, hi] = win(a); target = lo + frac * Math.max(0, hi - lo); }
    const now = srvNow();
    const p1 = samples[samples.length - 1]?.phones[0];
    if (now > hi) {
      res.status = "NIEWYKONANY";
      res.reason = `okno kliknięcia minęło (telefon 1: ${p1?.phase} q${p1?.q}, oczekiwano ${wantPhase} q${expQ})`;
      console.log(`   ⚠️ pauza: ${res.reason}`);
      return;
    }
    if (now >= target && p1?.phase === wantPhase && p1.q === expQ) break;
    await sleep(100);
  }

  // b. Klik „Pauza” (confirm auto-akceptowany; po 06-16 ewentualnie drugi klik uzbrojonego przycisku).
  res.before = samples[samples.length - 1].phones.map((p) => ({ phase: p?.phase, q: p?.q, timer: p?.timer }));
  res.tClick = srvNow();
  console.log(`   ⏸  pauza w fazie ${wantPhase} pyt.${expQ} (licznik t1 ${res.before[0]?.timer ?? "—"}s)`);
  await admin.getByRole("button", { name: /Pauza/ }).first().click({ timeout: 5000 })
    .catch((e) => res.problems.push("klik Pauza: " + e.message.slice(0, 60)));
  const armed = admin.getByRole("button", { name: /Kliknij ponownie, aby wstrzymać/ });
  if (await armed.count().catch(() => 0)) {
    res.armed = true;
    await armed.first().click({ timeout: 1000 }).catch(() => {});
  }

  // c. Gdzie pauza REALNIE wylądowała (H4: confirm/klik → baza).
  const mP = await waitMonitor((m) => m.pausedMs != null && m.pausedMs >= res.tClick - 1000, 5000);
  if (!mP) { res.status = "BŁĄD"; res.problems.push("P1 pauza nie dotarła do bazy w 5 s po kliknięciu"); return; }
  res.pausedAt = mP.pausedMs;
  res.anchorAtPause = mP.anchorMs;
  res.clickToDbMs = Math.round(res.pausedAt - res.tClick);
  const landed = planPosition(P, res.anchorAtPause, null, res.pausedAt);
  res.landed = landed ? { phase: landed.phase, idx: landed.idx } : null;
  res.remainingLanded = landed ? Math.round(phaseEnd(landed, res.anchorAtPause) - res.pausedAt) : null;
  const hit = !!landed && landed.phase === wantPhase && landed.idx + 1 === expQ;
  if (!hit) {
    res.status = "NIEWYKONANY";
    res.reason = `pauza wylądowała w ${landed?.phase} q${landed ? landed.idx + 1 : "?"} zamiast ${wantPhase} q${expQ} (klik→baza ${res.clickToDbMs} ms)`;
    console.log(`   ⚠️ ${res.reason}`);
  }

  // d. Trzymamy pauzę, potem „Wznów quiz”.
  await waitSrv(res.pausedAt + PAUSE_HOLD_MS);
  res.during = [...samples].reverse().find((s) => s.srv > res.pausedAt && s.phones.every((p) => p?.phase === "paused"))
    ?.phones.map((p) => ({ phase: p.phase, q: p.q, timer: p.timer })) ?? null;
  res.tResumeClick = srvNow();
  await admin.getByRole("button", { name: /Wznów quiz/ }).first().click({ timeout: 5000 })
    .catch((e) => res.problems.push("klik Wznów: " + e.message.slice(0, 60)));
  const mR = await waitMonitor((m) => m.srv >= res.tResumeClick && m.status === "running" && m.pausedMs == null && m.anchorMs != null, 5000);
  if (!mR) { if (res.status === "OK") res.status = "BŁĄD"; res.problems.push("P5 wznowienie nie dotarło do bazy w 5 s"); return; }
  res.newAnchor = mR.anchorMs;
  // Chwila wznowienia w bazie: resume przesuwa kotwicę o czas pauzy (now − plan_paused_at),
  // więc now_resume = pausedAt + (newAnchor − anchorAtPause) — dokładniej niż odczyt monitora co 1 s.
  const exact = res.pausedAt + (res.newAnchor - res.anchorAtPause);
  res.tResumeDb = exact >= res.tResumeClick - 1000 && exact <= mR.srv + 200 ? exact : mR.srv;
  console.log(`   ▶️  wznowienie (klik→baza ${Math.round(res.tResumeDb - res.tResumeClick)} ms)`);
  if (res.status === "NIEWYKONANY") return;

  // e. PIERWSZA próbka po wznowieniu z wszystkimi telefonami poza pauzą — bez dodatkowego czekania.
  const dl = Date.now() + 3000;
  let after = null;
  while (!after && Date.now() < dl) {
    after = samples.find((s) => s.srv > res.tResumeDb && s.phones.every((p) => p?.src === "data" && p.phase !== "paused"));
    if (!after) await sleep(50);
  }
  if (after) res.after = { srv: after.srv, phones: after.phones.map((p) => ({ phase: p.phase, q: p.q, timer: p.timer })) };
  await waitSrv(res.tResumeDb + 6300);
  await sleep(300);

  // f. Asercje P1–P6 — czasy zmian ekranu z historii DOM (MutationObserver), gdy jest.
  const hist = await Promise.all(pages.map((x) => x.page.evaluate("window.__fuePhases || []").catch(() => [])));
  const tls = pages.map((_, pi) => phoneTimeline(hist[pi], samples, pi));
  const L = res.landed.idx + 1;
  tls.forEach((tl, pi) => {
    const tag = `telefon ${pi + 1}`;
    const ph = { src: tl[0]?.src ?? "—" };
    res.phones.push(ph);
    // P1 wejście w pauzę ≤ 1500 ms po plan_paused_at
    const ent = tl.find((e) => e.srv >= res.tClick - 500 && e.phase === "paused");
    ph.enterMs = ent ? Math.round(ent.srv - res.pausedAt) : null;
    if (ph.enterMs == null || ph.enterMs > 1500) res.problems.push(`P1 ${tag} wszedł w pauzę ${ph.enterMs == null ? "nigdy" : ph.enterMs + " ms"} po pauzie w bazie (limit 1500)`);
    // P2 pytanie w trakcie pauzy
    const d = res.during?.[pi];
    if (!d) res.problems.push(`P2 ${tag}: brak próbki, w której wszystkie telefony są w pauzie`);
    else if (d.q !== L) res.problems.push(`P2 ${tag}: w pauzie pytanie q${d.q} zamiast q${L}`);
    // P4 ucieczka z pauzy (H1)
    const esc = phasesIn(tl, res.pausedAt + 1500, res.tResumeDb).filter((e) => e.phase !== "paused");
    ph.escapes = esc.length;
    if (esc.length) res.problems.push(`P4 ${tag} uciekł z pauzy: ${esc[0].phase} q${esc[0].q} ${Math.round(esc[0].srv - res.pausedAt)} ms po pauzie (przed wznowieniem)`);
    // P5 utknięcie w pauzie (H1)
    const stuck = phasesIn(tl, res.tResumeDb + 1500, res.tResumeDb + 6000).filter((e) => e.phase === "paused");
    ph.stuck = stuck.length;
    if (stuck.length) res.problems.push(`P5 ${tag} utknął w pauzie ${Math.round(stuck[stuck.length - 1].srv - res.tResumeDb)} ms po wznowieniu`);
  });
  // P3 stan po wznowieniu — oczekiwany dla chwili próbki, od NOWEJ kotwicy.
  if (!res.after) res.problems.push("P3 w 3 s po wznowieniu nie wszystkie telefony wyszły z pauzy");
  else {
    const exp = planPosition(P, res.newAnchor, null, res.after.srv);
    const bound = phaseEnd(exp, res.newAnchor);
    const expTimer = bound != null ? Math.ceil((bound - res.after.srv) / 1000) : null;
    res.exp = { phase: exp?.phase, q: exp ? exp.idx + 1 : null, timer: expTimer };
    res.after.phones.forEach((p, pi) => {
      if (!exp || p.q !== exp.idx + 1 || !samePhase(p.phase, exp.phase)) {
        res.problems.push(`P3 telefon ${pi + 1} po wznowieniu ${p.phase} q${p.q} zamiast ${exp?.phase} q${exp ? exp.idx + 1 : "?"}`);
      } else if (p.timer != null && expTimer != null && Math.abs(p.timer - expTimer) > 1) {
        res.problems.push(`P3 telefon ${pi + 1} licznik po wznowieniu ${p.timer}s zamiast ${expTimer}s (±1)`);
      }
    });
    // Faza nie mogła się jeszcze legalnie zmienić, jeśli do jej końca zostało więcej, niż minęło od wznowienia.
    if (res.remainingLanded > (res.after.srv - res.tResumeDb) + 300 && exp && (exp.phase !== res.landed.phase || exp.idx !== res.landed.idx)) {
      res.problems.push(`P3 plan po wznowieniu (${exp.phase} q${exp.idx + 1}) ≠ faza pauzy (${res.landed.phase} q${L}), choć zostało ${res.remainingLanded} ms fazy`);
    }
  }
}

// Raport trybów REFRESH / OFFLINE (dopisuje FAIL-e do `fail`).
function reportModes(fail) {
  for (const e of modeRes.errors) fail.push(`scenariusz ${e}`);
  if (PAUSE_PHASE) {
    const r = modeRes.pause;
    console.log(`\n⏸  PAUZA W FAZIE ${PAUSE_PHASE} (pyt. ${PAUSE_Q})`);
    if (!r || r.status === "NIEWYKONANY") {
      state.pauseNotRun = true;
      console.log(`   ⚠️  PAUZA: przebieg niewykonany — powtórz${r?.reason ? ` (${r.reason})` : ""}`);
    }
    if (r) {
      const fmt = (p) => (p ? `${p.phase} q${p.q ?? "-"} ${p.timer ?? "-"}s` : "—");
      if (r.landed) console.log(`   wylądowała: ${r.landed.phase} q${r.landed.idx + 1} (zostało ${r.remainingLanded} ms fazy)  ·  klik→baza ${r.clickToDbMs} ms${r.armed ? "  ·  przycisk uzbrojony (2 kliki)" : ""}`);
      if (r.tResumeDb != null) console.log(`   wznowienie: klik→baza ${Math.round(r.tResumeDb - r.tResumeClick)} ms  ·  pierwsza próbka po wznowieniu +${r.after ? Math.round(r.after.srv - r.tResumeDb) : "—"} ms`);
      if (r.exp) console.log(`   oczekiwane po wznowieniu (od nowej kotwicy, w chwili próbki): ${r.exp.phase} q${r.exp.q} ${r.exp.timer ?? "-"}s`);
      (r.before || []).forEach((b, i) => {
        const ph = r.phones[i] || {};
        console.log(`   t${i + 1}: ${fmt(b)} → pauza ${fmt(r.during?.[i])} → ${fmt(r.after?.phones[i])}` +
          `  (wejście w pauzę ${ph.enterMs ?? "—"} ms, ucieczki ${ph.escapes ?? "—"}, utknięcia ${ph.stuck ?? "—"}, czas z: ${ph.src ?? "—"})`);
      });
      const byP = (k) => r.problems.filter((p) => p.startsWith(k));
      const labels = {
        P1: "wejście w pauzę ≤ 1500 ms", P2: "pytanie w trakcie pauzy", P3: "stan po wznowieniu (faza/pytanie/licznik ±1 s)",
        P4: "brak ucieczki z pauzy (H1)", P5: "brak utknięcia w pauzie (H1)",
      };
      if (r.status !== "NIEWYKONANY") {
        for (const k of ["P1", "P2", "P3", "P4", "P5"]) {
          const ps = byP(k);
          console.log(`   ${ps.length ? "❌" : "✅"} ${k} ${labels[k]}`);
          for (const p of ps.slice(0, 3)) console.log(`      • ${p}`);
          for (const p of ps) fail.push(`PAUZA ${p}`);
        }
      }
      console.log(`   ℹ️  P6 (H4) klik→baza ${r.clickToDbMs ?? "—"} ms, faza lądowania ${r.landed ? `${r.landed.phase} q${r.landed.idx + 1}` : "—"}`);
      for (const p of r.problems.filter((x) => !/^P[1-5] /.test(x))) { console.log(`   ❌ ${p}`); fail.push(`PAUZA ${p}`); }
    }
  }
  if (REFRESH) {
    const rs = modeRes.refresh;
    const diffs = rs.filter((r) => r.maxDiff != null).map((r) => r.maxDiff);
    const maxD = diffs.length ? Math.max(...diffs) : null;
    console.log(`\n🔄 REFRESH (telefon ${REF_PI + 1} vs telefon 1) — różnica licznika po refreshu: maks. ${maxD ?? "—"}s`);
    for (const r of rs) {
      const ok = !r.problems.length;
      console.log(`   ${ok ? "✅" : "❌"} ${r.label.padEnd(28)} powrót ${r.readyMs != null ? r.readyMs + " ms" : "—"}  różnica licznika po refreshu ${r.maxDiff ?? "—"}s  (${r.compared ?? 0} próbek)`);
      if (r.phaseSeq) console.log(`      fazy po reloadzie: ${r.phaseSeq}`);
      for (const p of r.problems.slice(0, 4)) console.log(`      • ${p}`);
      if (!ok) fail.push(`REFRESH ${r.label}: ${r.problems[0]}`);
    }
    const want = 5;
    if (rs.length < want) fail.push(`REFRESH: wykonano ${rs.length}/${want} reloadów`);
    if (maxD != null && maxD > 1) fail.push(`REFRESH: różnica licznika po refreshu ${maxD}s > 1s`);
  }
  if (OFFLINE) {
    const o = modeRes.offline;
    console.log(`\n📴 OFFLINE (telefon ${OFF_PI + 1}, 10 s w pytaniu 2, tpq ${o?.tpq ?? "?"}s)`);
    if (!o) { fail.push("OFFLINE: scenariusz się nie wykonał"); return; }
    console.log(`   wariant: ${o.variant}`);
    console.log(`   licznik w trakcie offline: maks. różnica ${o.maxDiffOffline}s  ·  po powrocie: ${o.maxDiffAfter}s  ·  pełna zgodność ${o.syncMs != null ? o.syncMs + " ms" : "—"} po powrocie`);
    console.log(`   odpowiedź offline ${o.choice}: blokada w UI ${o.lockedOffline ? "TAK" : "NIE"}, w bazie ${o.dbChosen === undefined ? "—" : o.dbChosen === null ? "BRAK" : "ABCD"[o.dbChosen]}`);
    if (!o.lockedOffline) o.problems.push("wybór offline nie zablokował się w UI");
    if (o.syncMs == null || o.syncMs > 1000) o.problems.push(`pełna zgodność po powrocie ${o.syncMs ?? "—"} ms (limit 1000)`);
    for (const p of o.problems.slice(0, 6)) console.log(`   ❌ ${p}`);
    if (o.problems.length) fail.push(`OFFLINE: ${o.problems[0]}`);
    else console.log("   ✅ zgodność offline i po powrocie, odpowiedź z offline zapisana");
  }
}

// ─── DIAGNOZA PRZYCZYNOWA (tylko z PROBE_TRACE=1) ────────────────────────────
// Wskaźniki hipotez G2/G7 (06-13): H1 stary snapshot vs Realtime, H2 View Transitions,
// H5 skok offsetu zegara telefonu, H6 artefakt próbkowania (DOM vs próbka), H4 (pauza).
function diagnose(t0) {
  const tr = state.phoneTrace || [];
  const rel = (t) => `${((t - t0) / 1000).toFixed(1)}s`;
  const sgn = (v) => `${v >= 0 ? "+" : ""}${v}`;
  const devs = state.startDevs || [];
  console.log("\n🔍 DIAGNOZA (PROBE_TRACE)");

  console.log("   H2 — View Transitions (startViewTransition: call → callback):");
  tr.forEach((t, pi) => {
    const vt = t.vt || [];
    const lat = vt.filter((r) => r.cb != null).map((r) => r.cb - r.call);
    const noCb = vt.filter((r) => r.cb == null).length;
    const ov = vt.filter((r) => r.overlap).length;
    console.log(`     telefon ${pi + 1}: ${vt.length} VT, maks. cb−call ${lat.length ? Math.max(...lat) : "—"} ms, bez callbacku ${noCb}, nakładające się ${ov}`);
    const starts = devs.filter((d) => d.pi === pi && d.tLocal != null).map((d) => {
      const v = [...vt].reverse().find((r) => r.call <= d.tLocal);
      return v ? `q${d.q}: VT ${d.tLocal - v.call} ms przed DOM, cb−call ${v.cb != null ? v.cb - v.call : "∞"} ms${v.overlap ? " (overlap)" : ""}` : `q${d.q}: brak VT`;
    });
    if (starts.length) console.log(`       starty: ${starts.join("  ")}`);
  });

  console.log("   H5 — zegar telefonu (serverNow offset) vs sonda:");
  tr.forEach((t, pi) => {
    const cl = t.clock || [];
    let jump = 0;
    for (let i = 1; i < cl.length; i++) jump = Math.max(jump, Math.abs((cl[i].offset ?? 0) - (cl[i - 1].offset ?? 0)));
    const rtts = cl.map((c) => c.rtt).filter((x) => x != null);
    const at = devs.filter((d) => d.pi === pi).map((d) => {
      const tl = d.tLocal ?? d.tSampleLocal;
      const c = tl != null ? [...cl].reverse().find((x) => x.t <= tl) : null;
      if (!c) return `q${d.q}: —`;
      const diff = c.offset - state.clockOff;
      return `q${d.q}: ${sgn(diff)}ms${Math.abs(diff) > 300 ? " ⚠️" : ""}`;
    });
    console.log(`     telefon ${pi + 1}: ${cl.length} próbek, maks. skok offsetu ${jump} ms, maks. RTT ${rtts.length ? Math.max(...rtts) : "—"} ms`);
    if (at.length) console.log(`       offset telefonu − sondy przy starcie: ${at.join("  ")}`);
  });

  console.log("   H1 — stare snapshoty (wysłane przed wierszem Realtime, odebrane po nim, inny stan):");
  const neq = (a, b) => (a == null) !== (b == null) || (a != null && Math.abs(a - b) > 2);
  const st = (x) => `${x.status ?? "?"}/p=${x.pausedMs != null ? rel(x.pausedMs - state.clockOff) : "∅"}/a=${x.anchorMs != null ? rel(x.anchorMs - state.clockOff) : "∅"}`;
  state.staleSnaps = [];
  for (let pi = 0; pi < state.codes.length; pi++) {
    const snaps = trace.snaps.filter((s) => s.pi === pi && s.resp != null);
    const rows = trace.rows.filter((r) => r.pi === pi);
    const stale = [];
    for (const s of snaps) {
      for (const r of rows) {
        if (s.req < r.t && r.t < s.resp && (s.status !== r.status || neq(s.pausedMs, r.pausedMs) || neq(s.anchorMs, r.anchorMs))) stale.push({ s, r });
      }
    }
    state.staleSnaps.push(stale.length);
    console.log(`     telefon ${pi + 1}: ${snaps.length} snapshotów, ${rows.length} wierszy Realtime, starych snapshotów: ${stale.length}`);
    for (const { s, r } of stale.slice(0, 5)) {
      console.log(`       snapshot ${rel(s.req)}→${rel(s.resp)} ${st(s)}  vs  wiersz ${rel(r.t)} ${st(r)}`);
    }
  }

  console.log("   H6 — start pytania: DOM (MutationObserver) vs próbka co 250 ms:");
  for (let pi = 0; pi < state.codes.length; pi++) {
    const ds = devs.filter((d) => d.pi === pi);
    if (!ds.length) continue;
    console.log(`     telefon ${pi + 1}: ${ds.map((d) => `q${d.q} DOM ${d.devDom != null ? sgn(d.devDom) : "—"} / próbka ${d.devSample != null ? sgn(d.devSample) : "—"}`).join("  ")}`);
  }

  const p = modeRes.pause;
  if (p) console.log(`   H4 — pauza: klik→baza ${p.clickToDbMs ?? "—"} ms, lądowanie ${p.landed ? `${p.landed.phase} q${p.landed.idx + 1}` : "—"} (cel ${p.wantPhase ?? PAUSE_PHASE} q${p.expQ})`);
}

// Zrzut surowych danych do test-results/ (katalog w .gitignore) — wejście dla 06-DIAG-G2-G7.md.
function dumpTrace(samples) {
  try {
    const mode = [FULL && "full", PAUSE_PHASE && `pauza-${PAUSE_PHASE}`, ADMIN_EXIT && "adminexit",
      REFRESH && "refresh", OFFLINE && "offline"].filter(Boolean).join("-") || "podst";
    fs.mkdirSync("test-results", { recursive: true });
    const file = `test-results/probe-trace-${new Date().toISOString().replace(/:/g, "")}-${mode}.json`;
    const phones = state.codes.map((_, pi) => ({
      phases: state.phoneTrace?.[pi]?.phases || [], vt: state.phoneTrace?.[pi]?.vt || [],
      clock: state.phoneTrace?.[pi]?.clock || [],
      snaps: trace.snaps.filter((s) => s.pi === pi), rows: trace.rows.filter((r) => r.pi === pi),
      blind: blind[pi] || [],
    }));
    fs.writeFileSync(file, JSON.stringify({
      mode, clockOff: state.clockOff, anchorMs: state.anchorMs, plan: state.plan,
      startDevs: state.startDevs, pause: modeRes.pause, samples, monitor: state.monitor, phones, rawFrames: trace.raw || [],
    }));
    console.log(`   💾 zrzut: ${file}`);
  } catch (e) {
    console.log(`   ⚠️ zrzut śladu nieudany: ${e.message}`);
  }
}

// ─── RAPORT ──────────────────────────────────────────────────────────────────
// Etap FULL: przerwy planowe (sekcja 42) — każda obsłużona, a w jej trakcie wszystkie
// telefony w fazie „paused” (i data-fue-break="1", jeśli klient wystawia ten atrybut — 06-15).
function breakStage(plan, samples, flow) {
  const want = plan.filter((x) => x.h).length;
  const name = "przerwy planowe po modułach 2 i 4";
  if (!want) return [name, true, "brak przerw w planie"];
  const log = flow.breakLog || [];
  const bad = [];
  for (const b of log) {
    const ss = samples.filter((s) => s.srv >= b.seenSrv + 500 && s.srv <= b.clickSrv - 200);
    const s = ss.find((x) => x.phones.some((p) => p?.phase !== "paused" || (p?.brk != null && p.brk !== "1")));
    if (s) {
      const p = s.phones.find((x) => x?.phase !== "paused" || (x?.brk != null && x.brk !== "1"));
      bad.push(`przerwa ${b.holdIdx + 1}: telefon w ${p?.phase} (break=${p?.brk ?? "—"}) w ${(s.at / 1000).toFixed(1)}s`);
    }
    if (!ss.length) bad.push(`przerwa ${b.holdIdx + 1}: brak próbek w trakcie przerwy`);
  }
  const ok = (flow.breaks?.size ?? 0) === want && !bad.length;
  return [name, ok, `${flow.breaks?.size ?? 0}/${want}${bad.length ? "; " + bad.join("; ") : ""}`];
}

function report(samples, tpq, t0) {
  const fail = [];
  const plan = state.plan || [];
  const lastIt = plan[plan.length - 1];
  const expOf = (q) => { const it = plan[q - 1]; return it ? (it.r - it.o) / 1000 : tpq + 6; };
  console.log("\n" + "═".repeat(60));
  console.log("📈 RAPORT SONDY");
  console.log("═".repeat(60));

  // 1. czas widoczności pytań (quiz + reveal) na telefonie 1 — oczekiwany z planu (r − o).
  // Pytanie bywa PRZERWANE pauzą i wraca na ten sam numer — sumujemy czas per numer.
  const byQ = new Map();
  let prevSeenQ = null, prevAt = null;
  for (const s of samples) {
    const p = s.phones[0];
    const isQ = (p?.phase === "quiz" || p?.phase === "reveal") && p.q != null;
    if (isQ) {
      if (!byQ.has(p.q)) byQ.set(p.q, 0);
      if (prevSeenQ === p.q && prevAt != null) byQ.set(p.q, byQ.get(p.q) + (s.at - prevAt));
      prevSeenQ = p.q; prevAt = s.at;
    } else { prevSeenQ = null; prevAt = null; }
  }
  const seg = [...byQ.entries()].sort((a, b) => a[0] - b[0]).map(([q, ms]) => ({ q, ms }));
  console.log(`\n⏱️  Czas widoczności pytań (pytanie + odsłonięcie; oczekiwany z planu):`);
  const runEnd = samples[samples.length - 1]?.at ?? 0;
  const lastPhase = samples[samples.length - 1]?.phones?.[0]?.phase;
  const truncated = (lastPhase === "quiz" || lastPhase === "reveal") && runEnd >= RUN_MS - 1000;
  seg.forEach((g, i) => {
    const d = g.ms / 1000, exp = expOf(g.q);
    const skip = i === seg.length - 1 && truncated;
    const bad = !skip && Math.abs(d - exp) > 2;
    if (bad) fail.push(`pytanie ${g.q} było widoczne ${d.toFixed(1)}s zamiast ~${exp}s`);
    console.log(`   pyt.${g.q}: ${d.toFixed(1)}s / plan ${exp}s ${skip ? "(ucięte limitem czasu — pomijam)" : bad ? "❌" : "✅"}`);
  });
  if (seg.length < NQ) fail.push(`telefon 1 widział ${seg.length}/${NQ} pytań`);
  const legacySeen = samples.some((s) => s.phones.some((p) => p?.phase === "legacy"));
  if (legacySeen) fail.push("telefon pokazał ekran „legacy” — sesja bez planu po stronie klienta");

  // 2. host vs telefon (pominięte, gdy przeglądarka admina zamknięta)
  let diff = 0, paired = 0, run = 0, maxRun = 0;
  for (const s of samples) {
    const aq = s.admin?.q, pq = s.phones[0]?.q;
    if (aq == null || pq == null) { run = 0; continue; }
    paired++;
    if (aq !== pq) { run += 250; maxRun = Math.max(maxRun, run); diff++; } else run = 0;
  }
  const pct = paired ? (diff / paired) * 100 : 0;
  const hostBad = maxRun > 1500;
  if (hostBad) fail.push(`host spóźniał się do ${maxRun} ms`);
  if (ADMIN_EXIT && !paired) console.log("\n🖥️  Host vs telefon: pominięte (przeglądarka admina zamknięta po starcie)");
  else console.log(`\n🖥️  Host vs telefon: ${pct.toFixed(1)}% rozbieżnych próbek, najdłuższy ciągły rozjazd ${maxRun} ms ${hostBad ? "❌" : "✅"}`);

  // 3. telefon vs telefon — ta sama faza i pytanie, próbki z dala od granic faz planu.
  let tmax = 0, tmaxAt = null;
  const TIMED = new Set(["intro", "countdown", "quiz", "reveal", "paused"]);
  for (const s of samples) {
    const ok = s.phones.filter((p) => p?.src === "data" && TIMED.has(p.phase) && p.timer != null);
    if (ok.length < 2 || nearBoundary(s.srv)) continue;
    if (new Set(ok.map((p) => `${p.phase}:${p.q}`)).size > 1) continue;
    const ts = ok.map((p) => p.timer);
    const d = Math.max(...ts) - Math.min(...ts);
    if (d > tmax) { tmax = d; tmaxAt = s.at; }
  }
  const phoneBad = tmax > 1;
  if (phoneBad) fail.push(`telefony rozjechane o ${tmax}s (w ${(tmaxAt / 1000).toFixed(1)}s przebiegu)`);
  console.log(`📱 Telefon vs telefon: maks. różnica licznika ${tmax}s ${phoneBad ? "❌" : "✅"}`);

  // 4. zacięcia — liczymy tylko czas w fazie quiz na tym samym pytaniu; zapowiedź,
  // odliczanie, odsłonięcie, przerwa i ekrany końcowe to legalne stany bez zmiany pytania.
  const LEGIT = new Set(["intro", "countdown", "reveal", "paused", "finished", "results", "lobby", "loading", "err"]);
  let stall = 0, spanFrom = null, spanLegit = false, prevQ = null;
  for (const s of samples) {
    const p = s.phones[0];
    const isQ = p?.phase === "quiz" && p.q != null;
    if (isQ && p.q !== prevQ) { prevQ = p.q; spanFrom = s.at; spanLegit = false; continue; }
    if (isQ) { if (spanFrom != null && !spanLegit) stall = Math.max(stall, s.at - spanFrom); continue; }
    if (LEGIT.has(p?.phase)) spanLegit = true;
  }
  const maxQ = plan.length ? Math.max(...plan.map((it) => (it.c - it.o) / 1000)) : tpq;
  const stallLimit = (maxQ + 3) * 1000;
  const stallBad = stall > stallLimit;
  if (stallBad) fail.push(`quiz stał ${(stall / 1000).toFixed(1)}s bez zmiany pytania`);
  console.log(`🧊 Najdłuższy czas w pytaniu bez zmiany: ${(stall / 1000).toFixed(1)}s (limit ${(stallLimit / 1000).toFixed(0)}s) ${stallBad ? "❌" : "✅"}`);

  // 5. start każdego pytania względem planu (anchor + o), każdy telefon.
  // Pomijamy telefon, który w chwili otwarcia pytania był w trakcie reloadu (REFRESH).
  // Odchylenie liczymy z chwili zmiany data-fue-phase w DOM (devDom, MutationObserver) — próbka
  // co 250 ms + page.evaluate na zdławionym telefonie potrafi przyjść SEKUNDY po faktycznej
  // zmianie ekranu (H6). Z próbki (devSample) tylko wtedy, gdy historia DOM nie obejmuje startu
  // (np. reload po otwarciu pytania wyczyścił window.__fuePhases).
  let devMax = 0;
  const devLines = [];
  state.startDevs = [];
  const fmtDev = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v}ms`);
  for (let pi = 0; pi < state.codes.length; pi++) {
    const parts = [];
    const hist = state.phoneTrace?.[pi]?.phases || [];
    for (let q = 1; q <= plan.length; q++) {
      const first = samples.find((s) => s.phones[pi]?.phase === "quiz" && s.phones[pi]?.q === q);
      const { anchorMs } = anchorAt(first?.srv ?? srvNow());
      const opens = anchorMs + plan[q - 1].o;
      if ((blind[pi] || []).some(([a, b]) => opens >= a - 500 && opens <= b + 500)) { parts.push(`q${q}: reload`); continue; }
      const covers = hist.length > 0 && hist[0].t + state.clockOff <= opens;
      const hDom = covers ? hist.find((h) => h.phase === "quiz" && h.q === q) : null;
      let devDom = null;
      if (hDom) {
        const srvD = hDom.t + state.clockOff;
        devDom = Math.round(srvD - (anchorAt(srvD).anchorMs + plan[q - 1].o));
      }
      const devSample = first ? Math.round(first.srv - opens) : null;
      if (!first && devDom == null) { fail.push(`telefon ${pi + 1} nie widział pytania ${q} w fazie quiz`); parts.push(`q${q}: —`); continue; }
      const dev = devDom ?? devSample;
      state.startDevs.push({ pi, q, devDom, devSample, tLocal: hDom ? hDom.t : null, tSampleLocal: first ? Math.round(first.srv - state.clockOff) : null });
      devMax = Math.max(devMax, Math.abs(dev));
      parts.push(`q${q}: ${fmtDev(devDom)} (próbka ${fmtDev(devSample)})`);
      if (Math.abs(dev) > 1500) fail.push(`telefon ${pi + 1}: pytanie ${q} wystartowało ${dev} ms od planu (${devDom != null ? "DOM" : "próbka"})`);
    }
    devLines.push(`   telefon ${pi + 1}: ${parts.join("  ")}`);
  }
  console.log(`\n🗓️  Start pytań względem planu — DOM (próbka) (maks. |odchylenie| ${devMax} ms, limit 1500) ${devMax > 1500 ? "❌" : "✅"}`);
  for (const l of devLines) console.log(l);

  // 6. baza: current_question_idx zgodny z planem, status='results' od zamiatacza
  let idxBad = 0, idxN = 0;
  for (const m of state.monitor) {
    if (m.status !== "running" || m.pausedMs != null || m.anchorMs == null || !plan.length) continue;
    idxN++;
    const ok = [0, 750, 1500].some((back) => planPosition(plan, m.anchorMs, null, m.srv - back)?.idx === m.idx);
    if (!ok) idxBad++;
  }
  if (idxBad) fail.push(`current_question_idx w bazie niezgodny z planem w ${idxBad}/${idxN} odczytach`);
  console.log(`\n🗄️  Baza: current_question_idx zgodny z planem w ${idxN - idxBad}/${idxN} odczytach ${idxBad ? "❌" : "✅"}`);
  // Ciągłość idx (zawsze): kolejne różne wartości w statusach running/paused rosną dokładnie o 1
  // — pauza / wznowienie / przerwa / auto-skrót nie mogą przeskoczyć ani cofnąć pytania.
  const idxSeq = state.monitor.filter((m) => (m.status === "running" || m.status === "paused") && m.idx != null)
    .map((m) => m.idx).filter((v, i, a) => i === 0 || v !== a[i - 1]);
  const jumps = [];
  for (let i = 1; i < idxSeq.length; i++) if (idxSeq[i] - idxSeq[i - 1] !== 1) jumps.push([idxSeq[i - 1], idxSeq[i]]);
  for (const [a, b] of jumps) fail.push(`current_question_idx w bazie przeskoczył z ${a} na ${b}`);
  console.log(`🔢 Baza: sekwencja idx ${idxSeq.join("→") || "—"} ${jumps.length ? "❌" : "✅"}`);
  const firstRes = state.monitor.find((m) => m.status === "results");
  if (lastIt) {
    const lastAnchor = [...state.monitor].reverse().find((m) => m.anchorMs != null)?.anchorMs ?? state.anchorMs;
    const deadline = lastAnchor + lastIt.r + 3000;
    const late = firstRes ? Math.round(firstRes.srv - (lastAnchor + lastIt.r)) : null;
    const resOk = !!firstRes && firstRes.srv <= deadline;
    if (!resOk) fail.push(firstRes ? `status 'results' dopiero ${late} ms po ostatnim reveal (limit 3000)` : "baza nie przeszła w 'results' (zamiatacz)");
    console.log(`🏁 ${ADMIN_EXIT ? "Bez admina: w" : "W"}yniki ustawione przez zamiatacz: ${firstRes ? `${late} ms po końcu ostatniego reveal` : "NIE"} ${resOk ? "✅" : "❌"}`);
  }
  const phonesEnd = state.codes.map((_, pi) => samples.some((s) => endish(s.phones[pi]?.phase)));
  phonesEnd.forEach((ok, pi) => { if (!ok) fail.push(`telefon ${pi + 1} nie doszedł do końca quizu (finished/results)`); });
  if (ADMIN_EXIT) {
    const allOnTime = devMax <= 1500 && seg.length >= NQ && phonesEnd.every(Boolean);
    console.log(`🚪 Bez admina: wszystkie pytania na czas ${allOnTime ? "✅" : "❌"}`);
  }

  // 7. SC5 — poprawność niewidoczna przed końcem czasu
  const qsChecked = new Set(state.sc5.map((c) => (c.what.match(/pyt\.(\d+)/) || [])[1]).filter(Boolean));
  const sc5Bad = state.sc5.filter((c) => !c.ok);
  const sc5Missing = plan.map((_, i) => String(i + 1)).filter((q) => !qsChecked.has(q));
  if (sc5Bad.length) fail.push(`SC5: poprawność ujawniona przed końcem czasu (${sc5Bad.length}×)`);
  if (sc5Missing.length) fail.push(`SC5: brak sprawdzenia dla pytań ${sc5Missing.join(", ")}`);
  if (!state.sc5Submit) fail.push("SC5: nie przechwycono żadnej odpowiedzi submit_answer_v2");
  const sc5Ok = !sc5Bad.length && !sc5Missing.length && state.sc5Submit > 0;
  console.log(`\n🔒 Poprawność niewidoczna przed końcem czasu (SC5): ${state.sc5.length} asercji, submit_answer_v2 ×${state.sc5Submit} ${sc5Ok ? "✅ OK" : "❌"}`);
  for (const c of sc5Bad.slice(0, 5)) console.log(`   ❌ ${c.what} ${c.detail}`);

  // 8. socket Realtime — powód istnienia tej sondy
  const closes = wsLog.filter((w) => w.kind === "CLOSE").length;
  const opens = wsLog.filter((w) => w.kind === "OPEN").length;
  const events = wsLog.filter((w) => w.kind === "BROADCAST" || w.kind === "PG_CHANGES");
  const lastEvent = events.length ? ((events[events.length - 1].at - t0) / 1000).toFixed(1) : null;
  const runS = samples.length ? samples[samples.length - 1].at / 1000 : 0;
  const deaf = seg.length > 0 && events.length < seg.length;
  if (deaf) fail.push(`telefon nie odebrał zdarzeń dla wszystkich przejść (${events.length} zdarzeń / ${seg.length} pytań)`);
  if (!events.length) fail.push("telefon nie odebrał ŻADNEGO zdarzenia Realtime");
  console.log(`\n🔌 Socket Realtime telefonu 1: ${opens}× otwarcie, ${closes}× zamknięcie, ${wsFrames.n} ramek`);
  console.log(`   zdarzeń quizu: ${events.length} dla ${seg.length} pytań, ostatnie w ${lastEvent ?? "—"}s (przebieg ${runS.toFixed(1)}s) ${deaf ? "❌ GŁUCHY" : "✅"}`);
  if (consoleLog.length) {
    console.log("\n🧯 Błędy z konsoli telefonu 1 (istotne):");
    for (const c of consoleLog.slice(0, 12)) console.log(`   ${((c.at - t0) / 1000).toFixed(1)}s  [${c.kind}] ${c.text}`);
    if (consoleLog.some((c) => /fetchModules|ModulesProvider/i.test(c.text)))
      fail.push("konfiguracja modułów nie została pobrana — czasy pytań mogą być błędne");
  }
  if (closes > 0) console.log(`   ⚠️  socket był zamykany ${closes}× — dozorca musiał go podnosić`);

  // 9. pełna ścieżka
  if (FULL) {
    const seen = new Set(samples.flatMap((s) => s.phones.map((p) => p?.phase)).filter(Boolean));
    const flow = globalThis.__flow || {};
    const intros = countTransitions(samples, "intro");
    // Pauza nie może zmienić fazy, pytania ani licznika (±1 s) — kotwica przesuwa się o czas pauzy.
    let pauseOk = !!flow.before && !!flow.during && !!flow.after;
    const pauseInfo = [];
    if (pauseOk) {
      flow.before.forEach((b, i) => {
        const d = flow.during[i], a = flow.after[i];
        pauseInfo.push(`t${i + 1}: ${b.phase} q${b.q} ${b.timer}s → pauza ${d.timer}s → ${a.phase} q${a.q} ${a.timer}s`);
        if (a.phase !== b.phase || a.q !== b.q || d.q !== b.q || Math.abs(a.timer - d.timer) > 1 || Math.abs(b.timer - d.timer) > 1) pauseOk = false;
      });
    }
    console.log("\n🗺️  Pełna ścieżka wydarzenia:");
    const stages = [
      ["poczekalnia", seen.has("lobby") || (state.preStart || []).every((p) => p.phase === "lobby")],
      ["zapowiedzi modułów", intros >= 5, `${intros} (oczekiwane ≥5 dla 5 modułów)`],
      ["pytania", seen.has("quiz")],
      // Z ADMIN_EXIT nie ma kto pauzować — etapy pauzy nie są wtedy oceniane.
      // Z PROBE_PAUSE_PHASE pauzę ocenia blok „PAUZA W FAZIE” (własna pauza FULL wyłączona).
      ...(ADMIN_EXIT || PAUSE_PHASE ? [] : [
        ["pauza widoczna u uczestnika", !!flow.pauseSeen],
        ["wznowienie: ta sama faza/pytanie/licznik ±1 s", pauseOk, pauseInfo.join("; ")],
      ]),
      ...(ADMIN_EXIT ? [] : [breakStage(plan, samples, flow)]),
      ["ekran oczekiwania na wyniki / wynik", seen.has("finished") || seen.has("results")],
      ["wyniki ustawione przez zamiatacz", !!firstRes],
      ["ekran wyniku uczestnika", seen.has("results")],
    ];
    for (const [name, ok, extra] of stages) {
      console.log(`   ${ok ? "✅" : "❌"} ${name}${extra ? "  — " + extra : ""}`);
      if (!ok) fail.push(`etap nieosiągnięty: ${name}`);
    }
    console.log(`   zaobserwowane fazy: ${[...seen].join(", ")}`);
  }

  // 10. tryby REFRESH / OFFLINE
  reportModes(fail);

  // PROBE_TRACE=1 — ślad zmian stanu + diagnoza przyczynowa + zrzut surowych danych.
  if (TRACE) {
    diagnose(t0);
    dumpTrace(samples);
    console.log("\n🔍 ŚLAD (tylko zmiany):");
    let prev = "";
    for (const s of samples) {
      const a = s.admin || {};
      const line = s.phones.map((p) => `${String(p?.phase).slice(0, 9).padEnd(9)} q=${String(p?.q ?? "-").padStart(2)} t=${String(p?.timer ?? "-").padStart(2)}${p?.locked ? "L" : " "}`).join(" | ");
      const key = `${a.phase}|${a.q}|${line}`;
      if (key === prev) continue;
      prev = key;
      console.log(`  ${String((s.at / 1000).toFixed(1)).padStart(6)}s  host[${String(a.phase).slice(0, 9).padEnd(9)} q=${String(a.q ?? "-").padStart(2)}]  ${line}`);
    }
  }

  if (fail.length) {
    console.log("\n" + "─".repeat(60));
    console.log("PROBLEMY:");
    for (const f of fail) console.log(`  ❌ ${f}`);
  }
  console.log("═".repeat(60));
  return fail;
}


main().catch(async (e) => {
  console.error("\n💥 BŁĄD SONDY:", e.message);
  await cleanup();
  process.exit(1);
});
