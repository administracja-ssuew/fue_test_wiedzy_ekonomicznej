/**
 * FUE Quiz — weryfikacja PRODUKCJI (read-only)
 *
 * Sprawdza z perspektywy ANON, czy na produkcyjnej bazie są wgrane funkcje z
 * SUPABASE_FIXES.sql (sekcje 16–24) oraz czy sekcja 23 faktycznie blokuje anona.
 * Woła RPC z nieistniejącymi UUID/kodami → żadnego zapisu (UPDATE-y nie trafiają
 * w żaden wiersz). Bezpieczne do uruchomienia na produkcji.
 *
 *   npm run verify-prod
 *
 * Używa produkcyjnych kluczy (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
 */

import { createClient } from "@supabase/supabase-js";

const URL  = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;
if (!URL || !ANON) { console.error("❌ Brak VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY w .env"); process.exit(1); }

const anon = createClient(URL, ANON, { auth: { persistSession: false } });
const DUMMY = "00000000-0000-0000-0000-000000000000";

let pass = 0, fail = 0, warn = 0;
const ok   = (l, d = "") => { pass++; console.log(`  ✅ ${l.padEnd(46)} ${d}`); };
const bad  = (l, d = "") => { fail++; console.error(`  ❌ ${l.padEnd(46)} ${d}`); };
const note = (l, d = "") => { warn++; console.log(`  ⚠️  ${l.padEnd(46)} ${d}`); };

const isMissing = (e) => e && (e.code === "PGRST202" || /Could not find the function/i.test(e.message || ""));
const isDenied  = (e) => e && (e.code === "42501" || /permission denied/i.test(e.message || ""));

async function callRpc(name, args) { return anon.rpc(name, args); }

