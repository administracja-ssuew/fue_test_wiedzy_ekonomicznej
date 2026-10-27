/**
 * FUE Quiz — test obciążenia v2 (architektura fazy 6/7: plan sesji + zamiatacz pg_cron)
 *
 * Odtwarza telefon uczestnika tak jak dzisiejsza aplikacja (useParticipantGame):
 *   claim_participant_code → get_participant_state(include_plan) → kanał quiz-<sesja>
 *   (postgres_changes UPDATE quiz_sessions) → siatka bezpieczeństwa: snapshot co 15 s
 *   → submit_answer_v2 w każdym pytaniu z „ludzkim” opóźnieniem.
 * Kilka miast naraz: osobna sesja na miasto, start wszystkich jednocześnie kontem
 * superadmina (start_quiz_session_v2), przejścia robi wyłącznie zamiatacz w bazie.
 *
 * WYŁĄCZNIE STAGING (klucze *_STAGE) — odmawia, gdy adres = produkcja.
 * Miasta syntetyczne LOAD-1…LOAD-n (nie ruszają danych miast prawdziwych).
 * Wszystko, co założy (pytania, sesje, kody, konto admina), usuwa na końcu — także po Ctrl+C.
 *
 *   npx vite-node scripts/load-v2.js
 *   LOAD_TOTAL=410 LOAD_CITIES=5 LOAD_QUESTIONS=4 npx vite-node scripts/load-v2.js
 *
 * Kody wyjścia: 0 = bez błędów, 1 = problemy (lista w raporcie), 2 = błąd konfiguracji.
 */

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const URL = process.env.VITE_SUPABASE_URL_STAGE;
const ANON = process.env.VITE_SUPABASE_ANON_KEY_STAGE;
const SVC = process.env.SUPABASE_SERVICE_KEY_STAGE;
if (!URL || !ANON || !SVC) { console.error("⛔ Brak kluczy *_STAGE w .env"); process.exit(2); }
if (URL === process.env.VITE_SUPABASE_URL) { console.error("⛔ *_STAGE wskazuje PRODUKCJĘ — przerywam"); process.exit(2); }

const TOTAL = Number(process.env.LOAD_TOTAL || 410);
const NCITY = Number(process.env.LOAD_CITIES || 5);
const NQ = Number(process.env.LOAD_QUESTIONS || 4);
const ANSWER_MAX_MS = Number(process.env.LOAD_ANSWER_MAX_MS || 8000);
const SAFETY_NET_MS = 15000;
const RUN_TAG = `LOAD-${Date.now().toString(36)}`;
const CITIES = Array.from({ length: NCITY }, (_, i) => `${RUN_TAG}-${i + 1}`);

