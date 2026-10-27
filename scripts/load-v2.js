/**
 * FUE Quiz — test obciążenia v2 (architektura fazy 6/7: plan sesji + zamiatacz pg_cron)
 *
 * Odtwarza telefon uczestnika tak jak dzisiejsza aplikacja (useParticipantGame):
 *   claim_participant_code → mark_code_used → get_participant_state(include_plan) → kanał
 *   quiz-<sesja> (postgres_changes UPDATE quiz_sessions) → siatka bezpieczeństwa: snapshot
 *   co 15 s → submit_answer_v2 w każdym pytaniu z „ludzkim” opóźnieniem.
 * Kilka miast naraz: osobna sesja na miasto, start wszystkich jednocześnie (start_quiz_session_v2),
 * przejścia robi wyłącznie zamiatacz w bazie; przerwę po module 3 wznawia skrypt (jak admin).
 *
 * WYŁĄCZNIE STAGING (klucze *_STAGE) — odmawia, gdy adres = produkcja.
 *
 * Tryby:
 *   domyślnie          miasta syntetyczne LOAD-…-1…n (dane miast prawdziwych nietknięte)
 *   LOAD_UI=1          prawdziwe miasta + w przeglądarce: panel admina każdego miasta
 *                      (zalogowany city_admin — odpytywanie i auto-skrót jak na sali)
 *                      oraz projektor Live View każdego miasta; wymaga aplikacji podpiętej
 *                      pod staging pod LOAD_APP_URL (np. vite preview zbudowany z *_STAGE).
 *                      Na czas testu pytania 5 miast na stagingu są podmienione na testowe,
 *                      a sesje miast wyczyszczone; na końcu pytania wracają z PRODUKCJI
 *                      (tylko odczyt prod) i każde miasto dostaje świeżą sesję oczekującą.
 *   LOAD_DROP_AT=8     w pytaniu nr 8 (1-based) telefony miasta LOAD_DROP_CITY (domyślnie 1.)
 *                      tracą sieć na LOAD_DROP_MS (10 s) i wracają WSZYSTKIE naraz.
 *
 *   npm run load-v2
 *   LOAD_UI=1 LOAD_QUESTIONS=20 LOAD_DROP_AT=8 LOAD_APP_URL=http://localhost:4174 npm run load-v2
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
const NQ = Number(process.env.LOAD_QUESTIONS || 4);
const ANSWER_MAX_MS = Number(process.env.LOAD_ANSWER_MAX_MS || 8000);
const UI = process.env.LOAD_UI === "1";
const APP_URL = process.env.LOAD_APP_URL || "http://localhost:4174";
const DROP_AT = Number(process.env.LOAD_DROP_AT || 0);          // 1-based numer pytania, 0 = bez zerwania
const DROP_CITY = Number(process.env.LOAD_DROP_CITY || 1);      // 1-based miasto
const DROP_MS = Number(process.env.LOAD_DROP_MS || 10000);
const SAFETY_NET_MS = 15000;
const NL = String.fromCharCode(10);
const RUN_TAG = `LOAD-${Date.now().toString(36)}`;
const REAL_CITIES = ["Kraków", "Warszawa", "Poznań", "Wrocław", "Katowice"];
const NCITY = UI ? 5 : Number(process.env.LOAD_CITIES || 5);
const CITIES = UI ? REAL_CITIES : Array.from({ length: NCITY }, (_, i) => `${RUN_TAG}-${i + 1}`);

const svc = createClient(URL, SVC, { auth: { persistSession: false } });
const prodRead = UI ? createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } }) : null;
const log = (...a) => console.log(...a);
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`;

const state = { cities: [], users: [], participants: [], browser: null, pages: [] };
const stats = {
  claimErr: [], snapErr: 0, snapCalls: 0, subscribed: 0, subErr: [], submitOk: 0, submitErr: [],
  lateRow: [], // ms: odbiór przejścia pytania (zmiana idx) względem końca odsłonięcia poprzedniego
  drop: null, ui: { adminOk: 0, liveOk: 0, liveSamples: 0, liveMismatch: 0, pageErrors: [] }, skips: 0,
};
const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function makeUser(role, city) {
  const email = `${RUN_TAG.toLowerCase()}-${role}-${state.users.length}@load.invalid`, password = randomUUID();
  const { data: u, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error("konto: " + error.message);
  state.users.push(u.user.id);
  const { error: ep } = await svc.from("profiles").upsert({ id: u.user.id, full_name: `LOAD ${role}`, role, city });
  if (ep) throw new Error("profil: " + ep.message);
  return { id: u.user.id, email, password };
}

// ─── SETUP ────────────────────────────────────────────────────────────────────
async function setup() {
  log(`🧪 Cel: ${URL} (STAGING ✓) · ${TOTAL} uczestników · ${NCITY} miast · ${NQ} pytań${UI ? " · panele+projektory w przeglądarce" : ""}${DROP_AT ? ` · zerwanie sieci miasta ${DROP_CITY} w pyt. ${DROP_AT}` : ""} · tag ${RUN_TAG}`);
  state.admin = await makeUser("superadmin", null);
  if (UI) {
    // Prawdziwe miasta: czyste sesje i pytania testowe zamiast skopiowanych z produkcji.
    await svc.from("quiz_sessions").delete().in("city", CITIES);
    await svc.from("questions").delete().in("city", CITIES);
    await svc.from("participant_codes").delete().in("city", CITIES);
  }
  const per = Math.ceil(TOTAL / NCITY);
  for (let ci = 0; ci < NCITY; ci++) {
    const city = CITIES[ci];
    const n = Math.min(per, TOTAL - ci * per);
    // Moduły po kolei (po NQ/5 pytań na moduł) - przerwa planowa po module 3 jak na finale.
    const { data: qs, error: eq } = await svc.from("questions").insert(Array.from({ length: NQ }, (_, i) => ({
      city, module: 1 + Math.min(4, Math.floor((i * 5) / NQ)), q: `[LOAD] ${city} p${i + 1}`, opts: ["A", "B", "C", "D"], ans: i % 4, is_practice: false, sort_order: i,
    }))).select("id"); if (eq) throw new Error("pytania: " + eq.message);
    const { data: s, error: es } = await svc.from("quiz_sessions").insert({ city, status: "waiting", is_practice: false, created_by: state.admin.id }).select("id").single();
    if (es) throw new Error("sesja: " + es.message);
    const codes = Array.from({ length: n }, (_, i) => ({ code: `L${ci + 1}-${String(1000 + i)}`, name: "Bot", surname: `${ci + 1}-${i}`, city }));
    const { error: ec } = await svc.from("participant_codes").insert(codes); if (ec) throw new Error("kody: " + ec.message);
    state.cities.push({ city, sessionId: s.id, questionIds: qs.map((q) => q.id), codes: codes.map((c) => c.code) });
  }
  log(`${ts()} ✅ setup: ${NCITY} sesji, ${TOTAL} kodów`);
}

// ─── PRZEGLĄDARKA: panele admina + projektory ───────────────────────────────
async function openUi() {
  const { chromium } = await import("@playwright/test");
  state.browser = await chromium.launch();
  for (const c of state.cities) {
    const acc = await makeUser("city_admin", c.city);
    // Panel admina - osobny kontekst (osobna sesja logowania).
    const ctxA = await state.browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pa = await ctxA.newPage();
    pa.on("pageerror", (e) => stats.ui.pageErrors.push(`panel ${c.city}: ${e.message}`));
    await pa.goto(APP_URL, { waitUntil: "networkidle" });
    await pa.getByRole("button", { name: /Panel Administratora/ }).click();
    await pa.getByPlaceholder("Email").fill(acc.email);
    await pa.getByPlaceholder("Hasło").fill(acc.password);
    await pa.getByRole("button", { name: /Zaloguj się/ }).click();
    try { await pa.getByText("Wyloguj").first().waitFor({ timeout: 20000 }); stats.ui.adminOk++; }
    catch { stats.ui.pageErrors.push(`panel ${c.city}: nie załadował się po logowaniu`); }
    // Projektor (anon).
    const ctxL = await state.browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const pl = await ctxL.newPage();
    pl.on("pageerror", (e) => stats.ui.pageErrors.push(`projektor ${c.city}: ${e.message}`));
    await pl.goto(`${APP_URL}/?live=1&city=${encodeURIComponent(c.city)}`, { waitUntil: "networkidle" });
    stats.ui.liveOk++;
    state.pages.push({ city: c.city, sessionId: c.sessionId, admin: pa, live: pl });
  }
  log(`${ts()} 🖥️  panele admina zalogowane: ${stats.ui.adminOk}/${NCITY} · projektory: ${stats.ui.liveOk}/${NCITY}`);
}

// Projektor pokazuje „Pytanie X / Y” - porównanie z current_question_idx w bazie.
async function sampleProjectors(ss) {
  for (const pg of state.pages) {
    const s = ss.find((x) => x.id === pg.sessionId);
    if (!s || s.status !== "running") continue;
    const txt = await pg.live.locator("body").innerText().catch(() => "");
    const m = txt.match(/pytanie\s+(\d+)\s*\/\s*(\d+)/i);
    if (!m) continue; // odliczanie / odsłonięcie bez numeru
    stats.ui.liveSamples++;
    const shown = Number(m[1]), db = (s.current_question_idx ?? 0) + 1;
    if (Math.abs(shown - db) > 1) { stats.ui.liveMismatch++; log(`${ts()} ⚠️ projektor ${pg.city}: pokazuje ${shown}, baza ${db}`); }
  }
}

// ─── UCZESTNIK ────────────────────────────────────────────────────────────────
function makeParticipant(c, code, cityIdx) {
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  return { city: c.city, cityIdx, sessionId: c.sessionId, code, device: randomUUID(), client, plan: null, anchor: null,
    answered: new Set(), sent: new Set(), schedAnchor: null, lastIdx: null, offset: 0, timers: [], offline: false, queue: [] };
}

async function snapshot(p, includePlan) {
  if (p.offline) return;
  stats.snapCalls++;
  const { data, error } = await p.client.rpc("get_participant_state", { p_code: p.code, p_session_id: p.sessionId, p_include_plan: includePlan });
  if (error || !data || data.error) {
    stats.snapErr++;
    const why = error?.message || error?.code || data?.error || "pusta odpowiedź";
    (stats.snapWhy ||= {})[why] = (stats.snapWhy[why] || 0) + 1;
    // Jak aplikacja (useParticipantGame, stalled): bez planu ponów z narastającą przerwą 1→2→4→8 s.
    if (!p.plan) { p.retryN = (p.retryN || 0) + 1; setTimeout(() => snapshot(p, true), Math.min(8000, 1000 * 2 ** (p.retryN - 1))); }
    return;
  }
  if (p.retryN) { stats.recovered = (stats.recovered || 0) + 1; p.retryN = 0; }
  if (data.server_now) p.offset = data.server_now - Date.now();
  if (data.plan?.items || Array.isArray(data.plan)) p.plan = data.plan.items || data.plan;
  const an = data.session?.plan_anchor_at; // ms (liczba) w snapshocie, ISO w wierszu Realtime
  if (an != null) p.anchor = typeof an === "number" ? an : Date.parse(an);
  schedule(p);
}

async function submit(p, id) {
  if (p.offline) { p.queue.push(id); return; } // brak sieci - wyśle po powrocie (jak aplikacja)
  const { data, error } = await p.client.rpc("submit_answer_v2", {
    p_session_id: p.sessionId, p_code: p.code, p_name: "Bot", p_question_id: id, p_chosen: Math.floor(Math.random() * 4),
  });
  const why = error?.message || (data?.ok === false ? data?.reason || "?" : null);
  if (!why) { stats.submitOk++; p.sent.add(id); }
  else if (/paused/.test(why)) stats.pausedRejects = (stats.pausedRejects || 0) + 1; // przerwa — przeplanuje wznowienie
  else if (/closed|late|too late|not active/.test(why)) { stats.lateRejects = (stats.lateRejects || 0) + 1; p.sent.add(id); }
  else stats.submitErr.push(why);
}

// Odpowiedź w każdym pytaniu planu, losowo 0,8–ANSWER_MAX_MS s po otwarciu (czas serwera).
function schedule(p) {
  if (!p.plan || !p.anchor) return;
  // Nowa kotwica (start, wznowienie, auto-skrót admina) → przelicz wszystkie niewysłane odpowiedzi.
  if (p.schedAnchor !== p.anchor) {
    p.timers.forEach(clearTimeout); p.timers = [];
    p.answered = new Set(p.sent); p.schedAnchor = p.anchor;
  }
  for (const it of p.plan) {
    const id = it.id; if (p.answered.has(id)) continue;
    p.answered.add(id);
    const openAt = p.anchor + Number(it.o) - p.offset; // lokalny zegar
    const delay = Math.max(0, openAt - Date.now()) + 800 + Math.random() * (ANSWER_MAX_MS - 800);
    p.timers.push(setTimeout(() => submit(p, id), delay));
  }
}

function subscribe(p) {
  return new Promise((resolve) => {
    const done = setTimeout(() => resolve("timeout"), 20000);
    p.channel = p.client.channel(`quiz-${p.sessionId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "quiz_sessions", filter: `id=eq.${p.sessionId}` }, ({ new: row }) => onRow(p, row))
      .subscribe((st) => {
        if (st === "SUBSCRIBED") { clearTimeout(done); resolve("ok"); }
        else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT") { clearTimeout(done); resolve(st); }
      });
  });
}

function onRow(p, row) {
  if (!row || p.offline) return;
  const prevStatus = p.lastStatus; p.lastStatus = row.status;
  if (row.plan_anchor_at && !p.plan) setTimeout(() => snapshot(p, true), Math.random() * 1000);
  if (row.plan_anchor_at) { p.anchor = Date.parse(row.plan_anchor_at); schedule(p); }
  if (p.plan && row.current_question_idx != null && row.current_question_idx !== p.lastIdx && row.status === "running") {
    const prev = p.plan[row.current_question_idx - 1];
    // Przejście = koniec odsłony poprzedniego pytania = q_started_at nowego − zapowiedź (lead).
    // Liczone z wiersza, więc odporne na przesunięcia kotwicy (auto-skrót, wznowienie).
    const it = p.plan[row.current_question_idx];
    if (prev && it && row.q_started_at && p.lastIdx != null && prevStatus === "running")
      stats.lateRow.push(Date.now() + p.offset - (Date.parse(row.q_started_at) - Number(it.lead) * 1000));
    p.lastIdx = row.current_question_idx;
    if (DROP_AT && p.cityIdx === DROP_CITY - 1 && row.current_question_idx === DROP_AT - 1 && !dropStarted) startDrop(p.city);
  }
}

async function join(p) {
  const { data, error } = await p.client.rpc("claim_participant_code", { p_code: p.code, p_device: p.device });
  if (error || !data?.ok) { stats.claimErr.push(error?.message || data?.reason || "?"); return false; }
  await p.client.rpc("mark_code_used", { p_code: p.code, p_session_id: p.sessionId }); // jak App.jsx po wejściu
  await snapshot(p, true);
  const r = await subscribe(p);
  if (r === "ok") stats.subscribed++; else stats.subErr.push(r);
  p.net = setInterval(() => snapshot(p, false), SAFETY_NET_MS + Math.random() * 2000);
  return true;
}

// ─── ZERWANIE SIECI CAŁEGO MIASTA ────────────────────────────────────────────
let dropStarted = false;
async function startDrop(city) {
  dropStarted = true;
  const group = state.participants.filter((p) => p.city === city);
  log(`${ts()} 📵 ${city}: ${group.length} telefonów traci sieć na ${DROP_MS / 1000} s`);
  for (const p of group) {
    p.offline = true;
    try { await p.client.removeChannel(p.channel); } catch (_) { /* nieistotne */ }
    try { p.client.realtime.disconnect(); } catch (_) { /* nieistotne */ }
  }
  await sleep(DROP_MS);
  log(`${ts()} 📶 ${city}: wszystkie ${group.length} telefonów wraca naraz`);
  const back0 = Date.now();
  const res = await Promise.all(group.map(async (p) => {
    p.offline = false;
    try { p.client.realtime.connect(); } catch (_) { /* nieistotne */ }
    const r = await subscribe(p);
    await sleep(Math.random() * 2000); // aplikacja: snapshotJittered(…, 2000) po powrocie
    await snapshot(p, false);
    const q = p.queue; p.queue = []; for (const id of q) await submit(p, id);
    return r;
  }));
  stats.drop = { city, phones: group.length, resubscribed: res.filter((r) => r === "ok").length, ms: Date.now() - back0 };
  log(`${ts()} ✅ ${city}: kanały z powrotem ${stats.drop.resubscribed}/${group.length} w ${(stats.drop.ms / 1000).toFixed(1)} s`);
}

