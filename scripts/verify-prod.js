/**
 * FUE Quiz — weryfikacja PRODUKCJI (read-only)
 *
 * Sprawdza z perspektywy ANON, czy na produkcyjnej bazie są wgrane funkcje z
 * SUPABASE_FIXES.sql (sekcje 16–41) oraz czy funkcje admina faktycznie blokują anona.
 * Sekcje 16–38 = kontrakt obecnie wdrożonego frontu (nie ruszać); sekcje 39–40 =
 * plan sesji, RPC v2, zamiatacz pg_cron (żywotność przez sweeper_status); sekcja 41 =
 * utwardzenie starych RPC (znacznik schema_marker_41 + stare sygnatury, SC6).
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

  console.log("\n⚡ SEKCJA 37 (wydajność pod obciążeniem + eksport XLSX):\n");
  {
    // 37.4 — anon MUSI dostać "permission denied" (funkcja istnieje, ale jest admin-only).
    // "function not found" = sekcja 37 nie wgrana. To jedyna sonda sekcji 37 dostępna
    // dla anona: 37.1 (publikacja Realtime), 37.2 (indeks) i 37.3 (seed modules)
    // wymagają uprawnień, których anon z definicji nie ma.
    const { error } = await callRpc("get_session_detailed_results", { p_session_id: DUMMY });
    if (isMissing(error))     bad("get_session_detailed_results — BRAK", "→ uruchom sekcję 37 (eksport XLSX nie zadziała)");
    else if (isDenied(error)) ok("get_session_detailed_results — istnieje", "sekcja 37, anon zablokowany ✓");
    else                      bad("get_session_detailed_results — anon MA DOSTĘP", "⚠️ GRANT źle wgrany — wyniki wyciekają!");

    // 37.3 — moduły zasiane? Pusta tabela = przyczyna usterki "modułów nie da się edytować".
    const { data: mods, error: em } = await anon.from("modules").select("id").limit(6);
    if (em)                   note("modules — nie udało się sprawdzić", em.message);
    else if (!mods?.length)   bad("modules — tabela PUSTA", "→ sekcja 37.3 nie wgrana; edycja modułów będzie no-op");
    else                      ok("modules — zasiane", `${mods.length} modułów w bazie`);
  }

  console.log("\n📡 SEKCJA 38 (publikacja Realtime — stan pożądany):\n");
  {
    const { data: pub, error } = await callRpc("realtime_publication_status", {});
    if (isMissing(error)) {
      bad("realtime_publication_status — BRAK", "→ uruchom sekcję 38");
      note("publikacji nie da się sprawdzić bez tej funkcji", "sprawdź ręcznie w SQL Editorze");
    } else if (error) {
      bad("realtime_publication_status — błąd", error.message);
    } else {
      if (!pub.publication_exists)  bad("supabase_realtime — publikacja NIE ISTNIEJE", "→ sekcja 38");
      else if (pub.all_tables)      bad("supabase_realtime — FOR ALL TABLES", "→ sekcja 37.1 była no-opem! uruchom 38");
      else                          ok("supabase_realtime — lista tabel", "sekcja 38");

      if (pub.quiz_sessions) ok("quiz_sessions W publikacji", "kanał sterujący quizem żyje");
      else                   bad("quiz_sessions POZA publikacją", "⚠️ uczestnicy nie dostaną startu przez Realtime → sekcja 38");

      if (pub.answers) bad("answers WCIĄŻ w publikacji", "→ sekcja 37.1 (lawina blokuje kanał quizu)");
      else             ok("answers POZA publikacją", "sekcja 37.1 ✓");

      if (pub.participant_codes) note("participant_codes wciąż w publikacji", "→ sekcja 37.1 (nieszkodliwe, ale zbędne)");
      else                       ok("participant_codes POZA publikacją", "sekcja 37.1 ✓");
    }
  }

  console.log("\n🧭 SEKCJE 39–40 (plan sesji, zamiatacz, v2):\n");
  {
    const now = new Date().toISOString();
    const items = [{ i: 0, id: DUMMY, m: 1, tpq: 20, lead: 10, o: 10000, c: 30000, r: 36000 }];

    // Funkcje dostępne dla anona — mają istnieć.
    {
      const { error } = await callRpc("plan_position", { p_items: items, p_anchor: now, p_paused_at: null, p_at: now });
      if (isMissing(error)) bad("plan_position — BRAK", "→ sekcja 39");
      else if (error)       bad("plan_position — błąd", error.message);
      else                  ok("plan_position — istnieje", "sekcja 39");
    }
    {
      const { error } = await callRpc("sweep_decision", {
        p_items: items, p_anchor: now, p_paused_at: null, p_status: "waiting",
        p_cur_idx: null, p_q_started: null, p_revealed_idx: null, p_at: now,
      });
      if (isMissing(error)) bad("sweep_decision — BRAK", "→ sekcja 39");
      else if (error)       bad("sweep_decision — błąd", error.message);
      else                  ok("sweep_decision — istnieje", "sekcja 39");
    }
    {
      const { data, error } = await callRpc("get_participant_state", { p_code: "PROBE-0000" });
      if (isMissing(error)) bad("get_participant_state — BRAK", "→ sekcja 39");
      else if (!error && data?.error === "invalid code" && Number(data?.server_now) > 0)
        ok("get_participant_state — istnieje", `sekcja 39 (server_now=${data.server_now})`);
      else bad("get_participant_state — nieoczekiwana odpowiedź", error?.message || JSON.stringify(data));
    }
    {
      const { error } = await callRpc("submit_answer_v2", { p_session_id: DUMMY, p_code: "PROBE-0000", p_name: "x", p_question_id: DUMMY, p_chosen: 0 });
      // kod nie istnieje → 'invalid code' = funkcja ISTNIEJE
      if (isMissing(error)) bad("submit_answer_v2 — BRAK", "→ sekcja 39");
      else ok("submit_answer_v2 — istnieje", `sekcja 39${error ? ` (${error.message})` : ""}`);
    }
    {
      const { error } = await callRpc("get_answer_summary_v2", { p_session_id: DUMMY, p_question_id: DUMMY });
      if (isMissing(error)) bad("get_answer_summary_v2 — BRAK", "→ sekcja 39");
      else ok("get_answer_summary_v2 — istnieje", "sekcja 39");
    }

    // Tabela planu i kolumny planu w quiz_sessions.
    {
      const { error } = await anon.from("session_plans").select("session_id").limit(1);
      if (error) bad("session_plans — błąd/BRAK", `${error.message} → sekcja 39`);
      else       ok("session_plans — anon czyta plan", "bez ans (sekcja 39)");
    }
    {
      const { error } = await anon.from("quiz_sessions").select("plan_anchor_at,plan_paused_at,revealed_idx,revealed_ans").limit(1);
      if (error) bad("quiz_sessions — kolumny planu BRAK", `${error.message} → sekcja 39`);
      else       ok("quiz_sessions — kolumny planu", "sekcja 39");
    }

    // Anon ZABLOKOWANY na akcjach admina i zamiataczu.
    for (const [name, args] of [
      ["start_quiz_session_v2",  { p_session_id: DUMMY }],
      ["admin_pause_session",    { p_session_id: DUMMY }],
      ["admin_resume_session",   { p_session_id: DUMMY }],
      ["admin_skip_question",    { p_session_id: DUMMY, p_idx: 0 }],
      ["admin_repeat_question",  { p_session_id: DUMMY, p_idx: 0 }],
      ["admin_sweep_session",    { p_session_id: DUMMY }],
      ["advance_due_sessions",   {}],
    ]) {
      const { error } = await callRpc(name, args);
      if (isDenied(error))       ok(`${name} — anon ZABLOKOWANY`, "(sekcja 39 OK)");
      else if (isMissing(error)) bad(`${name} — BRAK`, "→ sekcja 39");
      else                       bad(`${name} — anon MA DOSTĘP`, "⚠️ GRANT źle wgrany — dziura!");
    }

    // Żywotność zamiatacza (sekcja 40).
    {
      const { data: st, error } = await callRpc("sweeper_status", {});
      if (isMissing(error))              bad("sweeper_status — BRAK", "→ sekcja 40");
      else if (error)                    bad("sweeper_status — błąd", error.message);
      else if (!st?.cron_installed)      bad("pg_cron nie zainstalowany", "→ sekcja 40");
      else if (!st?.job_active)          bad("zadanie fue-advance-due nieaktywne", "→ sekcja 40 / cron.job");
      else if (st.last_status === "failed") bad("zamiatacz — ostatni przebieg FAILED", "sprawdź cron.job_run_details");
      else if (st.last_run_age_s == null || Number(st.last_run_age_s) > 5)
        bad("zamiatacz nie żyje", `ostatni przebieg ${st.last_run_age_s == null ? "—" : Number(st.last_run_age_s).toFixed(1)} s temu`);
      else ok("zamiatacz żyje", `ostatni przebieg ${Number(st.last_run_age_s).toFixed(1)} s temu, harmonogram '${st.schedule}'`);
    }
  }

  console.log("\n🔐 SEKCJA 41 (utwardzenie starych RPC):\n");
  {
    const { data, error } = await callRpc("schema_marker_41", {});
    if (isMissing(error))      bad("schema_marker_41 — BRAK", "→ uruchom sekcję 41 (po wdrożeniu frontu!)");
    else if (error)            bad("schema_marker_41 — błąd", error.message);
    else if (data === true)    ok("schema_marker_41 — sekcja 41 wgrana", "stare RPC utwardzone");
    else                       bad("schema_marker_41 — nieoczekiwana odpowiedź", JSON.stringify(data));

    // SC6: stare sygnatury NADAL istnieją (stary bundle w cache nie dostaje PGRST202).
    for (const [name, args] of [
      ["submit_answer",            { p_session_id: DUMMY, p_code: "PROBE-0000", p_name: "x", p_question_id: DUMMY, p_chosen: 0 }],
      ["get_participant_answers",  { p_session_id: DUMMY, p_code: "PROBE-0000" }],
      ["get_admin_answer_summary", { p_session_id: DUMMY, p_question_id: DUMMY }],
    ]) {
      const { error: e } = await callRpc(name, args);
      if (isMissing(e)) bad(`${name} — BRAK (stara sygnatura)`, "⚠️ SC6 — stary bundle dostanie PGRST202");
      else              ok(`${name} — stara sygnatura istnieje`, "sekcja 41 / SC6");
    }
    // start_quiz_session: funkcja MA istnieć (błąd inny niż PGRST202); anon i tak odmowa.
    {
      const { error: e } = await callRpc("start_quiz_session", { p_session_id: DUMMY });
      if (isMissing(e)) bad("start_quiz_session — BRAK (stara sygnatura)", "⚠️ SC6 — stary panel dostanie PGRST202");
      else if (!e)      bad("start_quiz_session — anon bez błędu", "⚠️ oczekiwana odmowa");
      else              ok("start_quiz_session — stara sygnatura istnieje", `sekcja 41 (${e.code || e.message})`);
    }
  }

  console.log("\n" + "─".repeat(56));
  if (fail === 0) console.log(`✅ PRODUKCJA GOTOWA pod kątem SQL (${pass} OK${warn ? `, ${warn} uwag` : ""})`);
  else console.log(`❌ ${fail} PROBLEM(ÓW) — uzupełnij wskazane sekcje SQL na produkcji`);
  console.log("ℹ️  Sekcja 37.1 CELOWO zdejmuje answers z publikacji Realtime (odwraca sekcję 21):");
  console.log("    lawina ~29 000 INSERT-ów blokowała kanał, którym idą przejścia pytań.");
  console.log("    Licznik odpowiedzi w panelu jedzie teraz z polla co 1 s — to jest poprawne.");
  console.log("    Publikacji ani indeksu (37.1/37.2) nie da się sprawdzić z uprawnieniami anona.");
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("💥 FATAL:", e.message); process.exit(1); });