async function main() {
  console.log(`\n🌐 PRODUKCJA: ${URL}\n`);
  console.log("🔎 WERYFIKACJA WDROŻENIA SQL (sekcje 16–24)\n");

  // ── Funkcje dostępne dla anon (mają istnieć i NIE być "function not found") ──
  for (const [name, args, sect] of [
    ["get_admin_answer_summary", { p_session_id: DUMMY, p_question_id: DUMMY }, "17 (licznik 'Następne'/baner)"],
    ["get_participant_answers",  { p_session_id: DUMMY, p_code: "PROBE-0000" }, "16 (wynik po refreshu)"],
    ["get_live_answer_count",    { p_session_id: DUMMY, p_question_id: DUMMY }, "9  (LiveView licznik)"],
    ["mark_code_used",           { p_code: "PROBE-0000", p_session_id: DUMMY }, "24 (re-join session_id)"],
    ["advance_session_question", { p_session_id: DUMMY, p_expected_idx: 0, p_next_idx: 1 }, "22 (advance/odliczanie)"],
  ]) {
    const { error } = await callRpc(name, args);
    if (isMissing(error)) bad(`${name} — BRAK na produkcji`, `→ uruchom sekcję ${sect}`);
    else ok(`${name} — istnieje`, `sekcja ${sect}`);
  }

  console.log("\n🔒 SEKCJA 23 — anon MUSI być zablokowany na tych funkcjach:\n");
  for (const [name, args] of [
    ["get_session_results",        { p_session_id: DUMMY }],
    ["update_quiz_session_admin",  { p_session_id: DUMMY, p_data: {} }],
    ["start_quiz_session",         { p_session_id: DUMMY }],
    ["get_admin_question_stats",   { p_session_id: DUMMY, p_question_id: DUMMY }],
  ]) {
    const { error } = await callRpc(name, args);
    if (isDenied(error))       ok(`${name} — anon ZABLOKOWANY`, "(sekcja 23 OK)");
    else if (isMissing(error)) bad(`${name} — BRAK na produkcji`, "→ uruchom schemat + fixes");
    else                       bad(`${name} — anon MA DOSTĘP`, "⚠️ sekcja 23 NIE wgrana — dziura!");
  }

  // event_log (sekcja 18): anon nie czyta (RLS admin) — sprawdzamy że tabela istnieje
  {
    const { error } = await anon.from("event_log").select("id").limit(1);
    if (error && /does not exist|relation/i.test(error.message)) bad("event_log — tabela BRAK", "→ uruchom sekcję 18");
    else ok("event_log — tabela istnieje", "sekcja 18 (telemetria)");
  }

  console.log("\n🆕 SEKCJE 25–28 (ranking/zapowiedź/hardening/zegar):\n");

  // 26 — advance_session_question z p_lead_seconds (4-arg overload)
  {
    const { error } = await callRpc("advance_session_question", { p_session_id: DUMMY, p_expected_idx: 0, p_next_idx: 1, p_lead_seconds: 30 });
    if (isMissing(error)) bad("advance(...p_lead_seconds) — BRAK", "→ uruchom sekcję 26 (zapowiedź modułu)");
    else ok("advance_session_question(4-arg) — istnieje", "sekcja 26");
  }
  // 28 — server_now (sync zegara)
  {
    const { data, error } = await callRpc("server_now", {});
    if (isMissing(error)) bad("server_now — BRAK", "→ uruchom sekcję 28 (sync zegara) — działa fallback");
    else if (!error && Number(data) > 0) ok("server_now — działa dla anon", `sekcja 28 (epoch=${data})`);
    else bad("server_now — błąd", error?.message || "");
  }
  // 27 — hardening: validate/count/code_exists istnieją + anon NIE czyta tabeli
  {
    const { error: ev } = await callRpc("validate_participant_code", { p_code: "PROBE-0000" });
    if (isMissing(ev)) bad("validate_participant_code — BRAK", "→ uruchom sekcję 27 (hardening)");
    else ok("validate_participant_code — istnieje", "sekcja 27");
    const { error: ec } = await callRpc("count_participants_in_session", { p_city: "Kraków", p_session_id: DUMMY });
    if (isMissing(ec)) bad("count_participants_in_session — BRAK", "→ uruchom sekcję 27");
    else ok("count_participants_in_session — istnieje", "sekcja 27");
    const { error: ex } = await callRpc("code_exists", { p_code: "PROBE-0000" });
    if (isMissing(ex)) bad("code_exists — BRAK", "→ uruchom sekcję 27");
    else ok("code_exists — istnieje", "sekcja 27");
    const { data: rows, error: er } = await anon.from("participant_codes").select("code").limit(1);
    if (isDenied(er)) ok("anon NIE czyta participant_codes", "sekcja 27 — luka zamknięta");
    else if (!er) note("anon WCIĄŻ czyta participant_codes", "→ sekcja 27 NIE wgrana (enumeracja kodów!)");
    else note("participant_codes — niejednoznaczne", er.message);
  }

  console.log("\n🛡️  SEKCJA 29 (walidacja serwerowa + ukrycie poprawnej odp.):\n");
  {
    const { error: eq } = await callRpc("get_quiz_questions", { p_city: "Kraków" });
    if (isMissing(eq)) bad("get_quiz_questions — BRAK", "→ uruchom sekcję 29");
    else ok("get_quiz_questions — istnieje", "sekcja 29 (ans ukryte dla anon)");
    const { error: es } = await callRpc("submit_answer", { p_session_id: DUMMY, p_code: "PROBE-0000", p_name: "x", p_question_id: DUMMY, p_chosen: 0 });
    // PROBE: kod nie istnieje → RPC rzuci 'invalid code' (P0001), ale to znaczy że ISTNIEJE
    if (isMissing(es)) bad("submit_answer — BRAK", "→ uruchom sekcję 29");
    else ok("submit_answer — istnieje", "sekcja 29 (serwerowe is_correct)");
    const { data: qrows, error: eqr } = await anon.from("questions").select("ans").limit(1);
    if (isDenied(eqr)) ok("anon NIE czyta questions bezpośrednio", "sekcja 29 — ans niedostępne");
    else if (!eqr) note("anon WCIĄŻ czyta questions (ans!)", "→ sekcja 29 NIE wgrana");
    else note("questions — niejednoznaczne", eqr.message);
  }

  console.log("\n" + "─".repeat(56));
  if (fail === 0) console.log(`✅ PRODUKCJA GOTOWA pod kątem SQL (${pass} OK${warn ? `, ${warn} uwag` : ""})`);
  else console.log(`❌ ${fail} PROBLEM(ÓW) — uzupełnij wskazane sekcje SQL na produkcji`);
  console.log("ℹ️  Sekcji 21 (Realtime na answers) nie da się sprawdzić sondą — weryfikuje ją");
  console.log("    instant-push w panelu. 22/24 to zachowanie — najpewniej po prostu (re)uruchom.");
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("💥 FATAL:", e.message); process.exit(1); });
