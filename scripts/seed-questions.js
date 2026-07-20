/**
 * FUE Quiz — Seed przykładowych pytań (do testów end-to-end)
 *
 * Wgrywa 32 pytania konkursowe (moduły 1–4 z src/data/questions.js) + mały zestaw
 * próbny (po 1 z każdego modułu, is_practice=true) do wybranego miasta lub wszystkich.
 * To DANE TESTOWE — realne banki pytań każde miasto wprowadza przez panel admina.
 *
 *   npm run seed-questions                       → dry-run, wszystkie miasta
 *   npm run seed-questions -- --city Kraków       → dry-run, jedno miasto
 *   npm run seed-questions -- --city Kraków --yes  → zapis dla Krakowa
 *   npm run seed-questions -- --yes                → zapis dla wszystkich 5 miast
 *   (dodaj --force, aby dosypać mimo istniejących pytań — inaczej miasto jest pomijane)
 *
 * Celuje w projekt z VITE_SUPABASE_URL. Idempotentny: bez --force pomija miasto,
 * które już ma pytania konkursowe (żeby nie dublować).
 */

import { createClient } from "@supabase/supabase-js";
import { QUESTIONS, MODULES, CITIES } from "../src/data/questions.js";

const URL     = process.env.VITE_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
const args    = process.argv.slice(2);
const CONFIRM = args.includes("--yes");
const FORCE   = args.includes("--force");
const cityArg = (() => { const i = args.indexOf("--city"); return i >= 0 ? args[i + 1] : null; })();

if (!URL || !SERVICE) { console.error("❌ Brak VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY w .env."); process.exit(1); }

const CITY_NAMES = CITIES.map((c) => c.name);
if (cityArg && !CITY_NAMES.includes(cityArg)) {
  console.error(`❌ Nieznane miasto '${cityArg}'. Dozwolone: ${CITY_NAMES.join(", ")}`);
  process.exit(1);
}
const targets = cityArg ? [cityArg] : CITY_NAMES;

// Zbuduj wiersze pytań dla miasta: sort_order liczony w obrębie modułu.
function rowsFor(city) {
  const perModule = {};
  const main = QUESTIONS.map((q) => {
    perModule[q.module] = (perModule[q.module] ?? 0);
    const sort_order = perModule[q.module]++;
    return { city, module: q.module, q: q.q, opts: q.opts, ans: q.ans, exp: q.exp || null, is_practice: false, sort_order };
  });
  // Zestaw próbny: pierwsze pytanie z każdego modułu.
  const practice = MODULES.map((m) => QUESTIONS.find((q) => q.module === m.id))
    .filter(Boolean)
    .map((q, i) => ({ city, module: q.module, q: q.q, opts: q.opts, ans: q.ans, exp: q.exp || null, is_practice: true, sort_order: i }));
  return { main, practice };
}

const supa = createClient(URL, SERVICE, { auth: { persistSession: false } });

async function main() {
  console.log(`🌐 Cel: ${URL}`);
  console.log(`🏙️  Miasta: ${targets.join(", ")}`);
  console.log(`📦 Na miasto: ${QUESTIONS.length} konkursowych + ${MODULES.filter((m) => QUESTIONS.some((q) => q.module === m.id)).length} próbnych`);

  if (!CONFIRM) {
    console.log("\n🔍 DRY-RUN — nic nie zapisano. Dodaj --yes, aby zapisać.");
    return;
  }

  let totalMain = 0, totalPractice = 0, skipped = 0;
  for (const city of targets) {
    const { count } = await supa.from("questions")
      .select("id", { count: "exact", head: true })
      .eq("city", city).eq("is_practice", false);

    if (count > 0 && !FORCE) {
      console.log(`⏭️  ${city}: już ma ${count} pytań konkursowych — pomijam (użyj --force, by dosypać).`);
      skipped++;
      continue;
    }

    const { main, practice } = rowsFor(city);
    const { error: e1 } = await supa.from("questions").insert(main);
    if (e1) { console.error(`❌ ${city} (konkursowe): ${e1.message}`); process.exit(1); }
    const { error: e2 } = await supa.from("questions").insert(practice);
    if (e2) { console.error(`❌ ${city} (próbne): ${e2.message}`); process.exit(1); }

    totalMain += main.length; totalPractice += practice.length;
    console.log(`✅ ${city}: +${main.length} konkursowych, +${practice.length} próbnych`);
  }

  console.log(`\n🎉 Gotowe. Konkursowych: ${totalMain}, próbnych: ${totalPractice}, pominiętych miast: ${skipped}.`);
}

main().catch((e) => { console.error("💥 FATAL:", e.message); process.exit(1); });