// ─── PRZEBIEG ─────────────────────────────────────────────────────────────────
async function run() {
  state.cities.forEach((c, ci) => { for (const code of c.codes) state.participants.push(makeParticipant(c, code, ci)); });
  if (UI) await openUi();
  log(`${ts()} 📱 łączenie ${state.participants.length} uczestników (fale po 50)…`);
  for (let i = 0; i < state.participants.length; i += 50) await Promise.all(state.participants.slice(i, i + 50).map(join));
  log(`${ts()} 📶 połączenia Realtime: ${stats.subscribed}/${state.participants.length} · błędy claim ${stats.claimErr.length} · błędy kanału ${stats.subErr.length}`);
  if (UI) await sleep(6000); // panele: lista uczestników odświeża się co 4 s przed startem

  const admin = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: el } = await admin.auth.signInWithPassword({ email: state.admin.email, password: state.admin.password });
  if (el) throw new Error("logowanie admina: " + el.message);
  let startErr;
  if (UI) {
    // Jak na sali: „▶ Start quizu” klikany w panelu każdego miasta w tej samej chwili.
    const clicks = await Promise.all(state.pages.map((pg) => pg.admin.getByRole("button", { name: /Start quizu/ }).click({ timeout: 15000 }).then(() => null, (e) => `${pg.city}: ${e.message.split(NL)[0]}`)));
    await sleep(3000);
    const { data: st } = await svc.from("quiz_sessions").select("city, status").in("id", state.cities.map((c) => c.sessionId));
    startErr = [...clicks.filter(Boolean).map((m) => ({ error: { message: m } })), ...st.filter((x) => x.status !== "running").map((x) => ({ error: { message: `${x.city}: status ${x.status}` } }))];
  } else {
    const starts = await Promise.all(state.cities.map((c) => admin.rpc("start_quiz_session_v2", { p_session_id: c.sessionId })));
    startErr = starts.filter((r) => r.error || !r.data?.ok);
  }
  log(`${ts()} ▶️  start ${state.cities.length} sesji naraz: ${state.cities.length - startErr.length} OK${startErr.length ? `, BŁĘDY: ${startErr.map((r) => r.error?.message || r.data?.reason).join("; ")}` : ""}`);
  stats.startErr = startErr.length;

  const { data: plans } = await svc.from("session_plans").select("session_id, items").in("session_id", state.cities.map((c) => c.sessionId));
  const lastR = Math.max(...plans.map((p) => Number(p.items[p.items.length - 1].r)));
  log(`${ts()} ⏳ plan: ${NQ} pytań, koniec najpóźniej po ${(lastR / 1000).toFixed(0)} s (auto-skrót paneli może skrócić)`);
  const deadline = Date.now() + lastR + 120000; // + zapas na przerwę po module 3
  let finished = false, tick = 0;
  const anchors = new Map();
  while (Date.now() < deadline) {
    await sleep(5000); tick++;
    const { data: ss, error: se } = await svc.from("quiz_sessions").select("id, city, status, current_question_idx, plan_hold_idx, plan_anchor_at").in("id", state.cities.map((c) => c.sessionId));
    if (se || !Array.isArray(ss)) { stats.monitorErr = (stats.monitorErr || 0) + 1; log(`${ts()} ⚠️ odczyt monitora nieudany: ${se?.message || "brak danych"}`); continue; }
    // Auto-skrót paneli przesuwa kotwicę wstecz - liczymy przesunięcia (dowód, że panele działają).
    for (const s of ss) { const a = anchors.get(s.id); if (a && a.status === "running" && s.status === "running" && a.anchor !== s.plan_anchor_at) stats.skips++; anchors.set(s.id, { anchor: s.plan_anchor_at, status: s.status }); }
    const held = ss.filter((s) => s.status === "paused" && s.plan_hold_idx != null);
    if (held.length) {
      await sleep(3000); // admin czyta ekran przerwy
      const rs = UI
        // Jak na sali: „▶ Wznów quiz” w panelu miasta (pierwszy przycisk o tej nazwie).
        ? await Promise.all(held.map((s) => state.pages.find((pg) => pg.sessionId === s.id).admin.getByRole("button", { name: /Wznów quiz/ }).first().click({ timeout: 15000 }).then(() => ({}), (e) => ({ error: { message: `${s.city}: ${e.message.split(NL)[0]}` } }))))
        : await Promise.all(held.map((s) => admin.rpc("admin_resume_session", { p_session_id: s.id })));
      const bad = rs.filter((r) => r.error);
      stats.resumeErr = (stats.resumeErr || 0) + bad.length; stats.resumed = (stats.resumed || 0) + held.length - bad.length;
      log(`${ts()} ☕ przerwa po module 3 → wznowienie ${held.length} sesji${bad.length ? `, BŁĘDY: ${bad.map((r) => r.error.message).join("; ")}` : " OK"}`);
    }
    if (UI && tick % 2 === 0) await sampleProjectors(ss);
    const line = ss.map((s) => `${s.city.slice(0, 3)}:${s.status[0]}${s.current_question_idx ?? "-"}`).join(" ");
    log(`${ts()} ${line} · odp. ok ${stats.submitOk} / błędy ${stats.submitErr.length} · snapshoty ${stats.snapCalls} (bł. ${stats.snapErr})`);
    if (ss.every((s) => s.status === "results" || s.status === "ended")) { finished = true; break; }
  }
  stats.finished = finished;
  await sleep(4000);
  if (UI) {
    // Projektory po końcu: ekran wyników/oczekiwania bez błędów strony.
    for (const pg of state.pages) await pg.live.screenshot({ path: `${process.env.LOAD_SHOT_DIR || "test-results"}/load-live-${pg.city}.png` }).catch(() => {});
  }
  // Wyniki sesji tak jak panel admina (get_session_results jest tylko dla adminów).
  const results = await Promise.all(state.cities.map((c) => admin.rpc("get_session_results", { p_session_id: c.sessionId })));
  stats.resultsOk = results.filter((r) => !r.error && Array.isArray(r.data) && r.data.length > 0).length;
  stats.resultsErr = [...new Set(results.filter((r) => r.error).map((r) => r.error.message))];
  await admin.auth.signOut();
}

