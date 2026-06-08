/**
 * FUE Quiz — RLS / RPC Security Check
 *
 * Weryfikuje granice bezpieczeństwa z perspektywy ANONIMOWEGO klienta
 * (czyli uczestnika / kogoś z samym anon key) — to, czego unit-testy nie złapią,
 * bo dotyczy polityk RLS i grantów w bazie.
 *
 * URUCHOMIENIE:
 *   npm run rls
 *
 * .env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY
 *
 * Tworzy minimalną, oznaczoną sesję+kod (service key), sprawdza polityki
 * z klienta anon, po czym sprząta. Bezpieczny do uruchomienia (mały ślad),
 * ale i tak najlepiej na projekcie staging.
 */

import { createClient } from "@supabase/supabase-js";

// Preferuj klucze STAGING (jak load-runner) — testy na osobnym projekcie.
const USING_STAGE = !!process.env.VITE_SUPABASE_URL_STAGE;
const URL = process.env.VITE_SUPABASE_URL_STAGE || process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY_STAGE || process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY_STAGE || process.env.SUPABASE_SERVICE_KEY;

if (!URL || !ANON_KEY || !SERVICE_KEY) {
  console.error("❌ Brak kluczy Supabase w .env (VITE_SUPABASE_URL[_STAGE] / ANON / SERVICE).");
  process.exit(1);
}
console.log(`🌐 Cel: ${URL}  ${USING_STAGE ? "(STAGING ✓)" : "⚠️ (PRODUKCJA — brak *_STAGE)"}`);

const service = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
const anon    = createClient(URL, ANON_KEY, { auth: { persistSession: false } });

let passed = 0, failed = 0;
const ok   = (l, d = "") => { passed++; console.log(`  ✅ ${l.padEnd(48)} ${d}`); };
const fail = (l, d = "") => { failed++; console.error(`  ❌ ${l.padEnd(48)} ${d}`); };
const expect = (l, cond, d = "") => (cond ? ok(l, d) : fail(l, d));

const CITY = "Kraków";
const st = { sessionId: null, codeId: null, code: null, qId: null };

async function setup() {
  const { data: s } = await service.from("quiz_sessions")
    .insert({ city: CITY, status: "running", is_practice: true, current_question_idx: 0, q_started_at: new Date().toISOString() })
    .select().single();
  st.sessionId = s.id;
  const { data: q } = await service.from("questions")
    .insert({ city: CITY, module: 1, q: "[RLS] test", opts: ["A","B","C","D"], ans: 0, is_practice: true, sort_order: 0 })
    .select().single();
  st.qId = q.id;
  // Drugie pytanie KONKURSOWE (is_practice=false) — do testu submit_answer / ukrycia ans.
  const { data: q2 } = await service.from("questions")
    .insert({ city: CITY, module: 1, q: "[RLS] test2", opts: ["A","B","C","D"], ans: 0, is_practice: false, sort_order: 1 })
    .select().single();
  st.qId2 = q2.id;
  st.code = `RLS-${Date.now() % 100000}`;
  const { data: c } = await service.from("participant_codes")
    .insert({ code: st.code, name: "Rls", surname: "Check", city: CITY, used: true, session_id: st.sessionId }).select().single();
  st.codeId = c.id;
  // jedna odpowiedź, by było co (nie)czytać
  await service.from("answers").insert({
    session_id: st.sessionId, participant_code: st.code, participant_name: "Rls Check",
    city: CITY, question_id: st.qId, module: 1, chosen: 0, is_correct: true, points: 900, response_time_s: 3,
  });
}