const svc = createClient(URL, SVC, { auth: { persistSession: false } });
const log = (...a) => console.log(...a);
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`;

const state = { cities: [], adminId: null, participants: [] };
const stats = {
  claimErr: [], snapErr: 0, snapCalls: 0, subscribed: 0, subErr: [], submitOk: 0, submitErr: [],
  lateRow: [], // ms: odbiór wiersza (zmiana idx) względem chwili otwarcia pytania z planu
};
const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── SETUP ────────────────────────────────────────────────────────────────────
async function setup() {
  log(`🧪 Cel: ${URL} (STAGING ✓) · ${TOTAL} uczestników · ${NCITY} miast · ${NQ} pytań · tag ${RUN_TAG}`);
  const email = `${RUN_TAG.toLowerCase()}@load.invalid`, password = randomUUID();
  const { data: u, error: eu } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (eu) throw new Error("konto admina: " + eu.message);
  state.adminId = u.user.id; state.admin = { email, password };
  const { error: ep } = await svc.from("profiles").upsert({ id: u.user.id, full_name: "LOAD admin", role: "superadmin", city: null });
  if (ep) throw new Error("profil admina: " + ep.message);

  const per = Math.ceil(TOTAL / NCITY);
  for (let ci = 0; ci < NCITY; ci++) {
    const city = CITIES[ci];
    const n = Math.min(per, TOTAL - ci * per);
    const { data: qs, error: eq } = await svc.from("questions").insert(Array.from({ length: NQ }, (_, i) => ({
      city, module: 1 + (i % 5), q: `[LOAD] ${city} p${i + 1}`, opts: ["A", "B", "C", "D"], ans: i % 4, is_practice: false, sort_order: i,
    }))).select("id"); if (eq) throw new Error("pytania: " + eq.message);
    const { data: s, error: es } = await svc.from("quiz_sessions").insert({ city, status: "waiting", is_practice: false, created_by: state.adminId }).select("id").single();
    if (es) throw new Error("sesja: " + es.message);
    const codes = Array.from({ length: n }, (_, i) => ({ code: `L${ci + 1}-${String(1000 + i)}`, name: "Bot", surname: `${ci + 1}-${i}`, city }));
    const { error: ec } = await svc.from("participant_codes").insert(codes); if (ec) throw new Error("kody: " + ec.message);
    state.cities.push({ city, sessionId: s.id, questionIds: qs.map((q) => q.id), codes: codes.map((c) => c.code) });
  }
  log(`${ts()} ✅ setup: ${NCITY} sesji, ${TOTAL} kodów`);
}

// ─── UCZESTNIK ────────────────────────────────────────────────────────────────
function makeParticipant(c, code) {
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const p = { city: c.city, sessionId: c.sessionId, code, device: randomUUID(), client, plan: null, anchor: null, answered: new Set(), sent: new Set(), schedAnchor: null, lastIdx: null, offset: 0, timers: [] };
  return p;
}

async function snapshot(p, includePlan) {
  stats.snapCalls++;
  const { data, error } = await p.client.rpc("get_participant_state", { p_code: p.code, p_session_id: p.sessionId, p_include_plan: includePlan });
  if (error || !data || data.error) { stats.snapErr++; return; }
  if (data.server_now) p.offset = data.server_now - Date.now();
  if (data.plan?.items || Array.isArray(data.plan)) p.plan = data.plan.items || data.plan;
  const an = data.session?.plan_anchor_at; // ms (liczba) w snapshocie, ISO w wierszu Realtime
  if (an != null) p.anchor = typeof an === "number" ? an : Date.parse(an);
  schedule(p);
}

// Odpowiedź w każdym pytaniu planu, losowo 0,8–ANSWER_MAX_MS s po otwarciu (czas serwera).
function schedule(p) {
  if (!p.plan || !p.anchor) return;
  // Nowa kotwica (start albo wznowienie po przerwie) → przelicz wszystkie niewysłane odpowiedzi.
  if (p.schedAnchor !== p.anchor) {
    p.timers.forEach(clearTimeout); p.timers = [];
    p.answered = new Set(p.sent); p.schedAnchor = p.anchor;
  }
  for (const it of p.plan) {
    const id = it.id; if (p.answered.has(id)) continue;
    p.answered.add(id);
    const openAt = p.anchor + Number(it.o) - p.offset; // lokalny zegar
    const delay = Math.max(0, openAt - Date.now()) + 800 + Math.random() * (ANSWER_MAX_MS - 800);
    p.timers.push(setTimeout(async () => {
      const { data, error } = await p.client.rpc("submit_answer_v2", {
        p_session_id: p.sessionId, p_code: p.code, p_name: "Bot", p_question_id: id, p_chosen: Math.floor(Math.random() * 4),
      });
      const why = error?.message || (data?.ok === false ? data?.reason || "?" : null);
      if (!why) { stats.submitOk++; p.sent.add(id); }
      else if (/paused/.test(why)) stats.pausedRejects = (stats.pausedRejects || 0) + 1; // przerwa — przeplanuje wznowienie
      else stats.submitErr.push(why);
    }, delay));
  }
}

async function join(p) {
  const { data, error } = await p.client.rpc("claim_participant_code", { p_code: p.code, p_device: p.device });
  if (error || !data?.ok) { stats.claimErr.push(error?.message || data?.reason || "?"); return false; }
  await snapshot(p, true);
  await new Promise((resolve) => {
    const done = setTimeout(() => { stats.subErr.push("timeout"); resolve(); }, 20000);
    p.channel = p.client.channel(`quiz-${p.sessionId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "quiz_sessions", filter: `id=eq.${p.sessionId}` }, ({ new: row }) => {
        if (!row) return;
        if (row.plan_anchor_at && !p.plan) setTimeout(() => snapshot(p, true), Math.random() * 1000);
        if (row.plan_anchor_at) { p.anchor = Date.parse(row.plan_anchor_at); schedule(p); }
        if (p.plan && row.current_question_idx != null && row.current_question_idx !== p.lastIdx && row.status === "running") {
          const it = p.plan[row.current_question_idx];
          // Zamiatacz przesuwa idx po rewealu poprzedniego; mierzymy odbiór względem r poprzedniego pytania.
          const prev = p.plan[row.current_question_idx - 1];
          if (prev && p.anchor) stats.lateRow.push(Date.now() + p.offset - (p.anchor + Number(prev.r)));
          p.lastIdx = row.current_question_idx; void it;
        }
      })
      .subscribe((st) => {
        if (st === "SUBSCRIBED") { stats.subscribed++; clearTimeout(done); resolve(); }
        else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT") { stats.subErr.push(st); clearTimeout(done); resolve(); }
      });
  });
  p.net = setInterval(() => snapshot(p, false), SAFETY_NET_MS + Math.random() * 2000);
  return true;
}

