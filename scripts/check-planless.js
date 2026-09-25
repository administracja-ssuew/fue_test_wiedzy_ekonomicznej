/**
 * FUE Quiz — kontrola sesji BEZ PLANU na PRODUKCJI (read-only)
 *
 * Szuka sesji w statusie running/paused, które nie mają zamrożonego planu
 * (plan_anchor_at IS NULL). Takie sesje zostały uruchomione starą maszyną
 * stanów (stary `start_quiz_session` ze starego panelu admina).
 *
 * Dlaczego to ważne:
 *  - nowy klient NIE odtwarza starej maszyny stanów — dla sesji bez planu
 *    pokazuje ekran „legacy”, więc uczestnicy takiej sesji nie zagrają;
 *  - stara, nieprzeładowana karta panelu admina może uruchomić sesję bez planu
 *    aż do wgrania sekcji 41 (plan 06-10), która blokuje stary `start_quiz_session`.
 * Dlatego kontrola jest wykonywana przed wdrożeniem nowego frontu, po wdrożeniu
 * i po sondach.
 *
 * WYŁĄCZNIE produkcja: VITE_SUPABASE_URL + SUPABASE_SERVICE_KEY (celowo bez
 * fallbacku na zmienne *_STAGE). Tylko SELECT — niczego nie zapisuje.
 *
 *   npx vite-node scripts/check-planless.js
 *
 * Kody wyjścia: 0 = brak sesji bez planu, 1 = są sesje bez planu (lista wyżej),
 *               2 = brak kluczy / błąd zapytania.
 */

import { createClient } from "@supabase/supabase-js";

const URL = process.env.VITE_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!URL || !SERVICE) {
  console.error("❌ Brak VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY w .env (produkcja)");
  process.exit(2);
}

const svc = createClient(URL, SERVICE, { auth: { persistSession: false } });

async function main() {
  console.log(`\n🌐 PRODUKCJA: ${URL}\n`);
  const { data, error } = await svc
    .from("quiz_sessions")
    .select("id, city, status, name, is_practice, created_at")
    .in("status", ["running", "paused"])
    .is("plan_anchor_at", null);

  if (error) {
    console.error(`❌ Błąd zapytania: ${error.message}`);
    return 2;
  }

  if (data && data.length > 0) {
    console.log(`❌ Sesje running/paused BEZ PLANU (${data.length}):`);
    for (const s of data) {
      console.log(
        `  - ${s.id}  ${s.city}  status=${s.status}  practice=${s.is_practice}  ` +
        `nazwa=${s.name ?? "—"}  utworzona=${s.created_at}`
      );
    }
    console.log("\n  → Zakończ te sesje w obecnym panelu admina („Zakończ”) i uruchom kontrolę ponownie.");
    return 1;
  }

  console.log("✅ brak sesji running/paused bez planu");
  return 0;
}

// process.exitCode zamiast process.exit(): na Windows process.exit() przy
// zamykanych uchwytach fetch/undici kończy się asercją libuv (kod 127).
main()
  .then((code) => { process.exitCode = code; })
  .catch((e) => {
    console.error(`❌ ${e?.message || e}`);
    process.exitCode = 2;
  });
