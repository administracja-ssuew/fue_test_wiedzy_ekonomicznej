/**
 * FUE Quiz — weryfikacja sekcji 21 (Realtime na tabeli answers = instant push)
 *
 * Subskrybuje INSERT na answers, wstawia odpowiedź i sprawdza, czy event Realtime
 * dochodzi — to wprost testuje, czy tabela jest w publikacji supabase_realtime.
 * Klient service_role omija RLS, więc mierzymy czyste członkostwo w publikacji.
 * Tworzy tymczasową sesję/pytanie/odpowiedź i sprząta. Domyślnie PRODUKCJA.
 *
 *   npm run verify-realtime              # produkcja
 *   VERIFY_STAGE=1 npm run verify-realtime   # staging
 */

import { createClient } from "@supabase/supabase-js";

const STAGE   = process.env.VERIFY_STAGE === "1";
const URL     = STAGE ? process.env.VITE_SUPABASE_URL_STAGE    : process.env.VITE_SUPABASE_URL;
const SERVICE = STAGE ? process.env.SUPABASE_SERVICE_KEY_STAGE : process.env.SUPABASE_SERVICE_KEY;
if (!URL || !SERVICE) { console.error("❌ Brak kluczy w .env dla wybranego celu."); process.exit(1); }

const supa = createClient(URL, SERVICE, { auth: { persistSession: false } });
supa.realtime.setAuth(SERVICE); // socket jako service_role → omija RLS, testuje samą publikację
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const st = { sessionId: null, qId: null };

async function main() {
  console.log(`\n🌐 Cel: ${URL}  ${STAGE ? "(STAGING)" : "(PRODUKCJA)"}`);
  console.log("🔎 Sekcja 21 — czy INSERT na answers dociera przez Realtime?\n");

  const { data: sess, error: sErr } = await supa.from("quiz_sessions")
    .insert({ city: "Kraków", status: "running", is_practice: true, current_question_idx: 0, q_started_at: new Date().toISOString() })
    .select().single();
  if (sErr) { console.error("❌ sesja:", sErr.message); process.exit(1); }
  st.sessionId = sess.id;
  const { data: q, error: qErr } = await supa.from("questions")
    .insert({ city: "Kraków", module: 1, q: "[RT] probe", opts: ["A", "B", "C", "D"], ans: 0, is_practice: true, sort_order: 0 })
    .select().single();
  if (qErr) { console.error("❌ pytanie:", qErr.message); await cleanup(); process.exit(1); }
  st.qId = q.id;

  let gotAnswer = false;   // target: INSERT answers (sekcja 21)
  let gotControl = false;  // kontrola: UPDATE quiz_sessions (na pewno w publikacji)
  let subscribed = false;
  let nonce = 0;
  const fireWrites = async () => {
    // kontrola: UPDATE sesji + target: INSERT odpowiedzi (unikalny kod na próbę)
    await supa.from("quiz_sessions").update({ current_question_idx: ++nonce }).eq("id", sess.id);
    await supa.from("answers").insert({
      session_id: sess.id, participant_code: `RT-PROBE-${nonce}`, participant_name: "RT",
      city: "Kraków", question_id: q.id, module: 1, chosen: 0, is_correct: true, points: 500, response_time_s: 1,
    });
  };
  const ch = supa.channel(`rt-probe-${sess.id}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "answers", filter: `session_id=eq.${sess.id}` },
      () => { gotAnswer = true; })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "quiz_sessions", filter: `id=eq.${sess.id}` },
      () => { gotControl = true; })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED" && !subscribed) {
        subscribed = true;
        await sleep(1200);     // bufor na "ciepły" binding replikacji (cold-start)
        await fireWrites();
      }
    });

  // Czekaj do 12 s; jeśli po ~4 s nic nie dotarło (cold-start), ponów zapis raz.
  const start = Date.now();
  let retried = false;
  while (!(gotAnswer && gotControl) && Date.now() - start < 12000) {
    await sleep(150);
    if (!retried && subscribed && !gotControl && !gotAnswer && Date.now() - start > 4000) {
      retried = true;
      await fireWrites();
    }
  }

  await supa.removeChannel(ch);
  await cleanup();

  console.log("─".repeat(56));
  console.log(`  kontrola (quiz_sessions UPDATE): ${gotControl ? "✅ dotarła" : "❌ brak"}`);
  console.log(`  target   (answers INSERT):       ${gotAnswer ? "✅ dotarł" : "❌ brak"}`);
  console.log("─".repeat(56));
  if (!subscribed)        console.log("⚠️ Kanał nie wszedł w SUBSCRIBED — Realtime niedostępny dla tego klienta.");
  else if (!gotControl)   console.log("⚠️ Nawet kontrola nie dotarła — to mechanizm (service-key Realtime), nie sekcja 21.");
  else if (gotAnswer)     console.log("✅ SEKCJA 21 WGRANA — instant push odpowiedzi działa.");
  else                    console.log("❌ Kontrola OK, ale answers NIE — tabela answers NIE jest w publikacji → uruchom sekcję 21.");
  process.exit(gotAnswer && gotControl ? 0 : 1);
}

async function cleanup() {
  try { await supa.from("answers").delete().eq("session_id", st.sessionId); } catch {}
  try { await supa.from("questions").delete().eq("id", st.qId); } catch {}
  try { await supa.from("quiz_sessions").delete().eq("id", st.sessionId); } catch {}
}

main().catch((e) => { console.error("💥 FATAL:", e.message); cleanup().finally(() => process.exit(1)); });