// ─── PRZEBIEG ─────────────────────────────────────────────────────────────────
async function run() {
  for (const c of state.cities) for (const code of c.codes) state.participants.push(makeParticipant(c, code));
  log(`${ts()} 📱 łączenie ${state.participants.length} uczestników (fale po 50)…`);
  for (let i = 0; i < state.participants.length; i += 50) {
    await Promise.all(state.participants.slice(i, i + 50).map(join));
  }
  log(`${ts()} 📶 połączenia Realtime: ${stats.subscribed}/${state.participants.length} · błędy claim ${stats.claimErr.length} · błędy kanału ${stats.subErr.length}`);

  const admin = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: el } = await admin.auth.signInWithPassword(state.admin); if (el) throw new Error("logowanie admina: " + el.message);
  const starts = await Promise.all(state.cities.map((c) => admin.rpc("start_quiz_session_v2", { p_session_id: c.sessionId })));
  const startErr = starts.filter((r) => r.error || !r.data?.ok);
  log(`${ts()} ▶️  start ${state.cities.length} sesji naraz: ${state.cities.length - startErr.length} OK${startErr.length ? `, BŁĘDY: ${startErr.map((r) => r.error?.message || r.data?.reason).join("; ")}` : ""}`);
  stats.startErr = startErr.length;

  // Czekaj na koniec planu we wszystkich miastach (status results/ended), monitoruj co 5 s.
  const { data: plans } = await svc.from("session_plans").select("session_id, items").in("session_id", state.cities.map((c) => c.sessionId));
  const lastR = Math.max(...plans.map((p) => Number(p.items[p.items.length - 1].r)));
  log(`${ts()} ⏳ plan: ${NQ} pytań, koniec po ${(lastR / 1000).toFixed(0)} s`);
  const deadline = Date.now() + lastR + 90000; // + zapas na przerwę po module 3
  let finished = false;
  while (Date.now() < deadline) {
    await sleep(5000);
    const { data: ss } = await svc.from("quiz_sessions").select("id, city, status, current_question_idx, plan_hold_idx").in("id", state.cities.map((c) => c.sessionId));
    // Przerwa planowa po module 3 (sekcja 46) czeka na admina - wznawiamy wszystkie miasta naraz.
    const held = ss.filter((s) => s.status === "paused" && s.plan_hold_idx != null);
    if (held.length) {
      const rs = await Promise.all(held.map((s) => admin.rpc("admin_resume_session", { p_session_id: s.id })));
      const bad = rs.filter((r) => r.error);
      stats.resumeErr = (stats.resumeErr || 0) + bad.length; stats.resumed = (stats.resumed || 0) + held.length - bad.length;
      log(`${ts()} ☕ przerwa po module 3 → wznowienie ${held.length} sesji${bad.length ? `, BŁĘDY: ${bad.map((r) => r.error.message).join("; ")}` : " OK"}`);
    }
    const line = ss.map((s) => `${s.city.slice(-1)}:${s.status[0]}${s.current_question_idx ?? "-"}`).join(" ");
    log(`${ts()} ${line} · odpowiedzi ok ${stats.submitOk} / błędy ${stats.submitErr.length} · snapshoty ${stats.snapCalls} (błędy ${stats.snapErr})`);
    if (ss.every((s) => s.status === "results" || s.status === "ended")) { finished = true; break; }
  }
  stats.finished = finished;
  await sleep(3000);
  await admin.auth.signOut();
}

