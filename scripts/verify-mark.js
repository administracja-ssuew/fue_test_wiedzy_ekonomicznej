/**
 * FUE Quiz — behawioralna weryfikacja sekcji 24 (mark_code_used re-join)
 *
 * Sprawdza, czy mark_code_used aktualizuje session_id przy PONOWNYM dołączeniu
 * (sekcja 24 = bez warunku "used=false"). Tworzy tymczasowy kod, woła RPC dwa
 * razy (jak uczestnik), czyta wynik i sprząta. Domyślnie PRODUKCJA.
 *
 *   npm run verify-mark           # produkcja
 *   VERIFY_STAGE=1 npm run verify-mark   # staging
 */

import { createClient } from "@supabase/supabase-js";

const STAGE   = process.env.VERIFY_STAGE === "1";
const URL     = STAGE ? process.env.VITE_SUPABASE_URL_STAGE      : process.env.VITE_SUPABASE_URL;
const ANON    = STAGE ? process.env.VITE_SUPABASE_ANON_KEY_STAGE : process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = STAGE ? process.env.SUPABASE_SERVICE_KEY_STAGE   : process.env.SUPABASE_SERVICE_KEY;
if (!URL || !ANON || !SERVICE) { console.error("❌ Brak kluczy w .env dla wybranego celu."); process.exit(1); }

const svc  = createClient(URL, SERVICE, { auth: { persistSession: false } });
const anon = createClient(URL, ANON,    { auth: { persistSession: false } });

const CODE = `VERIFY-${Date.now() % 100000}`;
const SESS_A = "11111111-1111-1111-1111-111111111111";
const SESS_B = "22222222-2222-2222-2222-222222222222";

async function main() {
  console.log(`\n🌐 Cel: ${URL}  ${STAGE ? "(STAGING)" : "(PRODUKCJA)"}`);
  console.log(`🔎 Sekcja 24 — czy mark_code_used aktualizuje session_id przy re-join?\n`);

  const { error: insErr } = await svc.from("participant_codes")
    .insert({ code: CODE, name: "Verify", surname: "Mark", city: "Kraków" });
  if (insErr) { console.error("❌ Nie udało się utworzyć kodu testowego:", insErr.message); process.exit(1); }

  let verdict = 1;
  try {
    // 1. pierwsze dołączenie → sesja A
    await anon.rpc("mark_code_used", { p_code: CODE, p_session_id: SESS_A });
    // 2. ponowne dołączenie (nowa sesja po resecie) → powinno nadpisać na B
    await anon.rpc("mark_code_used", { p_code: CODE, p_session_id: SESS_B });

    const { data } = await svc.from("participant_codes").select("session_id, used").eq("code", CODE).single();
    if (data?.session_id === SESS_B) {
      console.log("  ✅ session_id zaktualizowany na nową sesję — SEKCJA 24 WGRANA.");
      console.log("     Re-join po resecie działa; licznik uczestników nie zatnie się na '1/0'.");
      verdict = 0;
    } else if (data?.session_id === SESS_A) {
      console.log("  ❌ session_id został na pierwszej sesji — STARA wersja funkcji.");
      console.log("     → Uruchom SUPABASE_FIXES.sql sekcję 24 na tej bazie.");
    } else {
      console.log(`  ⚠️ Nieoczekiwany session_id: ${data?.session_id} (used=${data?.used}).`);
    }
  } finally {
    await svc.from("participant_codes").delete().eq("code", CODE);
    console.log("\n🧹 Kod testowy usunięty.");
  }
  process.exit(verdict);
}

main().catch((e) => { console.error("💥 FATAL:", e.message); process.exit(1); });
