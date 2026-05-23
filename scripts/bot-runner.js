/**
 * FUE Quiz — Bot Runner (Integration Test)
 *
 * Uruchomienie: npm run bot
 *
 * Wymaga w .env:
 *   SUPABASE_SERVICE_KEY  ← Settings → API → service_role (secret)
 *   BOT_CITY        (domyślnie: Kraków)
 *   BOT_COUNT       (domyślnie: 5)
 *   BOT_ANSWER_DELAY_MS (domyślnie: 200)
 */

import { createClient } from "@supabase/supabase-js";
import {
  loginAdmin, logoutAdmin,
  addQuestion, updateQuestion, deleteQuestion, getQuestions,
  generateParticipantCode, getParticipantCodes, deleteParticipantCode,
  getCityBg, setCityBg,
  getModules, updateModule,
  getOrCreateSession, updateSession, endAndResetSession,
  validateParticipantCode, markCodeUsed,
  saveAnswer, getSessionResults,
} from "../src/lib/supabase.js";

// Service role client — bypasses RLS, no auth needed
const SERVICE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supa = SERVICE_URL && SERVICE_KEY ? createClient(SERVICE_URL, SERVICE_KEY) : null;

// ─── CONFIG ────────────────────────────────────────────────────────────────────

const BOT_CITY = process.env.BOT_CITY || "Kraków";
const BOT_COUNT = parseInt(process.env.BOT_COUNT || "5", 10);
const BOT_ANSWER_DELAY_MS = parseInt(process.env.BOT_ANSWER_DELAY_MS || "200", 10);

// ─── STATE (for cleanup) ───────────────────────────────────────────────────────

const state = {
  adminId: null,
  testQuestionId: null,
  botCodes: [],           // [{id, code, name}]
  botQuestionIds: [],     // ids of questions created by bot (cleaned up after)
  originalBg: null,
  originalModuleTimePerQ: null,
  sessionId: null,
  testModuleId: null,
};

// ─── HELPERS ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function ok(label, detail = "") {
  passed++;
  console.log(`  ✅ ${label.padEnd(35)} ${detail}`);
}

function fail(label, err) {
  failed++;
  console.error(`  ❌ ${label.padEnd(35)} ${err}`);
}

function assert(label, condition, detail = "") {
  if (condition) {
    ok(label, detail);
  } else {
    fail(label, `assertion failed — ${detail}`);
    throw new Error(`ASSERT: ${label}`);
  }
}