// ─── RAPORT ───────────────────────────────────────────────────────────────────
async function report() {
  const problems = [];
  const expected = state.participants.length * NQ;
  const { count: inDb } = await svc.from("answers").select("*", { count: "exact", head: true }).in("session_id", state.cities.map((c) => c.sessionId));
  log("\n════════ RAPORT load-v2 ════════");
  log(`Uczestnicy: ${state.participants.length} · miasta: ${NCITY} · pytania: ${NQ}`);
  log(`Przypięcie kodu: ${state.participants.length - stats.claimErr.length}/${state.participants.length} OK`);
  log(`Kanał Realtime SUBSCRIBED: ${stats.subscribed}/${state.participants.length}`);
  log(`Start sesji naraz: ${state.cities.length - (stats.startErr || 0)}/${state.cities.length} OK`);
  log(`Wszystkie sesje doszły do końca (zamiatacz): ${stats.finished ? "TAK" : "NIE"}`);
  log(`Wznowienia po przerwie planowej: ${stats.resumed || 0} OK, błędy ${stats.resumeErr || 0}`);
  if (stats.resumeErr) problems.push(`błędy wznowienia: ${stats.resumeErr}`);
  log(`Odpowiedzi: wysłane OK ${stats.submitOk}, błędy ${stats.submitErr.length}, w bazie ${inDb} (oczekiwane ${expected})`);
  log(`Snapshoty: ${stats.snapCalls}, błędy ${stats.snapErr}`);
  log(`Odpowiedzi odrzucone w trakcie przerwy (oczekiwane, potem wysłane ponownie): ${stats.pausedRejects || 0}`);
  const L = stats.lateRow;
  log(`Odbiór przejścia pytania przez Realtime względem planu (ms): p50 ${pct(L, 50)} · p95 ${pct(L, 95)} · p99 ${pct(L, 99)} · maks ${pct(L, 100)} (n=${L.length})`);
  if (stats.claimErr.length) problems.push(`błędy przypięcia kodu: ${stats.claimErr.length} (${[...new Set(stats.claimErr)].join(", ")})`);
  if (stats.subscribed < state.participants.length) problems.push(`nie wszystkie kanały Realtime: ${stats.subscribed}/${state.participants.length}`);
  if (stats.startErr) problems.push(`błędy startu sesji: ${stats.startErr}`);
  if (!stats.finished) problems.push("nie wszystkie sesje doszły do końca");
  if (stats.submitErr.length) problems.push(`błędy odpowiedzi: ${stats.submitErr.length} (${[...new Set(stats.submitErr)].slice(0, 5).join(", ")})`);
  if (inDb !== expected) problems.push(`odpowiedzi w bazie ${inDb} ≠ ${expected}`);
  if (stats.snapErr) problems.push(`błędy snapshotu: ${stats.snapErr}`);
  if (L.length && pct(L, 95) > 3000) problems.push(`p95 odbioru przejścia > 3 s (${pct(L, 95)} ms)`);
  log(problems.length ? `\n❌ PROBLEMY:\n  - ${problems.join("\n  - ")}` : "\n✅ OBCIĄŻENIE: bez błędów");
  return problems.length ? 1 : 0;
}

// ─── SPRZĄTANIE ───────────────────────────────────────────────────────────────
let cleaned = false;
async function cleanup() {
  if (cleaned) return; cleaned = true;
  for (const p of state.participants) {
    p.timers.forEach(clearTimeout); clearInterval(p.net);
    try { if (p.channel) await p.client.removeChannel(p.channel); } catch (_) { /* nieistotne */ }
  }
  const ids = state.cities.map((c) => c.sessionId).filter(Boolean);
  if (ids.length) await svc.from("quiz_sessions").delete().in("id", ids); // kaskada: answers, plany, naruszenia
  await svc.from("participant_codes").delete().like("city", `${RUN_TAG}%`);
  await svc.from("questions").delete().like("city", `${RUN_TAG}%`);
  await svc.from("event_log").delete().in("session_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  if (state.adminId) { await svc.from("profiles").delete().eq("id", state.adminId); await svc.auth.admin.deleteUser(state.adminId); }
  const left = await Promise.all([
    svc.from("quiz_sessions").select("*", { count: "exact", head: true }).like("city", `${RUN_TAG}%`),
    svc.from("participant_codes").select("*", { count: "exact", head: true }).like("city", `${RUN_TAG}%`),
    svc.from("questions").select("*", { count: "exact", head: true }).like("city", `${RUN_TAG}%`),
  ]);
  log(`🧹 sprzątanie: sesje ${left[0].count}, kody ${left[1].count}, pytania ${left[2].count} ${left.every((x) => !x.count) ? "✅ czysto" : "❌"}`);
}
process.on("SIGINT", async () => { log("\n⛔ przerwane — sprzątam"); await cleanup(); process.exit(1); });

// process.exitCode zamiast process.exit(): na Windows process.exit() przy
// zamykanych uchwytach fetch/undici kończy się asercją libuv (kod 127).
let code = 1;
try { await setup(); await run(); code = await report(); }
catch (e) { console.error(`💥 ${e?.message || e}`); }
finally { await cleanup(); process.exitCode = code; setTimeout(() => process.exit(code), 3000).unref(); }
