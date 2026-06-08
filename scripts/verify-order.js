/**
 * Regresja bugu „0/2" (Poznań): przy zdublowanym sort_order kolejność pytań
 * MUSI być deterministyczna (ORDER BY module, sort_order, id), inaczej admin
 * liczy odpowiedzi dla innego pytania niż uczestnicy.
 *   vite-node scripts/verify-order.js   (staging)
 */
import { createClient } from "@supabase/supabase-js";

const URL = process.env.VITE_SUPABASE_URL_STAGE || process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY_STAGE || process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_KEY_STAGE || process.env.SUPABASE_SERVICE_KEY;
console.log(`🌐 ${URL}  ${process.env.VITE_SUPABASE_URL_STAGE ? "(STAGING)" : "(PROD!)"}`);
const svc = createClient(URL, SERVICE, { auth: { persistSession: false } });
const anon = createClient(URL, ANON, { auth: { persistSession: false } });
const CITY = "Poznań";

const ids = [];
async function main() {
  // 3 pytania w module 1 z TYM SAMYM sort_order = 0 (wymuszony remis)
  for (let i = 0; i < 3; i++) {
    const { data } = await svc.from("questions")
      .insert({ city: CITY, module: 1, q: `[ORDER] ${i}`, opts: ["A","B","C","D"], ans: 0, is_practice: false, sort_order: 0 })
      .select().single();
    ids.push(data.id);
  }
  // pobierz przez RPC 6× — kolejność remisowych pytań musi być IDENTYCZNA za każdym razem
  const orders = [];
  for (let k = 0; k < 6; k++) {
    const { data } = await anon.rpc("get_quiz_questions", { p_city: CITY });
    orders.push((data || []).filter((r) => ids.includes(r.id)).map((r) => r.id).join(","));
  }
  const allSame = orders.every((o) => o === orders[0]);
  console.log(`\n  Kolejność remisowych pytań w 6 odczytach:`);
  orders.forEach((o, i) => console.log(`    #${i + 1}: ${o.slice(0, 30)}…`));
  console.log(allSame
    ? `\n✅ DETERMINISTYCZNA — ten sam porządek za każdym razem (bug 0/2 naprawiony).`
    : `\n❌ NIEDETERMINISTYCZNA — kolejność się zmienia! (uruchom sekcję 29 z ORDER BY ... id)`);
  process.exitCode = allSame ? 0 : 1;
}
main().finally(async () => {
  for (const id of ids) { try { await svc.from("questions").delete().eq("id", id); } catch (_) {} }
  console.log("🧹 posprzątano");
});
