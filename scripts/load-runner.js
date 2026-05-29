/**
 * FUE Quiz — Load & Realtime Runner
 *
 * Symuluje N wirtualnych uczestników z PRAWDZIWYMI połączeniami Realtime
 * (osobny klient Supabase = osobny WebSocket per uczestnik — tak jak 500 telefonów),
 * z podziałem na miasta. Mierzy to, czego bot-runner nie dotyka:
 *   • ile połączeń Realtime faktycznie się utrzyma (limit planu Supabase),
 *   • latencję advance→odbiór eventu u uczestnika (p50/p95/p99) — KLUCZOWE dla quizu,
 *   • throughput i błędy zapisu odpowiedzi pod obciążeniem,
 *   • exactly-once advance (optimistic lock advanceSessionQuestion),
 *   • reconciliację: czy każda odpowiedź wylądowała w bazie.
 *
 * URUCHOMIENIE (świadomie zabramkowane — pisze do projektu z VITE_SUPABASE_URL):
 *   $env:LOAD_TEST_CONFIRM=1; npm run load
 *
 * .env:
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY
 *   LOAD_TOTAL=100        liczba uczestników łącznie (rozdzielana na miasta)
 *   LOAD_ROUNDS=8         liczba pytań do przejścia
 *   LOAD_CITIES=Kraków,Warszawa,Poznań,Wrocław,Katowice
 *   LOAD_ANSWER_MAX_MS=4000   maks. "ludzkie" opóźnienie odpowiedzi
 *
 * ⚠️ Używaj OSOBNEGO projektu Supabase (staging). Nie odpalaj na produkcji,
 *    zwłaszcza blisko wydarzenia — to zużywa quotę Realtime i tworzy obciążenie.
 */

import { createClient } from "@supabase/supabase-js";

const URL         = process.env.VITE_SUPABASE_URL;
const ANON_KEY    = process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const TOTAL         = parseInt(process.env.LOAD_TOTAL || "100", 10);
const ROUNDS        = parseInt(process.env.LOAD_ROUNDS || "8", 10);
const ANSWER_MAX_MS = parseInt(process.env.LOAD_ANSWER_MAX_MS || "4000", 10);
const CITIES = (process.env.LOAD_CITIES || "Kraków,Warszawa,Poznań,Wrocław,Katowice")
  .split(",").map((c) => c.trim()).filter(Boolean);