// ─── RAPORT ───────────────────────────────────────────────────────────────────
async function report() {
  const problems = [];
  const expected = state.participants.length * NQ;
  const { count: inDb } = await svc.from("answers").select("*", { count: "exact", head: true }).in("session_id", state.cities.map((c) => c.sessionId));
  const resultsOk = stats.resultsOk || 0;
  log("\n════════ RAPORT load-v2 ════════");
  log(`Uczestnicy: ${state.participants.length} · miasta: ${NCITY} · pytania: ${NQ}`);
  log(`Przypięcie kodu: ${state.participants.length - stats.claimErr.length}/${state.participants.length} OK`);
  log(`Kanał Realtime SUBSCRIBED: ${stats.subscribed}/${state.participants.length}`);
  log(`Start sesji naraz: ${state.cities.length - (stats.startErr || 0)}/${state.cities.length} OK`);
  log(`Wszystkie sesje doszły do końca (zamiatacz): ${stats.finished ? "TAK" : "NIE"}`);
  log(`Wznowienia po przerwie planowej: ${stats.resumed || 0} OK, błędy ${stats.resumeErr || 0}`);
  log(`Odpowiedzi: wysłane OK ${stats.submitOk}, błędy ${stats.submitErr.length}, w bazie ${inDb} (oczekiwane ${expected})`);
  log(`  odrzucone w przerwie (wysłane ponownie po wznowieniu): ${stats.pausedRejects || 0} · po zamknięciu pytania (auto-skrót/spóźnienie): ${stats.lateRejects || 0}`);
  log(`Snapshoty: ${stats.snapCalls}, błędy ${stats.snapErr}${stats.snapWhy ? " → " + JSON.stringify(stats.snapWhy) : ""} · odzyskane ponowieniem: ${stats.recovered || 0}`);
  log(`Nieudane odczyty monitora testu (service key, nie uczestnicy): ${stats.monitorErr || 0}`);
  log(`Wyniki sesji (get_session_results): ${resultsOk}/${state.cities.length}${stats.resultsErr?.length ? " · " + stats.resultsErr.join("; ") : ""}`);
  const L = stats.lateRow;
  log(`Odbiór przejścia pytania przez Realtime (ms): p50 ${pct(L, 50)} · p95 ${pct(L, 95)} · p99 ${pct(L, 99)} · maks ${pct(L, 100)} (n=${L.length})`);
  if (UI) {
    log(`Panele admina: ${stats.ui.adminOk}/${NCITY} zalogowane · auto-skróty pytań: ${stats.skips} · projektory: ${stats.ui.liveOk}/${NCITY}, próbki numeru pytania ${stats.ui.liveSamples}, rozjazdy ${stats.ui.liveMismatch}`);
    log(`Błędy JS na stronach: ${stats.ui.pageErrors.length}${stats.ui.pageErrors.length ? " → " + [...new Set(stats.ui.pageErrors)].slice(0, 5).join(" | ") : ""}`);
  }
  if (DROP_AT) log(`Zerwanie sieci: ${stats.drop ? `${stats.drop.city}, ${stats.drop.resubscribed}/${stats.drop.phones} kanałów wróciło w ${(stats.drop.ms / 1000).toFixed(1)} s` : "NIE WYKONANE"}`);

  if (stats.claimErr.length) problems.push(`błędy przypięcia kodu: ${stats.claimErr.length} (${[...new Set(stats.claimErr)].join(", ")})`);
  if (stats.subscribed < state.participants.length) problems.push(`nie wszystkie kanały Realtime: ${stats.subscribed}/${state.participants.length}`);
  if (stats.startErr) problems.push(`błędy startu sesji: ${stats.startErr}`);
  if (!stats.finished) problems.push("nie wszystkie sesje doszły do końca");
  if (stats.resumeErr) problems.push(`błędy wznowienia: ${stats.resumeErr}`);
  if (stats.submitErr.length) problems.push(`błędy odpowiedzi: ${stats.submitErr.length} (${[...new Set(stats.submitErr)].slice(0, 5).join(", ")})`);
  if (inDb < expected - (stats.lateRejects || 0)) problems.push(`odpowiedzi w bazie ${inDb} < ${expected - (stats.lateRejects || 0)}`);
  if (stats.snapErr) problems.push(`błędy snapshotu: ${stats.snapErr}`);
  if (resultsOk < state.cities.length) problems.push(`wyniki sesji: ${resultsOk}/${state.cities.length}`);
  if (L.length && pct(L, 95) > 3000) problems.push(`p95 odbioru przejścia > 3 s (${pct(L, 95)} ms)`);
  if (UI && stats.ui.adminOk < NCITY) problems.push(`panele admina: ${stats.ui.adminOk}/${NCITY}`);
  if (UI && stats.ui.liveMismatch) problems.push(`projektor rozjechany z bazą: ${stats.ui.liveMismatch}×`);
  if (UI && stats.ui.pageErrors.length) problems.push(`błędy JS na stronach: ${stats.ui.pageErrors.length}`);
  if (DROP_AT && (!stats.drop || stats.drop.resubscribed < stats.drop.phones)) problems.push("zerwanie sieci: nie wszystkie telefony wróciły");
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
  try { if (state.browser) await state.browser.close(); } catch (_) { /* nieistotne */ }
  const ids = state.cities.map((c) => c.sessionId).filter(Boolean);
  if (ids.length) {
    await svc.from("event_log").delete().in("session_id", ids);
    await svc.from("quiz_sessions").delete().in("id", ids); // kaskada: answers, plany, naruszenia
  }
  if (UI) {
    await svc.from("participant_codes").delete().in("city", CITIES);
    await svc.from("questions").delete().in("city", CITIES);
    // Pytania wracają z produkcji (tylko odczyt), każde miasto dostaje świeżą sesję oczekującą.
    const { data: prodQ, error: pe } = await prodRead.from("questions").select("*").in("city", CITIES).limit(5000);
    if (pe) log(`❌ odczyt pytań z produkcji: ${pe.message}`);
    else { const { error: ue } = await svc.from("questions").upsert(prodQ.map(({ created_by, ...r }) => r)); if (ue) log(`❌ przywracanie pytań: ${ue.message}`); }
    await svc.from("quiz_sessions").insert(CITIES.map((city) => ({ city, status: "waiting", is_practice: false })));
  } else {
    await svc.from("participant_codes").delete().like("city", `${RUN_TAG}%`);
    await svc.from("questions").delete().like("city", `${RUN_TAG}%`);
  }
  for (const id of state.users) { await svc.from("profiles").delete().eq("id", id); await svc.auth.admin.deleteUser(id); }
  const [q, s, k, j] = await Promise.all([
    svc.from("questions").select("*", { count: "exact", head: true }),
    svc.from("quiz_sessions").select("*", { count: "exact", head: true }).neq("status", "waiting"),
    svc.from("participant_codes").select("*", { count: "exact", head: true }),
    svc.from("questions").select("*", { count: "exact", head: true }).like("q", "[LOAD]%"),
  ]);
  log(`🧹 sprzątanie: pytania na stagingu ${q.count}, resztki [LOAD] ${j.count}, sesje nie-oczekujące ${s.count}, kody ${k.count}, konta testowe usunięte ${state.users.length}`);
}
process.on("SIGINT", async () => { log("\n⛔ przerwane — sprzątam"); await cleanup(); process.exit(1); });

// process.exitCode zamiast process.exit(): na Windows process.exit() przy
// zamykanych uchwytach fetch/undici kończy się asercją libuv (kod 127).
let code = 1;
try { await setup(); await run(); code = await report(); }
catch (e) { console.error(`💥 ${e?.message || e}`); }
finally { await cleanup(); process.exitCode = code; setTimeout(() => process.exit(code), 3000).unref(); }