function calcPts(timeLeft, maxTime, correct) {
  return correct ? Math.round(500 + (timeLeft / maxTime) * 500) : 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── CLEANUP ──────────────────────────────────────────────────────────────────

async function cleanup() {
  console.log("\n🧹 CLEANUP");

  // Delete bot codes
  for (const bot of state.botCodes) {
    try { await deleteParticipantCode(bot.id); } catch (_) {}
  }
  if (state.botCodes.length) ok("deleteParticipantCode × botów", `${state.botCodes.length} usuniętych`);

  // Delete test question if still present
  if (state.testQuestionId) {
    try { await deleteQuestion(state.testQuestionId); } catch (_) {}
  }

  // Delete bot quiz questions
  for (const qId of state.botQuestionIds) {
    try { await deleteQuestion(qId); } catch (_) {}
  }
  if (state.botQuestionIds.length) ok("deleteQuestion × pytań botów", `${state.botQuestionIds.length} usuniętych`);

  // Restore cityBg
  if (state.originalBg !== null) {
    try { await setCityBg(BOT_CITY, state.originalBg); } catch (_) {}
    ok("restore cityBg");
  }

  // Restore module timePerQ
  if (state.testModuleId !== null && state.originalModuleTimePerQ !== null) {
    try { await updateModule(state.testModuleId, { timePerQ: state.originalModuleTimePerQ }); } catch (_) {}
    ok("restore module timePerQ");
  }

  // Reset session
  if (state.adminId) {
    try { await endAndResetSession(BOT_CITY, state.adminId); } catch (_) {}
    ok("endAndResetSession", "sesja w stanie waiting");
  }

  // Logout
  try { await logoutAdmin(); } catch (_) {}

  console.log("  done\n");
}

// ─── PHASE 1: ADMIN OPERATIONS ────────────────────────────────────────────────

async function phaseAdminOps(admin) {
  console.log("\n🔧 ADMIN OPERATIONS");

  // Ensure a session exists for the city (needed for setCityBg which updates quiz_sessions)
  const { data: earlySession, error: earlyErr } = await getOrCreateSession(BOT_CITY, admin.id);
  if (earlyErr) { fail("getOrCreateSession (admin ops pre-req)", earlyErr); throw new Error(earlyErr); }
  state.sessionId = earlySession.id;

  // A1: addQuestion
  const { data: addedQ, error: addErr } = await addQuestion({
    city: BOT_CITY, module: 1,
    q: "[BOT TEST] Ile wynosi 2+2?",
    opts: ["3", "4", "5", "6"],
    ans: 1, exp: "Matematyka podstawowa.",
    createdBy: admin.id,
  });
  if (addErr) { fail("addQuestion", addErr); throw new Error(addErr); }
  state.testQuestionId = addedQ.id;
  const qs1 = await getQuestions(BOT_CITY);
  assert("addQuestion", qs1.some((q) => q.id === addedQ.id), `id: ${addedQ.id}`);

  // A2: updateQuestion
  const { error: updErr } = await updateQuestion(addedQ.id, { q: "[BOT TEST] Zaktualizowane pytanie" });
  if (updErr) { fail("updateQuestion", updErr); throw new Error(updErr); }
  const qs2 = await getQuestions(BOT_CITY);
  assert("updateQuestion", qs2.find((q) => q.id === addedQ.id)?.q === "[BOT TEST] Zaktualizowane pytanie", "tekst zaktualizowany");

  // A3: deleteQuestion
  const { error: delErr } = await deleteQuestion(addedQ.id);
  if (delErr) { fail("deleteQuestion", delErr); throw new Error(delErr); }
  state.testQuestionId = null;
  const qs3 = await getQuestions(BOT_CITY);
  assert("deleteQuestion", !qs3.some((q) => q.id === addedQ.id), "nieobecne w getQuestions");

  // A4: generateParticipantCode
  const { data: codeEntry, error: codeErr } = await generateParticipantCode({
    name: "BotTest", surname: "Admin", city: BOT_CITY, createdBy: admin.id,
  });
  if (codeErr) { fail("generateParticipantCode", codeErr); throw new Error(codeErr); }
  assert("generateParticipantCode", /^[A-Z]{3}-\d{4}$/.test(codeEntry.code), `kod: ${codeEntry.code}`);

  // A5: getParticipantCodes
  const codes = await getParticipantCodes(BOT_CITY);
  assert("getParticipantCodes", codes.some((c) => c.id === codeEntry.id && !c.used), "kod found, used=false");

  // A6: deleteParticipantCode
  const { error: delCErr } = await deleteParticipantCode(codeEntry.id);
  if (delCErr) { fail("deleteParticipantCode", delCErr); throw new Error(delCErr); }
  const codes2 = await getParticipantCodes(BOT_CITY);
  assert("deleteParticipantCode", !codes2.some((c) => c.id === codeEntry.id), "kod nieobecny");

  // A7: getCityBg / setCityBg
  state.originalBg = await getCityBg(BOT_CITY);
  const testBg = "linear-gradient(180deg,#ff0000 0%,#0000ff 100%)";
  const { error: bgErr } = await setCityBg(BOT_CITY, testBg);
  if (bgErr) { fail("setCityBg", bgErr); throw new Error(bgErr); }
  const bgAfter = await getCityBg(BOT_CITY);
  assert("getCityBg / setCityBg", bgAfter === testBg, "tło zaktualizowane");
  await setCityBg(BOT_CITY, state.originalBg || "");
  state.originalBg = null; // cleanup already done

  // A8: getModules
  const modules = await getModules();
  assert("getModules", modules.length >= 1, `${modules.length} modułów`);

  // A9: updateModule (first module)
  const firstMod = modules[0];
  state.testModuleId = firstMod.id;
  state.originalModuleTimePerQ = firstMod.timePerQ;
  const { error: modUpdErr } = await updateModule(firstMod.id, { timePerQ: 999 });
  if (modUpdErr) { fail("updateModule", modUpdErr); throw new Error(modUpdErr); }
  const modsAfter = await getModules();
  assert("updateModule", modsAfter.find((m) => m.id === firstMod.id)?.timePerQ === 999, "timePerQ=999");
  await updateModule(firstMod.id, { timePerQ: state.originalModuleTimePerQ });
  state.testModuleId = null;
  state.originalModuleTimePerQ = null;
}

// ─── PHASE 2: SETUP ───────────────────────────────────────────────────────────

async function phaseSetup(admin) {
  console.log(`\n🎮 QUIZ SIMULATION (${BOT_COUNT} botów, ${BOT_CITY})`);

  // Get or create session, reset to waiting
  const { data: session, error: sessErr } = await getOrCreateSession(BOT_CITY, admin.id);
  if (sessErr) throw new Error(`getOrCreateSession: ${sessErr}`);
  state.sessionId = session.id;
  await updateSession(session.id, { status: "waiting", current_question_idx: 0, q_started_at: null });
  ok("getOrCreateSession", `id: ${session.id}`);

  // Create test questions (2 per module = 10 total) — cleaned up in cleanup()
  const TEST_QUESTIONS = [1, 2, 3, 4, 5].flatMap((modId) => [
    { city: BOT_CITY, module: modId, q: `[BOT TEST M${modId}] Pytanie A`, opts: ["Odp 1", "Odp 2", "Odp 3", "Odp 4"], ans: 0, exp: "Testowe." },
    { city: BOT_CITY, module: modId, q: `[BOT TEST M${modId}] Pytanie B`, opts: ["Odp 1", "Odp 2", "Odp 3", "Odp 4"], ans: 1, exp: "Testowe." },
  ]);
  for (const qDef of TEST_QUESTIONS) {
    const { data: qData, error: qErr } = await addQuestion({ ...qDef, createdBy: admin.id });
    if (qErr) throw new Error(`addQuestion (setup): ${qErr}`);
    state.botQuestionIds.push(qData.id);
  }
  ok("addQuestion × pytań testowych", `${TEST_QUESTIONS.length} pytań (2 × 5 modułów)`);

  // Generate bot codes
  const bots = [];
  for (let i = 1; i <= BOT_COUNT; i++) {
    const { data, error } = await generateParticipantCode({
      name: `Bot_${i}`, surname: "Testowy", city: BOT_CITY, createdBy: admin.id,
    });
    if (error) throw new Error(`generateParticipantCode bot ${i}: ${error}`);
    bots.push({ id: data.id, code: data.code, name: `Bot_${i}` });
    state.botCodes.push({ id: data.id, code: data.code, name: `Bot_${i}` });
  }
  ok("generateParticipantCode × botów", `${BOT_COUNT} kodów`);
  return bots;
}

// ─── PHASE 3: JOIN ────────────────────────────────────────────────────────────

async function phaseJoin(bots) {
  await Promise.all(bots.map(async (bot) => {
    const { error: vErr } = await validateParticipantCode(bot.code);
    if (vErr) throw new Error(`validateParticipantCode ${bot.code}: ${vErr}`);
    const { error: mErr } = await markCodeUsed(bot.code, state.sessionId);
    if (mErr) throw new Error(`markCodeUsed ${bot.code}: ${mErr}`);
  }));

  const codes = await getParticipantCodes(BOT_CITY);
  const usedCount = codes.filter((c) => bots.some((b) => b.code === c.code) && c.used).length;
  assert("validate + markCodeUsed × botów", usedCount === BOT_COUNT, `${usedCount}/${BOT_COUNT} used=true`);
}

// ─── PHASE 4: QUIZ LOOP ───────────────────────────────────────────────────────

async function phaseQuiz(bots) {
  const questions = await getQuestions(BOT_CITY);
  if (!questions.length) throw new Error("Brak pytań w bazie dla miasta " + BOT_CITY);

  const modules = await getModules();
  const moduleMap = {};
  for (const m of modules) moduleMap[m.id] = m;

  // Group questions by module
  const byModule = {};
  for (const q of questions) {
    if (!byModule[q.module]) byModule[q.module] = [];
    byModule[q.module].push(q);
  }

  await updateSession(state.sessionId, { status: "running", q_started_at: new Date().toISOString() });

  // Per-bot expected points tracker
  const botExpected = {};
  for (const bot of bots) botExpected[bot.code] = 0;

  // Per-bot answer correctness (deterministic seeding per bot index)
  // 70% correct: bot index determines pattern
  const sortedModuleIds = Object.keys(byModule).map(Number).sort();
  let globalQIdx = 0;

  for (const modId of sortedModuleIds) {
    const modQs = byModule[modId];
    const modInfo = moduleMap[modId] || { timePerQ: 20, name: `Moduł ${modId}` };

    for (let qi = 0; qi < modQs.length; qi++) {
      const q = modQs[qi];
      await updateSession(state.sessionId, {
        current_question_idx: globalQIdx,
        q_started_at: new Date().toISOString(),
      });

      await sleep(BOT_ANSWER_DELAY_MS);

      // All bots answer concurrently
      await Promise.all(bots.map(async (bot, botIdx) => {
        // Deterministic correct/wrong: every 3rd bot gets it wrong for variety
        const correct = ((botIdx + globalQIdx) % 3) !== 0;
        const chosen = correct ? q.ans : (q.ans + 1) % 4;
        const timeLeft = Math.max(1, modInfo.timePerQ - 1);
        const pts = calcPts(timeLeft, modInfo.timePerQ, correct);
        botExpected[bot.code] += pts;

        const { error } = await saveAnswer({
          sessionId: state.sessionId,
          participantCode: bot.code,
          participantName: bot.name,
          city: BOT_CITY,
          questionId: q.id,
          module: modId,
          chosen,
          isCorrect: correct,
          points: pts,
        });
        if (error) throw new Error(`saveAnswer ${bot.code} q${q.id}: ${error}`);
      }));

      process.stdout.write(`  [MOD ${modId} — ${modInfo.name}] Pytanie ${qi + 1}/${modQs.length} ─── ${BOT_COUNT}/${BOT_COUNT} odpowiedzi\n`);
      globalQIdx++;
    }

    // Simulate break after module 2 (if it exists)
    if (modId === 2 && sortedModuleIds.includes(3)) {
      await updateSession(state.sessionId, { status: "paused" });
      ok("[PRZERWA]", "status → paused");
      await sleep(50);
      await updateSession(state.sessionId, { status: "running" });
      ok("[PRZERWA]", "status → running");
    }
  }

  await updateSession(state.sessionId, { status: "ended" });
  ok("updateSession", "status → ended");

  return botExpected;
}

// ─── PHASE 5: RESULTS VERIFICATION ───────────────────────────────────────────

async function phaseResults(bots, botExpected) {
  console.log("\n📊 WYNIKI");

  const results = await getSessionResults(state.sessionId);

  assert("results.length === BOT_COUNT", results.length === BOT_COUNT, `${results.length} wyników`);

  // Check descending sort
  let sortedOk = true;
  for (let i = 1; i < results.length; i++) {
    if (results[i].points > results[i - 1].points) { sortedOk = false; break; }
  }
  assert("Ranking posortowany malejąco", sortedOk);

  // Print ranking
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const exp = botExpected[r.code];
    const match = exp !== undefined ? r.points === exp : true;
    const badge = match ? "✅" : `❌ (oczekiwano ${exp})`;
    console.log(`  #${i + 1} ${String(r.name || r.code).padEnd(10)} ${String(r.points).padStart(6)} pkt  ${badge}`);
    if (!match) failed++; else passed++;
  }

  // Sanity: bot with most correct answers has highest points
  // (only meaningful if more than 1 bot)
  if (bots.length > 1) {
    const sortedExpected = Object.entries(botExpected).sort((a, b) => b[1] - a[1]);
    const topExpectedCode = sortedExpected[0][0];
    assert(
      "Top bot ma najwyższy wynik",
      results[0].code === topExpectedCode || results[0].points >= (botExpected[topExpectedCode] || 0),
      `wynik #1: ${results[0].points} pkt`
    );
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!supa) {
    console.error("❌ Brak VITE_SUPABASE_URL lub SUPABASE_SERVICE_KEY w .env");
    console.error("   Pobierz service_role key: Supabase Dashboard → Settings → API");
    process.exit(1);
  }

  // Pobierz pierwszego superadmina z profiles (service key = pełny dostęp)
  const { data: profiles, error: profErr } = await supa
    .from("profiles").select("*").eq("role", "superadmin").limit(1);
  if (profErr || !profiles?.length) {
    console.error("❌ Brak profilu superadmina w tabeli profiles.");
    console.error("   Uruchom w SQL Editor:");
    console.error("   INSERT INTO public.profiles (id, full_name, city, role)");
    console.error("   SELECT id, email, NULL, 'superadmin' FROM auth.users LIMIT 1;");
    process.exit(1);
  }
  const admin = profiles[0];
  state.adminId = admin.id;
  console.log(`\n👤 Admin (service key): ${admin.full_name || admin.id} (${admin.role})`);

  // Zaloguj się do klienta supabase.js (anon key) żeby RLS działało dla admina
  const adminEmail = process.env.BOT_ADMIN_EMAIL;
  const adminPassword = process.env.BOT_ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    console.error("❌ Brak BOT_ADMIN_EMAIL lub BOT_ADMIN_PASSWORD w .env");
    process.exit(1);
  }
  const { error: loginErr } = await loginAdmin({ email: adminEmail, password: adminPassword });
  if (loginErr) {
    console.error(`❌ loginAdmin: ${loginErr}`);
    process.exit(1);
  }
  console.log(`👤 Admin (auth session): zalogowany jako ${adminEmail}`);

  try {
    await phaseAdminOps(admin);
    const bots = await phaseSetup(admin);
    await phaseJoin(bots);
    const botExpected = await phaseQuiz(bots);
    await phaseResults(bots, botExpected);
  } finally {
    await cleanup();
  }

  const total = passed + failed;
  console.log(`\n${"─".repeat(50)}`);
  if (failed === 0) {
    console.log(`✅ WSZYSTKIE TESTY PRZESZŁY (${total}/${total})`);
  } else {
    console.log(`❌ FAILED: ${failed}/${total} testów nie przeszło`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n💥 FATAL:", err.message);
  cleanup().finally(() => process.exit(1));
});