const CITY_PREFIX = { Kraków: "KRK", Warszawa: "WAR", Poznań: "POZ", Wrocław: "WRO", Katowice: "KAT" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const calcPts = (timeLeft, maxTime, correct) => (correct ? Math.round(500 + (timeLeft / maxTime) * 500) : 0);
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

const TIME_PER_Q = 30; // module 1 for the synthetic questions

const service = (URL && SERVICE_KEY) ? createClient(URL, SERVICE_KEY, { auth: { persistSession: false } }) : null;

const state = { cities: [] }; // [{ city, sessionId, codes:[{id,code}], questionIds:[] }]
const participants = [];      // [{ client, channel, code, city, sessionId }]
const latencies = [];         // ms, advance→receive across all participants/rounds
let connected = 0, connectFail = 0, answerOk = 0, answerErr = 0, dupAnswers = 0;
const sendAt = new Map();      // key `${sessionId}:${idx}` → Date.now() when driver wrote it

function log(...a) { console.log(...a); }

// ─── PREFLIGHT ──────────────────────────────────────────────────────────────
function preflight() {
  const miss = [];
  if (!URL) miss.push("VITE_SUPABASE_URL");
  if (!ANON_KEY) miss.push("VITE_SUPABASE_ANON_KEY");
  if (!SERVICE_KEY) miss.push("SUPABASE_SERVICE_KEY");
  if (miss.length) { console.error("❌ Brak w .env: " + miss.join(", ")); process.exit(1); }
  if (process.env.LOAD_TEST_CONFIRM !== "1") {
    console.error("⛔ Zabezpieczenie: ustaw LOAD_TEST_CONFIRM=1, aby uruchomić.");
    console.error(`   Test ZAPISZE dane do: ${URL}`);
    console.error("   Użyj OSOBNEGO projektu Supabase (staging), nie produkcji.");
    process.exit(1);
  }
  console.log(`\n🌐 Cel: ${URL}`);
  console.log(`👥 Uczestnicy: ${TOTAL}  ·  Miasta: ${CITIES.join(", ")}  ·  Pytań: ${ROUNDS}`);
  if (TOTAL > 200) console.log("⚠️  >200 połączeń z jednej maszyny może trafić w limity socketów — rozważ sharding/VM.");
}

// ─── SETUP ──────────────────────────────────────────────────────────────────
async function setup() {
  log("\n🔧 SETUP");
  const perCity = Math.max(1, Math.floor(TOTAL / CITIES.length));
  for (const city of CITIES) {
    // Dedykowana sesja testowa (osobna od ewentualnych realnych)
    const { data: sess, error: sErr } = await service.from("quiz_sessions")
      .insert({ city, status: "waiting", is_practice: true, current_question_idx: 0 }).select().single();
    if (sErr) throw new Error(`create session ${city}: ${sErr.message}`);

    // Pytania syntetyczne (moduł 1)
    const qRows = Array.from({ length: ROUNDS }, (_, i) => ({
      city, module: 1, q: `[LOAD ${city}] Pytanie ${i + 1}`,
      opts: ["A", "B", "C", "D"], ans: i % 4, exp: "load-test", is_practice: true, sort_order: i,
    }));
    const { data: qs, error: qErr } = await service.from("questions").insert(qRows).select("id");
    if (qErr) throw new Error(`create questions ${city}: ${qErr.message}`);

    // Kody uczestników
    const codeRows = Array.from({ length: perCity }, (_, i) => ({
      code: `${CITY_PREFIX[city] || "XXX"}-${1000 + Math.floor(Math.random() * 9000)}-${i}`.slice(0, 16),
      name: `Load${i + 1}`, surname: city, city,
    }));
    const { data: codes, error: cErr } = await service.from("participant_codes").insert(codeRows).select("id, code");
    if (cErr) throw new Error(`create codes ${city}: ${cErr.message}`);

    state.cities.push({ city, sessionId: sess.id, codes, questionIds: qs.map((q) => q.id), questions: qs });
    log(`  ${city.padEnd(10)} sesja ✓  ${qs.length} pytań  ${codes.length} kodów`);
  }
}

// ─── SPAWN PARTICIPANTS (realne połączenia Realtime) ─────────────────────────
async function spawn() {
  log("\n🔌 ŁĄCZENIE UCZESTNIKÓW (osobny WebSocket każdy)");
  const tasks = [];
  for (const c of state.cities) {
    for (const codeRow of c.codes) {
      tasks.push((async () => {
        const client = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
        const p = { client, channel: null, code: codeRow.code, city: c.city, sessionId: c.sessionId };
        // markCodeUsed (RPC anon) — realna ścieżka dołączenia
        try { await client.rpc("mark_code_used", { p_code: codeRow.code, p_session_id: c.sessionId }); } catch (_) {}
        await new Promise((resolve) => {
          const ch = client.channel(`quiz-${c.sessionId}`)
            .on("postgres_changes",
              { event: "UPDATE", schema: "public", table: "quiz_sessions", filter: `id=eq.${c.sessionId}` },
              ({ new: s }) => onAdvance(p, s))
            .subscribe((status) => {
              if (status === "SUBSCRIBED") { connected++; resolve(); }
              else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") { connectFail++; resolve(); }
            });
          p.channel = ch;
          setTimeout(resolve, 15000); // nie blokuj w nieskończoność
        });
        participants.push(p);
      })());
    }
  }
  await Promise.all(tasks);
  log(`  połączonych: ${connected}/${participants.length}   błędów połączenia: ${connectFail}`);
  if (connected < participants.length) {
    log("  ⚠️  Część połączeń nie wstała — prawdopodobnie limit Realtime planu (Free=200). To wynik testu.");
  }
}

// Reakcja uczestnika na zmianę pytania (mierzy latencję + odpowiada)
function onAdvance(p, s) {
  if (!s || s.status !== "running" || s.q_started_at == null) return;
  const idx = s.current_question_idx;
  const key = `${p.sessionId}:${idx}`;
  const t0 = sendAt.get(key);
  if (t0 != null) latencies.push(Date.now() - t0);

  // odpowiedz po losowym "ludzkim" opóźnieniu
  const delay = Math.floor(Math.random() * ANSWER_MAX_MS);
  const cityState = state.cities.find((c) => c.sessionId === p.sessionId);
  const qId = cityState?.questionIds[idx];
  if (!qId) return;
  setTimeout(async () => {
    const correct = Math.random() > 0.3;
    const chosen = correct ? (idx % 4) : (idx + 1) % 4;
    const timeLeft = Math.max(1, TIME_PER_Q - Math.ceil(delay / 1000));
    const { error } = await p.client.from("answers").insert({
      session_id: p.sessionId, participant_code: p.code, participant_name: `Load ${p.city}`,
      city: p.city, question_id: qId, module: 1, chosen, is_correct: correct,
      points: calcPts(timeLeft, TIME_PER_Q, correct), response_time_s: Math.ceil(delay / 1000),
    });
    if (!error) answerOk++;
    else if (error.code === "23505") dupAnswers++;
    else answerErr++;
  }, delay);
}

// ─── DRIVE (admin advance) ───────────────────────────────────────────────────
async function drive() {
  log("\n▶️  PRZEBIEG QUIZU");
  for (const c of state.cities) {
    await service.from("quiz_sessions").update({ status: "running" }).eq("id", c.sessionId);
  }
  const windowMs = ANSWER_MAX_MS + 1500;
  for (let idx = 0; idx < ROUNDS; idx++) {
    for (const c of state.cities) {
      sendAt.set(`${c.sessionId}:${idx}`, Date.now());
      await service.from("quiz_sessions").update({
        current_question_idx: idx, q_started_at: new Date().toISOString(),
      }).eq("id", c.sessionId);
    }
    process.stdout.write(`  pytanie ${idx + 1}/${ROUNDS} — czekam ${Math.round(windowMs / 1000)}s na odpowiedzi…\n`);
    await sleep(windowMs);
  }
  for (const c of state.cities) {
    await service.from("quiz_sessions").update({ status: "ended" }).eq("id", c.sessionId);
  }
}

// ─── EXACTLY-ONCE ADVANCE (optimistic lock) ──────────────────────────────────
async function exactlyOnceAdvance() {
  log("\n🔒 EXACTLY-ONCE ADVANCE (advanceSessionQuestion pod wyścigiem)");
  const c = state.cities[0];
  await service.from("quiz_sessions").update({ status: "running", current_question_idx: 0, q_started_at: new Date().toISOString() }).eq("id", c.sessionId);
  const RACE = Math.min(50, participants.length || 20);
  const callers = Array.from({ length: RACE }, () => createClient(URL, ANON_KEY, { auth: { persistSession: false } }));
  const results = await Promise.all(callers.map((cl) =>
    cl.rpc("advance_session_question", { p_session_id: c.sessionId, p_expected_idx: 0, p_next_idx: 1 })
      .then(({ data }) => data).catch(() => null)
  ));
  const winners = results.filter((r) => r != null).length;
  log(`  ${RACE} równoczesnych wywołań → ${winners} wygranych (oczekiwane: 1) ${winners === 1 ? "✅" : "❌"}`);
  return winners === 1;
}

// ─── RECONCILE ────────────────────────────────────────────────────────────────
async function reconcile() {
  log("\n📊 RECONCILIACJA");
  let totalDb = 0;
  for (const c of state.cities) {
    const { count } = await service.from("answers")
      .select("*", { count: "exact", head: true }).eq("session_id", c.sessionId);
    totalDb += count || 0;
  }
  const expected = answerOk; // ile insertów zgłosiło sukces
  log(`  odpowiedzi w bazie: ${totalDb}   sukcesów zapisu (klient): ${answerOk}   duplikaty(23505): ${dupAnswers}   błędy: ${answerErr}`);
  return { totalDb, expected };
}

// ─── CLEANUP ──────────────────────────────────────────────────────────────────
async function cleanup() {
  log("\n🧹 CLEANUP");
  for (const p of participants) { try { await p.client.removeChannel(p.channel); } catch (_) {} }
  for (const c of state.cities) {
    try { await service.from("answers").delete().eq("session_id", c.sessionId); } catch (_) {}
    try { await service.from("participant_codes").delete().in("id", c.codes.map((x) => x.id)); } catch (_) {}
    try { await service.from("questions").delete().in("id", c.questionIds); } catch (_) {}
    try { await service.from("quiz_sessions").delete().eq("id", c.sessionId); } catch (_) {}
  }
  log("  posprzątane (sesje, pytania, kody, odpowiedzi testowe usunięte)");
}

// ─── REPORT ─────────────────────────────────────────────────────────────────
function report(once, rec) {
  log(`\n${"═".repeat(56)}`);
  log("📈 RAPORT OBCIĄŻENIA");
  log(`${"─".repeat(56)}`);
  log(`  Połączenia Realtime:   ${connected}/${participants.length}  (błędy: ${connectFail})`);
  log(`  Latencja advance→odbiór (ms):`);
  log(`     próbek=${latencies.length}  p50=${pct(latencies,50)}  p95=${pct(latencies,95)}  p99=${pct(latencies,99)}  max=${Math.max(0,...latencies)}`);
  log(`  Zapisy odpowiedzi:     ok=${answerOk}  dup=${dupAnswers}  błędy=${answerErr}`);
  log(`  W bazie po przebiegu:  ${rec.totalDb}`);
  log(`  Exactly-once advance:  ${once ? "✅ tak" : "❌ NIE"}`);
  log(`${"─".repeat(56)}`);
  // Progi akceptacji (orientacyjne — quiz: liczy się sekunda)
  const okLat = pct(latencies, 95) > 0 && pct(latencies, 95) < 1500;
  const okConn = connected === participants.length;
  const okErr = answerErr === 0;
  log(`  PROGI:  latencja p95<1500ms ${okLat ? "✅" : "⚠️"}   wszystkie połączenia ${okConn ? "✅" : "⚠️ (limit planu?)"}   0 błędów zapisu ${okErr ? "✅" : "⚠️"}`);
  log(`${"═".repeat(56)}\n`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  preflight();
  let once = false, rec = { totalDb: 0 };
  try {
    await setup();
    await spawn();
    await drive();
    once = await exactlyOnceAdvance();
    rec = await reconcile();
    report(once, rec);
  } finally {
    await cleanup();
  }
}

main().catch((e) => { console.error("\n💥 FATAL:", e.message); cleanup().finally(() => process.exit(1)); });
