// Zasiewa STAGING przed testami E2E: pytania, kod uczestnika i DZIAŁAJĄCĄ sesję
// dla miasta testowego. Dzięki temu test sprawdza realny render klienta
// (uczestnik + LiveView) bez sterowania UI admina. Stan zapisuje do pliku,
// global-teardown go sprząta. Działa wyłącznie na stagingu (klucze *_STAGE).
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import { loadEnv } from "./load-env.js";
import { CITY, CODE, Q_PREFIX, OPTS } from "./fixtures.js";

export default async function globalSetup() {
  const env = loadEnv();
  const URL = env.VITE_SUPABASE_URL_STAGE;
  const SERVICE = env.SUPABASE_SERVICE_KEY_STAGE;
  if (!URL || !SERVICE) throw new Error("Brak kluczy *_STAGE w .env — E2E działa na stagingu.");

  const supa = createClient(URL, SERVICE, { auth: { persistSession: false } });

  // Czysty start: zakończ stare sesje miasta i WYCZYŚĆ wszystkie realne pytania
  // miasta testowego (staging bywa zaśmiecony resztkami po przerwanych biegach bota,
  // przez co "pierwsze pytanie" było nie nasze). Najpierw kasujemy ich odpowiedzi (FK).
  await supa.from("quiz_sessions").update({ status: "ended" }).eq("city", CITY).neq("status", "ended");
  await supa.from("answers").delete().eq("participant_code", CODE);
  const { data: stale } = await supa.from("questions").select("id").eq("city", CITY).eq("is_practice", false);
  const staleIds = (stale || []).map((q) => q.id);
  if (staleIds.length) {
    await supa.from("answers").delete().in("question_id", staleIds);
    await supa.from("questions").delete().in("id", staleIds);
  }
  await supa.from("participant_codes").delete().eq("code", CODE);

  // Pytania (moduł 1) — moduły sieje seed-admin; tu tylko pytania.
  const qRows = [1, 2, 3].map((i) => ({
    city: CITY, module: 1, q: `${Q_PREFIX} ${i}`,
    opts: OPTS, ans: 0, is_practice: false, sort_order: i,
  }));
  const { data: qs, error: qErr } = await supa.from("questions").insert(qRows).select("id");
  if (qErr) throw new Error("seed questions: " + qErr.message);

  // Kod uczestnika (used=false → świeże dołączenie).
  await supa.from("participant_codes").insert({ code: CODE, name: "E2E", surname: "Tester", city: CITY });

  // Działająca sesja: q_started_at 1 s w przeszłości → uczestnik wchodzi prosto w
  // pytanie (bez odliczania), pełny czas modułu na asercję.
  const startedAt = new Date(Date.now() - 1000).toISOString();
  const { data: sess, error: sErr } = await supa.from("quiz_sessions")
    .insert({ city: CITY, status: "running", is_practice: false, current_question_idx: 0, q_started_at: startedAt })
    .select().single();
  if (sErr) throw new Error("seed session: " + sErr.message);

  fs.writeFileSync("e2e/.e2e-state.json", JSON.stringify({
    url: URL, service: SERVICE, sessionId: sess.id, qIds: qs.map((q) => q.id), code: CODE, city: CITY,
  }));
  console.log(`\n[E2E setup] staging zasiany: sesja ${sess.id}, ${qs.length} pytań, kod ${CODE}\n`);
}