async function checks() {
  // 1) anon NIE czyta tabeli answers (tylko admin)
  {
    const { data, error } = await anon.from("answers").select("*").eq("session_id", st.sessionId);
    expect("anon NIE czyta answers", (!data || data.length === 0) || !!error, error ? "(zablokowane)" : `zwrócono ${data?.length ?? 0}`);
  }
  // 2) anon NIE wywoła get_session_results (po REVOKE — sekcja 19)
  {
    const { error } = await anon.rpc("get_session_results", { p_session_id: st.sessionId });
    expect("anon NIE wywoła get_session_results", !!error, error ? "(odmowa)" : "DOSTĘP! uruchom sekcję 23");
  }
  // 3) get_participant_answers zwraca TYLKO własne odpowiedzi (i działa dla anon)
  {
    const { data, error } = await anon.rpc("get_participant_answers", { p_session_id: st.sessionId, p_code: st.code });
    expect("get_participant_answers (własne) działa dla anon", !error && Array.isArray(data) && data.length === 1, error ? error.message : `wierszy=${data?.length}`);
    const { data: other } = await anon.rpc("get_participant_answers", { p_session_id: st.sessionId, p_code: "NIEISTNIEJE-0000" });
    expect("get_participant_answers nie zwraca cudzych", Array.isArray(other) && other.length === 0, `wierszy=${other?.length ?? 0}`);
  }
  // 4) get_admin_answer_summary (anon-safe SECURITY DEFINER) zwraca liczby bez wierszy
  {
    const { data, error } = await anon.rpc("get_admin_answer_summary", { p_session_id: st.sessionId, p_question_id: st.qId });
    expect("get_admin_answer_summary zwraca {total,correct}", !error && data && data.total >= 1, error ? error.message : JSON.stringify(data));
  }
  // 5) anon NIE zmieni sesji bezpośrednim UPDATE (RLS sessions_admin_write)
  {
    const { data, error } = await anon.from("quiz_sessions").update({ status: "ended" }).eq("id", st.sessionId).select();
    const { data: after } = await service.from("quiz_sessions").select("status").eq("id", st.sessionId).single();
    expect("anon NIE zmieni quiz_sessions bezpośrednio", after.status !== "ended", error ? "(odmowa)" : `status=${after.status}`);
  }
  // 6) anon NIE wywoła update_quiz_session_admin (grant tylko authenticated)
  {
    const { error } = await anon.rpc("update_quiz_session_admin", { p_session_id: st.sessionId, p_data: { status: "ended" } });
    const { data: after } = await service.from("quiz_sessions").select("status").eq("id", st.sessionId).single();
    expect("anon NIE wywoła update_quiz_session_admin", after.status !== "ended", error ? "(odmowa)" : `status=${after.status}`);
  }
  // 7) sekcja 29: anon NIE wstawia answers bezpośrednio (forge is_correct niemożliwy)
  {
    const row = { session_id: st.sessionId, participant_code: st.code, participant_name: "Rls Check",
      city: CITY, question_id: st.qId2, module: 1, chosen: 0, is_correct: true, points: 999, response_time_s: 0 };
    const { error } = await anon.from("answers").insert(row);
    expect("anon NIE wstawia answers bezpośrednio", !!error, error ? "(odmowa)" : "WSTAWIONO — sekcja 29 nie wgrana!");
  }
  // 8) anon MOŻE czytać quiz_sessions; questions już TYLKO przez RPC (nie bezpośrednio)
  {
    const { data: s } = await anon.from("quiz_sessions").select("status").eq("id", st.sessionId);
    const { data: qd, error: qe } = await anon.from("questions").select("ans").eq("id", st.qId2);
    expect("anon czyta quiz_sessions", s?.length === 1);
    expect("anon NIE czyta questions bezpośrednio", (!qd || qd.length === 0) || !!qe, qe ? "(odmowa)" : `zwrócono ${qd?.length ?? 0}`);
  }

  // ── HARDENING sekcja 27: anon NIE enumeruje kodów/nazwisk ──
  // 9) anon NIE czyta tabeli participant_codes (REVOKE SELECT + polityka authenticated)
  {
    const { data, error } = await anon.from("participant_codes").select("*").eq("city", CITY);
    expect("anon NIE czyta participant_codes", (!data || data.length === 0) || !!error,
      error ? "(zablokowane)" : `zwrócono ${data?.length ?? 0} — uruchom sekcję 27`);
  }
  // 10) validate_participant_code zwraca TYLKO wpisany wiersz (nie całą tabelę)
  {
    const { data, error } = await anon.rpc("validate_participant_code", { p_code: st.code });
    const rows = Array.isArray(data) ? data : (data ? [data] : []);
    expect("validate_participant_code zwraca własny kod", !error && rows.length === 1 && rows[0].code === st.code,
      error ? error.message : `wierszy=${rows.length}`);
    const { data: none } = await anon.rpc("validate_participant_code", { p_code: "NIEISTNIEJE-0000" });
    const noneRows = Array.isArray(none) ? none : (none ? [none] : []);
    expect("validate_participant_code nie zwraca nieznanego", noneRows.length === 0, `wierszy=${noneRows.length}`);
  }
  // 11) count_participants_in_session zwraca tylko LICZBĘ (Live View X/N)
  {
    const { data, error } = await anon.rpc("count_participants_in_session", { p_city: CITY, p_session_id: st.sessionId });
    expect("count_participants_in_session zwraca liczbę", !error && typeof data === "number" && data >= 1,
      error ? error.message : `count=${data}`);
  }
  // 12) code_exists: true dla znanego, false dla nieznanego (helper polityki INSERT)
  {
    const { data: yes } = await anon.rpc("code_exists", { p_code: st.code });
    const { data: no }  = await anon.rpc("code_exists", { p_code: "NIEISTNIEJE-0000" });
    expect("code_exists rozróżnia znany/nieznany kod", yes === true && no === false, `znany=${yes} nieznany=${no}`);
  }

  // ── SEKCJA 29: walidacja serwerowa + ukrycie poprawnej odpowiedzi ──
  // 13) get_quiz_questions: anon dostaje pytanie konkursowe, ale ans = NULL (M-2)
  {
    const { data, error } = await anon.rpc("get_quiz_questions", { p_city: CITY });
    const row = (data || []).find((q) => q.id === st.qId2);
    expect("get_quiz_questions zwraca pytania konkursowe", !error && !!row, error ? error.message : `znaleziono=${!!row}`);
    expect("anon NIE dostaje ans (ukryte)", row ? row.ans === null : false, `ans=${row?.ans}`);
  }
  // 14) submit_answer liczy is_correct SERWEROWO — nie da się sfałszować poprawności
  {
    // zła odpowiedź (chosen=1, poprawna=0) → serwer MUSI zwrócić is_correct=false
    const { data, error } = await anon.rpc("submit_answer", {
      p_session_id: st.sessionId, p_code: st.code, p_name: "Rls Check", p_question_id: st.qId2, p_chosen: 1,
    });
    expect("submit_answer: zła odp. → is_correct=false (serwer)", !error && data?.is_correct === false, error ? error.message : JSON.stringify(data));
    // potwierdź w bazie, że wiersz NIE jest 'poprawny' (mimo prób forge'a w teście 7)
    const { data: dbRow } = await service.from("answers").select("is_correct").eq("session_id", st.sessionId).eq("participant_code", st.code).eq("question_id", st.qId2).maybeSingle();
    expect("w bazie is_correct=false (brak forge)", dbRow?.is_correct === false, `is_correct=${dbRow?.is_correct}`);
  }
}

async function cleanup() {
  try { await service.from("answers").delete().eq("session_id", st.sessionId); } catch (_) {}
  try { await service.from("participant_codes").delete().eq("id", st.codeId); } catch (_) {}
  try { await service.from("questions").delete().eq("id", st.qId); } catch (_) {}
  try { if (st.qId2) await service.from("questions").delete().eq("id", st.qId2); } catch (_) {}
  try { await service.from("quiz_sessions").delete().eq("id", st.sessionId); } catch (_) {}
}

async function main() {
  console.log("\n🔐 RLS / RPC SECURITY CHECK\n");
  try {
    await setup();
    await checks();
  } finally {
    await cleanup();
  }
  const total = passed + failed;
  console.log(`\n${"─".repeat(56)}`);
  console.log(failed === 0 ? `✅ WSZYSTKIE GRANICE OK (${total}/${total})` : `❌ ${failed}/${total} NARUSZEŃ — sprawdź sekcje SQL 16–27`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error("💥 FATAL:", e.message); cleanup().finally(() => process.exit(1)); });
