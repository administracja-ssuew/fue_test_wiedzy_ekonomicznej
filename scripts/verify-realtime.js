/**
 * FUE Quiz — weryfikacja publikacji Realtime (sekcja 37.1)
 *
 * UWAGA — OCZEKIWANIE ZOSTAŁO ODWRÓCONE 02.09.2026.
 * Wcześniej ten skrypt sprawdzał sekcję 21, czyli że INSERT na `answers` DOCIERA
 * przez Realtime. Audyt obciążeniowy pokazał, że to był błąd projektowy: ~29 000
 * zdarzeń INSERT (58 pytań × 500 osób) szło tym samym slotem replikacji, którym
 * idą UPDATE-y `quiz_sessions` sterujące przejściem pytania — a lawina odpowiedzi
 * kumuluje się dokładnie w chwili, gdy timer dobija zera. Sekcja 37.1 usuwa
 * `answers` i `participant_codes` z publikacji.
 *
 * Skrypt sprawdza więc teraz DOKŁADNIE ODWROTNIE:
 *   • quiz_sessions UPDATE  MUSI dotrzeć  (kanał sterujący quizem — krytyczny)
 *   • answers INSERT        NIE MOŻE dotrzeć (zdjęte w 37.1)
 *
 * Licznik odpowiedzi w panelu jedzie z polla co 1 s i to jest zamierzone.
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
  console.log("🔎 Sekcja 37.1 — czy answers są ZDJĘTE z publikacji, a quiz_sessions zostały?\n");

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

  let gotAnswer = false;   // target: INSERT answers — po sekcji 37.1 MA NIE dotrzeć
  let gotControl = false;  // kontrola: UPDATE quiz_sessions — MUSI dotrzeć (kanał quizu)
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

  // Czekaj na KONTROLĘ (do 12 s); jeśli po ~4 s nic nie dotarło (cold-start), ponów zapis.
  const start = Date.now();
  let retried = false;
  while (!gotControl && Date.now() - start < 12000) {
    await sleep(150);
    if (!retried && subscribed && !gotControl && Date.now() - start > 4000) {
      retried = true;
      await fireWrites();
    }
  }
  // Brak zdarzenia to teraz WYNIK POZYTYWNY, a nieobecności nie da się stwierdzić
  // natychmiast — po dotarciu kontroli dajemy answers jeszcze 3 s. Kontrola dowodzi,
  // że kanał żyje i zdarzenia płyną, więc cisza na answers znaczy "nie ma w publikacji",
  // a nie "Realtime nie działa".
  if (gotControl) await sleep(3000);

  await supa.removeChannel(ch);
  await cleanup();

  const passed = gotControl && !gotAnswer;
  console.log("─".repeat(56));
  console.log(`  quiz_sessions UPDATE (ma dotrzeć):  ${gotControl ? "✅ dotarła" : "❌ brak"}`);
  console.log(`  answers INSERT (ma NIE dotrzeć):    ${gotAnswer ? "❌ dotarł" : "✅ cisza"}`);
  console.log("─".repeat(56));
  if (!subscribed)      console.log("⚠️ Kanał nie wszedł w SUBSCRIBED — Realtime niedostępny dla tego klienta.");
  else if (!gotControl) console.log("⚠️ Kontrola nie dotarła — to mechanizm (service-key Realtime), nie publikacja.\n   Bez działającej kontroli cisza na answers niczego nie dowodzi.");
  else if (gotAnswer)   console.log("❌ answers WCIĄŻ w publikacji → uruchom sekcję 37.1.\n   Lawina ~29 000 INSERT-ów będzie blokować kanał sterujący quizem.");
  else                  console.log("✅ SEKCJA 37.1 WGRANA — kanał quizu czysty, answers poza publikacją.");
  process.exit(passed ? 0 : 1);
}

async function cleanup() {
  try { await supa.from("answers").delete().eq("session_id", st.sessionId); } catch {}
  try { await supa.from("questions").delete().eq("id", st.qId); } catch {}
  try { await supa.from("quiz_sessions").delete().eq("id", st.sessionId); } catch {}
}

main().catch((e) => { console.error("💥 FATAL:", e.message); cleanup().finally(() => process.exit(1)); });
