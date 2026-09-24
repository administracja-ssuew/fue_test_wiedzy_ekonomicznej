/**
 * FUE Quiz — SONDA ROZGRYWKI (end-to-end, prawdziwe przeglądarki)
 *
 * Uruchamia realną rozgrywkę: panel admina + N telefonów w osobnych kontekstach
 * przeglądarki, próbkuje ich ekrany co 250 ms i sprawdza, czy quiz jest PŁYNNY:
 *   • czy pytanie trwa tyle, ile ma trwać (czas modułu + okno odsłonięcia),
 *   • czy host widzi to samo pytanie co telefony,
 *   • czy telefony są ze sobą zsynchronizowane co do sekundy,
 *   • czy quiz nigdzie nie staje,
 *   • czy socket Realtime uczestnika ŻYJE przez cały przebieg.
 *
 * Ten ostatni punkt jest powodem, dla którego sonda w ogóle powstała. 23.09.2026
 * socket uczestnika umierał 0,9 s po starcie quizu i nigdy nie wracał — telefon
 * żył z polla co 10 s, zastygał na skończonym pytaniu i wskakiwał w kolejne
 * w locie. Żadna analiza kodu tego nie pokazała; pokazało dopiero podsłuchanie
 * ramek WebSocket. Dlatego sonda ich pilnuje na stałe.
 *
 * WYMAGA URUCHOMIONEJ APLIKACJI:
 *   npm run build && npm run preview          (w osobnym terminalu)
 *   $env:PROBE_CONFIRM=1; npm run sonda
 *
 * CEL: preferuje STAGING (klucze *_STAGE). Bez nich uderza w PRODUKCJĘ i wtedy
 * wymaga PROBE_CONFIRM=1. Zakłada własne pytania i kody, a po przebiegu kasuje
 * wszystko, co utworzyła, i przywraca sesję miasta do stanu sprzed testu.
 *
 * Zmienne:
 *   PROBE_APP_URL=http://localhost:4173   adres działającej aplikacji
 *   PROBE_CITY=Kraków                     miasto testowe (musi być z listy CITIES)
 *   PROBE_PHONES=2                        ile telefonów
 *   PROBE_QUESTIONS=3                     ile pytań zasiać
 *   PROBE_RUN_MS=150000                   maksymalny czas przebiegu
 */

import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// PROBE_TARGET=stage|prod. Domyślnie staging, jeśli klucze *_STAGE są w .env.
// Jawny wybór jest potrzebny, bo staging bywa wyłączony, a wtedy „preferuj staging"
// kieruje sondę pod martwy adres.
const wantStage = process.env.PROBE_TARGET
  ? process.env.PROBE_TARGET === "stage"
  : !!process.env.VITE_SUPABASE_URL_STAGE;
const STAGE = wantStage && !!process.env.VITE_SUPABASE_URL_STAGE;
const URL_SB = STAGE ? process.env.VITE_SUPABASE_URL_STAGE : process.env.VITE_SUPABASE_URL;
const ANON = STAGE ? process.env.VITE_SUPABASE_ANON_KEY_STAGE : process.env.VITE_SUPABASE_ANON_KEY;
const SVC = STAGE ? process.env.SUPABASE_SERVICE_KEY_STAGE : process.env.SUPABASE_SERVICE_KEY;

const APP = process.env.PROBE_APP_URL || "http://localhost:4173";
const CITY = process.env.PROBE_CITY || "Kraków";
const PHONES = Math.max(1, parseInt(process.env.PROBE_PHONES || "2", 10));
// PROBE_FULL=1 — pełna ścieżka wydarzenia: wszystkie 5 modułów, zapowiedzi modułów,
// pauza i wznowienie, ogłoszenie wyników, ekran końcowy. Domyślnie sonda robi szybki
// przebieg na jednym module (sensowny jako bramka przed każdym deployem).
const FULL = process.env.PROBE_FULL === "1";
const QPM = Math.max(1, parseInt(process.env.PROBE_QPM || "2", 10));   // pytań na moduł (full)
const NQ = FULL ? QPM * 5 : Math.max(1, parseInt(process.env.PROBE_QUESTIONS || "3", 10));
const TPQ_OVERRIDE = parseInt(process.env.PROBE_TPQ || "20", 10);      // czas modułu na czas testu
const RUN_MS = parseInt(process.env.PROBE_RUN_MS || (FULL ? "540000" : "150000"), 10);
const TAG = "[SONDA]";

if (!URL_SB || !ANON || !SVC) {
  console.error("❌ Brak kluczy Supabase w .env (URL / ANON / SERVICE).");
  process.exit(1);
}
if (!STAGE && process.env.PROBE_CONFIRM !== "1") {
  console.error("⛔ Brak kluczy *_STAGE — sonda uderzyłaby w PRODUKCJĘ.");
  console.error(`   Cel: ${URL_SB}`);
  console.error("   Sonda zakłada i kasuje własne pytania, kody i konto admina,");
  console.error("   a sesję miasta przywraca do stanu sprzed testu — ale to wciąż produkcja.");
  console.error("   Świadomie? Ustaw PROBE_CONFIRM=1.");
  process.exit(1);
}

const svc = createClient(URL_SB, SVC, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const projectRef = new global.URL(URL_SB).hostname.split(".")[0];

const state = { adminId: null, adminEmail: null, adminPass: null, qIds: [], codes: [], sessionId: null, sessionBefore: null, modulesBefore: [] };
const wsLog = [];
const wsFrames = { n: 0 };
const consoleLog = [];

// ─── SETUP ───────────────────────────────────────────────────────────────────
async function preflight() {
  // Czy cel w ogóle odpowiada? Bez tego dostajemy gołe "fetch failed" w środku setupu.
  try {
    const r = await fetch(`${URL_SB}/auth/v1/health`, { headers: { apikey: ANON } });
    if (!r.ok && r.status >= 500) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    console.error(`\n❌ Cel nie odpowiada: ${URL_SB}`);
    console.error(`   ${e.cause?.code === "ENOTFOUND" ? "Host nie istnieje (projekt usunięty lub uśpiony?)" : e.message}`);
    if (STAGE) console.error("   Staging nieczynny → uruchom z PROBE_TARGET=prod (świadomie, na produkcję).");
    process.exit(1);
  }
}

async function setup() {
  console.log(`\n🌐 Cel: ${URL_SB}  ${STAGE ? "(STAGING ✓)" : "⚠️  (PRODUKCJA)"}`);
  console.log(`🖥️  Aplikacja: ${APP}`);
  console.log(`👥 Telefony: ${PHONES}  ·  Pytania: ${NQ}  ·  Miasto: ${CITY}\n`);
  console.log("SETUP");

  state.adminEmail = `probe-${Date.now()}@twe.2026.fue.pl`;
  state.adminPass = "Probe!" + Math.random().toString(36).slice(2, 10);
  const { data: u, error: ue } = await svc.auth.admin.createUser({
    email: state.adminEmail, password: state.adminPass, email_confirm: true,
  });
  if (ue) throw new Error("createUser: " + ue.message);
  state.adminId = u.user.id;
  const { error: pe } = await svc.from("profiles").insert({
    id: state.adminId, full_name: "Sonda rozgrywki", role: "city_admin", city: CITY,
  });
  if (pe) throw new Error("profile: " + pe.message);

  // W trybie pełnym rozkładamy pytania na 5 modułów — dzięki temu test przechodzi
  // przez zapowiedzi modułów i przez przerwy po module 2 i 4.
  const rows = FULL
    ? [1, 2, 3, 4, 5].flatMap((m) => Array.from({ length: QPM }, (_, i) => ({
        city: CITY, module: m, q: `${TAG} M${m} Pytanie ${i + 1}`,
        opts: ["A", "B", "C", "D"], ans: 0, is_practice: false, sort_order: i + 1,
      })))
    : Array.from({ length: NQ }, (_, i) => ({
        city: CITY, module: 1, q: `${TAG} Pytanie ${i + 1}`,
        opts: ["A", "B", "C", "D"], ans: 0, is_practice: false, sort_order: i + 1,
      }));
  const { data: qs, error: qe } = await svc.from("questions").insert(rows).select("id");
  if (qe) throw new Error("questions: " + qe.message);
  state.qIds = qs.map((q) => q.id);

  const codeRows = Array.from({ length: PHONES }, (_, i) => ({
    code: `PRB-${Date.now().toString().slice(-6)}${i}`, name: `Telefon${i + 1}`, surname: "Sonda", city: CITY,
  }));
  const { data: cs, error: ce } = await svc.from("participant_codes").insert(codeRows).select("code,name,surname,city");
  if (ce) throw new Error("codes: " + ce.message);
  state.codes = cs;

  const { data: sess } = await svc.from("quiz_sessions").select("*")
    .eq("city", CITY).eq("is_practice", false).neq("status", "ended")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!sess) throw new Error(`Brak oczekującej sesji dla miasta ${CITY} — utwórz ją w panelu.`);
  state.sessionId = sess.id;
  state.sessionBefore = { status: sess.status, current_question_idx: sess.current_question_idx, q_started_at: sess.q_started_at };
  await svc.from("quiz_sessions").update({ status: "waiting", current_question_idx: 0, q_started_at: null }).eq("id", sess.id);

  // Czasy modułów na produkcji są różne (20/30/60/75/20), a pełny przebieg z nimi
  // trwałby ~15 minut. Na czas testu ustawiamy jeden czas i PRZYWRACAMY oryginały
  // w cleanup — inaczej sonda cicho zmieniłaby konfigurację wydarzenia.
  const { data: modsBefore } = await svc.from("modules").select("id, time_per_q").order("id");
  state.modulesBefore = modsBefore || [];
  let tpq;
  if (FULL) {
    for (const m of state.modulesBefore) {
      await svc.from("modules").update({ time_per_q: TPQ_OVERRIDE }).eq("id", m.id);
    }
    tpq = TPQ_OVERRIDE;
    console.log(`  czasy modułów tymczasowo na ${TPQ_OVERRIDE}s (oryginały: ${state.modulesBefore.map((m) => m.time_per_q).join("/")})`);
  } else {
    tpq = state.modulesBefore.find((m) => m.id === 1)?.time_per_q || 60;
  }
  console.log(`  pytania: ${NQ}  kody: ${state.codes.map((c) => c.code).join(", ")}`);
  console.log(`  sesja: ${state.sessionId}  czas na pytanie: ${tpq}s\n`);
  return tpq;
}

async function cleanup() {
  console.log("\n🧹 SPRZĄTANIE");
  const codes = state.codes.map((c) => c.code);
  try { if (codes.length) await svc.from("answers").delete().in("participant_code", codes); } catch {}
  try { if (state.qIds.length) await svc.from("answers").delete().in("question_id", state.qIds); } catch {}
  try { if (state.qIds.length) await svc.from("questions").delete().in("id", state.qIds); } catch {}
  try { if (codes.length) await svc.from("participant_codes").delete().in("code", codes); } catch {}
  if (state.sessionId && state.sessionBefore) {
    try { await svc.from("quiz_sessions").update(state.sessionBefore).eq("id", state.sessionId); } catch {}
  }
  if (state.adminId) {
    try { await svc.from("profiles").delete().eq("id", state.adminId); } catch {}
    try { await svc.auth.admin.deleteUser(state.adminId); } catch {}
  }
  // Przywróć oryginalne czasy modułów — narzędzie testowe nie może zostawić po sobie
  // zmienionej konfiguracji wydarzenia.
  for (const m of state.modulesBefore || []) {
    try { await svc.from("modules").update({ time_per_q: m.time_per_q }).eq("id", m.id); } catch {}
  }
  const { data: leftQ } = await svc.from("questions").select("id").ilike("q", `%${TAG}%`);
  const { data: leftC } = codes.length ? await svc.from("participant_codes").select("code").in("code", codes) : { data: [] };
  const ok = (leftQ?.length ?? 0) === 0 && (leftC?.length ?? 0) === 0;
  console.log(`  pytania sondy: ${leftQ?.length ?? "?"}   kody sondy: ${leftC?.length ?? "?"}   ${ok ? "✅ czysto" : "⚠️ zostały resztki"}`);
}

// ─── ODCZYT EKRANU ───────────────────────────────────────────────────────────
// Uwaga na wielkość liter: panel renderuje "PYT. 1/3" wielkimi przez CSS
// text-transform, a innerText zwraca już przetransformowany tekst.
const READ = `(() => {
  const t = document.body.innerText || "";
  const out = { phase: "?", q: null, timer: null };
  const mPart  = t.match(/Pytanie (\\d+) \\/ (\\d+) · #(\\d+)\\/(\\d+)/);
  const mAdmin = t.match(/Pytanie (\\d+)\\/(\\d+)/);
  if (mPart) { out.phase = "quiz"; out.q = Number(mPart[3]); }
  else if (mAdmin) { out.phase = "host"; out.q = Number(mAdmin[1]); }
  // Uwaga: sporo napisów ma text-transform:uppercase, a innerText zwraca tekst PO
  // transformacji — stąd wszędzie /i. Na tym już raz poległ parser panelu admina.
  if (/Oczekiwanie na start|Łączenie z sesją/i.test(t)) out.phase = "lobby";
  if (/START!|Start za/i.test(t)) out.phase = "odliczanie";
  if (/Następny moduł|MODUŁ \\d+ \\//i.test(t)) out.phase = "zapowiedz";
  if (/Przerwa|Wstrzymano/i.test(t)) out.phase = "przerwa";
  if (/Koniec testu|Wszystkie pytania zosta/i.test(t)) out.phase = "czekam_wyniki";
  if (/Poczekaj na ogłoszenie organizatora|poprawnych odpowiedzi/i.test(t)) out.phase = "wynik";
  if (out.phase === "quiz") {
    const svg = document.querySelector('svg[width="54"]');
    const sp = svg && svg.parentElement ? svg.parentElement.querySelector("span") : null;
    if (sp) { const n = parseInt(sp.textContent, 10); if (Number.isFinite(n) && n <= 600) out.timer = n; }
  }
  return out;
})()`;

// ─── PRZEBIEG ────────────────────────────────────────────────────────────────
async function main() {
  await preflight();
  const tpq = await setup();
  // Bez tych flag Chromium dławi timery i sieć w kartach w tle, a wszystkie
  // konteksty poza jednym SĄ w tle — nie dałoby się odróżnić realnego opóźnienia
  // aplikacji od artefaktu pomiaru.
  const browser = await chromium.launch({
    args: [
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ],
  });
  const samples = [];
  const pages = [];
  let t0 = 0;

  try {
    const cli = createClient(URL_SB, ANON, { auth: { persistSession: false } });
    const { data: sIn, error: sErr } = await cli.auth.signInWithPassword({ email: state.adminEmail, password: state.adminPass });
    if (sErr) throw new Error("logowanie sondy: " + sErr.message);

    const ctxAdmin = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    // Pauza i ogłoszenie wyników są za confirm() — bez tego klik wisi.
    ctxAdmin.on("page", (pg) => pg.on("dialog", (d) => d.accept().catch(() => {})));
    await ctxAdmin.addInitScript(([k, v]) => localStorage.setItem(k, v),
      [`sb-${projectRef}-auth-token`, JSON.stringify(sIn.session)]);
    const admin = await ctxAdmin.newPage();
    // Kontrola zgodności celu: aplikacja ma wkompilowany URL Supabase w bundlu, więc
    // mogłaby cicho gadać z INNYM projektem niż ten, który sonda zasiewa. Wtedy wynik
    // byłby bezsensowny („nikt nie dołączył"), a przyczyna nieoczywista. Wyłapujemy to
    // z adresu socketu Realtime, który aplikacja otwiera sama.
    let appRef = null;
    admin.on("websocket", (ws) => {
      const u = ws.url();
      if (u.includes("realtime") && !appRef) appRef = new global.URL(u).hostname.split(".")[0];
    });
    await admin.goto(APP, { waitUntil: "domcontentloaded" });

    for (const c of state.codes) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      await ctx.addInitScript((p) => sessionStorage.setItem("fue_participant", p),
        JSON.stringify({ code: c.code, name: c.name, surname: c.surname, city: c.city }));
      const p = await ctx.newPage();
      // Podsłuch WebSocket na PIERWSZYM telefonie — to jedyny sposób, żeby odróżnić
      // "aplikacja nie zareagowała" od "zdarzenie w ogóle nie dotarło".
      if (pages.length === 0) { attachWs(p); attachConsole(p); }
      await p.goto(APP, { waitUntil: "domcontentloaded" });
      pages.push({ code: c.code, page: p });
    }

    await sleep(6000);
    if (appRef && appRef !== projectRef) {
      throw new Error(
        `Aplikacja pod ${APP} łączy się z projektem "${appRef}", a sonda zasiewa "${projectRef}".\n` +
        `   Przebuduj aplikację pod ten sam cel (npm run build && npm run preview) albo zmień PROBE_TARGET.`
      );
    }
    console.log("▶️  START QUIZU\n");
    await admin.getByRole("button", { name: /Start quizu/ }).click({ timeout: 20000 });

    t0 = Date.now();
    const answered = new Set();
    const flow = { paused: false, pausedAt: 0, resumed: false, pauseSeen: false, endPaused: false, endPausedAt: 0, announced: false };
    globalThis.__flow = flow;
    while (Date.now() - t0 < RUN_MS) {
      const at = Date.now() - t0;
      const [a, ...ps] = await Promise.all([
        admin.evaluate(READ).catch(() => ({ phase: "err" })),
        ...pages.map((x) => x.page.evaluate(READ).catch(() => ({ phase: "err" }))),
      ]);
      samples.push({ at, admin: a, phones: ps });

      // Telefony odpowiadają ~3 s po pojawieniu się pytania — bez tego ścieżka
      // wcześniejszego zakończenia w ogóle się nie uruchamia.
      for (let i = 0; i < pages.length; i++) {
        const st = ps[i];
        if (st?.phase !== "quiz" || st.q == null || st.timer == null) continue;
        const key = `${i}:${st.q}`;
        if (answered.has(key) || st.timer > tpq - 3) continue;
        answered.add(key);
        pages[i].page.locator("button.ans-btn").first().click({ timeout: 3000 }).catch(() => {});
      }

      // ── Sterowanie pełną ścieżką ────────────────────────────────────────────
      if (FULL) {
        const ph = ps[0]?.phase;
        // 1. Pauza w środku przebiegu — czy uczestnik realnie widzi "Wstrzymano"
        //    i czy po wznowieniu wraca na to samo pytanie.
        if (!flow.paused && ph === "quiz" && ps[0]?.q >= Math.ceil(NQ / 2)) {
          flow.paused = true; flow.pausedAt = at;
          console.log(`   ⏸  pauza (pytanie ${ps[0].q})`);
          await admin.getByRole("button", { name: /Pauza/ }).click({ timeout: 10000 }).catch((e) => console.log("   ⚠️ pauza:", e.message.slice(0, 60)));
        } else if (flow.paused && !flow.resumed && at - flow.pausedAt > 10000) {
          flow.resumed = true;
          flow.pauseSeen = samples.some((s) => s.at > flow.pausedAt && s.phones[0]?.phase === "przerwa");
          console.log(`   ▶️  wznowienie (uczestnik widział przerwę: ${flow.pauseSeen ? "TAK" : "NIE"})`);
          await admin.getByRole("button", { name: /Wznów quiz/ }).click({ timeout: 10000 }).catch((e) => console.log("   ⚠️ wznów:", e.message.slice(0, 60)));
        }
        // 2. Koniec pytań → "Ogłoś wyniki" jest dostępne DOPIERO po pauzie, bo przycisk
        //    renderuje się wyłącznie przy status === "paused". To realna pułapka dla
        //    prowadzącego: po ostatnim pytaniu sesja zostaje w "running".
        if (ph === "czekam_wyniki" && !flow.endPaused) {
          flow.endPaused = true; flow.endPausedAt = at;
          console.log("   ⏸  pauza przed ogłoszeniem wyników");
          await admin.getByRole("button", { name: /Pauza/ }).click({ timeout: 10000 }).catch(() => {});
        } else if (flow.endPaused && !flow.announced && at - flow.endPausedAt > 3000) {
          flow.announced = true;
          console.log("   🏆 ogłoszenie wyników");
          await admin.getByRole("button", { name: /Ogłoś wyniki/ }).click({ timeout: 10000 }).catch((e) => console.log("   ⚠️ ogłoszenie:", e.message.slice(0, 60)));
        }
      }

      if (ps.length && ps.every((p) => p?.phase === "wynik")) break;
      if (!FULL && ps.length && ps.every((p) => p?.phase === "czekam_wyniki")) break;
      await sleep(250);
    }
  } finally {
    try { await browser.close(); } catch {}
  }

  const failures = report(samples, tpq, t0);
  await cleanup();
  console.log(failures.length ? `\n❌ SONDA: ${failures.length} PROBLEM(ÓW)\n` : "\n✅ SONDA: rozgrywka płynna\n");
  process.exit(failures.length ? 1 : 0);
}

// Błędy z konsoli telefonu. Bez tego diagnoza kończyła się na wnioskowaniu: widać
// było ROZJAZD timerów, ale nie POWÓD (nieudane pobranie konfiguracji modułów,
// wyjątek w pętli ponowień). Te linie zamieniają domysł w dowód.
function attachConsole(page) {
  page.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    const t = m.text();
    if (/fetchModules|ModulesProvider|modules|Supabase|realtime|Failed to fetch|NetworkError/i.test(t))
      consoleLog.push({ at: Date.now(), kind: m.type(), text: t.slice(0, 160) });
  });
  page.on("pageerror", (e) => consoleLog.push({ at: Date.now(), kind: "pageerror", text: String(e?.message || e).slice(0, 160) }));
}

// Ile razy telefon WSZEDŁ w daną fazę (a nie ile próbek w niej spędził).
function countTransitions(samples, phase) {
  let n = 0, prev = null;
  for (const s of samples) {
    const p = s.phones[0]?.phase;
    if (p === phase && prev !== phase) n++;
    prev = p;
  }
  return n;
}

function attachWs(page) {
  const dec = (pl) => (typeof pl === "string" ? pl : Buffer.isBuffer(pl) ? pl.toString("utf8") : String(pl ?? ""));
  page.on("websocket", (ws) => {
    if (!ws.url().includes("realtime")) return;
    wsLog.push({ at: Date.now(), kind: "OPEN", info: "" });
    ws.on("close", () => wsLog.push({ at: Date.now(), kind: "CLOSE", info: "" }));
    ws.on("framereceived", (f) => {
      wsFrames.n++;
      const d = dec(f.payload);
      if (d.includes("quiz_event")) wsLog.push({ at: Date.now(), kind: "BROADCAST", info: "" });
      else if (d.includes('"event":"postgres_changes"')) wsLog.push({ at: Date.now(), kind: "PG_CHANGES", info: "" });
    });
  });
}

// ─── RAPORT ──────────────────────────────────────────────────────────────────
function report(samples, tpq, t0) {
  const fail = [];
  const expected = tpq + 6; // czas pytania + okno odsłonięcia odpowiedzi
  console.log("\n" + "═".repeat(60));
  console.log("📈 RAPORT SONDY");
  console.log("═".repeat(60));

  // 1. czas trwania pytań (telefon 1)
  // Pytanie bywa PRZERWANE pauzą albo zapowiedzią modułu i wraca na ten sam numer.
  // Sumujemy czas widoczności per numer pytania, zamiast liczyć każdy fragment osobno —
  // inaczej pauza generowała fałszywy alarm „pytanie trwało 0.0s".
  const byQ = new Map();
  let prevSeenQ = null, prevAt = null;
  for (const s of samples) {
    const p = s.phones[0];
    const isQ = p?.phase === "quiz" && p.q != null;
    if (isQ) {
      if (!byQ.has(p.q)) byQ.set(p.q, 0);
      if (prevSeenQ === p.q && prevAt != null) byQ.set(p.q, byQ.get(p.q) + (s.at - prevAt));
      prevSeenQ = p.q; prevAt = s.at;
    } else { prevSeenQ = null; prevAt = null; }
  }
  const seg = [...byQ.entries()].sort((a, b) => a[0] - b[0]).map(([q, ms]) => ({ q, ms }));
  console.log(`\n⏱️  Czas trwania pytań (oczekiwany ${expected}s = ${tpq}s + 6s odsłonięcia):`);
  // Ostatni odcinek pomijamy w ocenie, jeśli przebieg został ucięty limitem czasu.
  const runEnd = samples[samples.length - 1]?.at ?? 0;
  const lastPhase = samples[samples.length - 1]?.phones?.[0]?.phase;
  // Ostatni odcinek pomijamy tylko wtedy, gdy przebieg urwał się W TRAKCIE pytania.
  const truncated = lastPhase === "quiz" && runEnd >= RUN_MS - 1000;
  seg.forEach((g, i) => {
    const d = g.ms / 1000;
    const skip = i === seg.length - 1 && truncated;
    const bad = !skip && Math.abs(d - expected) > 5;
    if (bad) fail.push(`pytanie ${g.q} było widoczne ${d.toFixed(1)}s zamiast ~${expected}s`);
    console.log(`   pyt.${g.q}: ${d.toFixed(1)}s ${skip ? "(ucięte limitem czasu — pomijam)" : bad ? "❌" : "✅"}`);
  });

  // 2. host vs telefon
  let diff = 0, paired = 0, run = 0, maxRun = 0;
  for (const s of samples) {
    const aq = s.admin?.q, pq = s.phones[0]?.q;
    if (aq == null || pq == null) { run = 0; continue; }
    paired++;
    if (aq !== pq) { run += 250; maxRun = Math.max(maxRun, run); diff++; } else run = 0;
  }
  const pct = paired ? (diff / paired) * 100 : 0;
  const hostBad = maxRun > 1500;
  if (hostBad) fail.push(`host spóźniał się do ${maxRun} ms`);
  console.log(`\n🖥️  Host vs telefon: ${pct.toFixed(1)}% rozbieżnych próbek, najdłuższy ciągły rozjazd ${maxRun} ms ${hostBad ? "❌" : "✅"}`);

  // 3. telefon vs telefon
  let tmax = 0;
  for (const s of samples) {
    const ok = s.phones.filter((p) => p?.phase === "quiz" && p.timer != null);
    if (ok.length < 2) continue;
    if (new Set(ok.map((p) => p.q)).size > 1) continue;
    const ts = ok.map((p) => p.timer);
    tmax = Math.max(tmax, Math.max(...ts) - Math.min(...ts));
  }
  const phoneBad = tmax > 1;
  if (phoneBad) fail.push(`telefony rozjechane o ${tmax}s`);
  console.log(`📱 Telefon vs telefon: maks. różnica timera ${tmax}s ${phoneBad ? "❌" : "✅"}`);

  // 4. zacięcia
  // ...ale TYLKO realne. Zapowiedź modułu (30 s), odliczanie, przerwa i ekrany końcowe
  // to legalne stany, w których pytanie z definicji się nie zmienia. Poprzednia wersja
  // liczyła je jako zacięcie i krzyczała 65 s po każdej przerwie.
  const LEGIT = new Set(["zapowiedz", "odliczanie", "przerwa", "czekam_wyniki", "wynik", "lobby"]);
  let stall = 0, spanFrom = null, spanLegit = false, prevQ = null;
  for (const s of samples) {
    const p = s.phones[0];
    const isQ = p?.phase === "quiz" && p.q != null;
    if (isQ && p.q !== prevQ) { prevQ = p.q; spanFrom = s.at; spanLegit = false; continue; }
    if (isQ) { if (spanFrom != null && !spanLegit) stall = Math.max(stall, s.at - spanFrom); continue; }
    if (LEGIT.has(p?.phase)) spanLegit = true;  // przerwa w pytaniu jest uzasadniona
  }
  const stallLimit = (expected + 8) * 1000;
  const stallBad = stall > stallLimit;
  if (stallBad) fail.push(`quiz stał ${(stall / 1000).toFixed(1)}s bez zmiany pytania`);
  console.log(`🧊 Najdłuższy czas bez zmiany pytania: ${(stall / 1000).toFixed(1)}s (limit ${(stallLimit / 1000).toFixed(0)}s) ${stallBad ? "❌" : "✅"}`);

  // 5. socket Realtime — powód istnienia tej sondy
  const closes = wsLog.filter((w) => w.kind === "CLOSE").length;
  const opens = wsLog.filter((w) => w.kind === "OPEN").length;
  const events = wsLog.filter((w) => w.kind === "BROADCAST" || w.kind === "PG_CHANGES");
  const lastEvent = events.length ? ((events[events.length - 1].at - t0) / 1000).toFixed(1) : null;
  const runS = samples.length ? samples[samples.length - 1].at / 1000 : 0;
  // Porównujemy liczbę zdarzeń z liczbą PRZEJŚĆ pytania, a nie z końcem przebiegu.
  // Poprzednia wersja liczyła ciszę do końca uruchomienia i krzyczała „GŁUCHY" po
  // ostatnim pytaniu, gdzie admin świadomie już nie przesuwa — czyli fałszywie.
  // Głuchy telefon ma sygnaturę inną: przejść było więcej niż odebranych zdarzeń.
  const deaf = seg.length > 0 && events.length < seg.length;
  if (deaf) fail.push(`telefon nie odebrał zdarzeń dla wszystkich przejść (${events.length} zdarzeń / ${seg.length} pytań)`);
  if (!events.length) fail.push("telefon nie odebrał ŻADNEGO zdarzenia Realtime");
  console.log(`\n🔌 Socket Realtime telefonu 1: ${opens}× otwarcie, ${closes}× zamknięcie, ${wsFrames.n} ramek`);
  console.log(`   zdarzeń quizu: ${events.length} dla ${seg.length} pytań, ostatnie w ${lastEvent ?? "—"}s (przebieg ${runS.toFixed(1)}s) ${deaf ? "❌ GŁUCHY" : "✅"}`);

  if (consoleLog.length) {
    console.log("\n🧯 Błędy z konsoli telefonu 1 (istotne):");
    for (const c of consoleLog.slice(0, 12)) console.log(`   ${((c.at - t0) / 1000).toFixed(1)}s  [${c.kind}] ${c.text}`);
    if (consoleLog.some((c) => /fetchModules|ModulesProvider/i.test(c.text)))
      fail.push("konfiguracja modułów nie została pobrana — czasy pytań mogą być błędne");
  }
  if (closes > 0) console.log(`   ⚠️  socket był zamykany ${closes}× — dozorca musiał go podnosić`);

  // 6. pełna ścieżka — czy przeszliśmy przez wszystkie etapy wydarzenia
  if (FULL) {
    const seen = new Set(samples.flatMap((s) => s.phones.map((p) => p?.phase)).filter(Boolean));
    const flow = globalThis.__flow || {};
    const intros = countTransitions(samples, "zapowiedz");
    console.log("\n🗺️  Pełna ścieżka wydarzenia:");
    const stages = [
      ["poczekalnia", seen.has("lobby")],
      ["zapowiedzi modułów", intros >= 4, `${intros} (oczekiwane ≥4 dla 5 modułów)`],
      ["pytania", seen.has("quiz")],
      ["pauza widoczna u uczestnika", !!flow.pauseSeen],
      ["wznowienie po pauzie", !!flow.resumed],
      ["ekran oczekiwania na wyniki", seen.has("czekam_wyniki")],
      ["ogłoszenie wyników", !!flow.announced],
      ["ekran wyniku uczestnika", seen.has("wynik")],
    ];
    for (const [name, ok, extra] of stages) {
      console.log(`   ${ok ? "✅" : "❌"} ${name}${extra ? "  — " + extra : ""}`);
      if (!ok) fail.push(`etap nieosiągnięty: ${name}`);
    }
    console.log(`   zaobserwowane fazy: ${[...seen].join(", ")}`);
  }

  // PROBE_TRACE=1 — ślad zmian stanu. Nieoceniony, gdy metryka mówi „coś jest źle",
  // ale nie mówi co: pokazuje, kto i kiedy się przełączył.
  if (process.env.PROBE_TRACE === "1") {
    console.log("\n🔍 ŚLAD (tylko zmiany):");
    let prev = "";
    for (const s of samples) {
      const a = s.admin || {};
      const line = s.phones.map((p) => `${String(p?.phase).slice(0, 9).padEnd(9)} q=${String(p?.q ?? "-").padStart(2)} t=${String(p?.timer ?? "-").padStart(2)}`).join(" | ");
      const key = `${a.phase}|${a.q}|${line}`;
      if (key === prev) continue;
      prev = key;
      console.log(`  ${String((s.at / 1000).toFixed(1)).padStart(6)}s  host[${String(a.phase).slice(0, 9).padEnd(9)} q=${String(a.q ?? "-").padStart(2)}]  ${line}`);
    }
  }

  if (fail.length) {
    console.log("\n" + "─".repeat(60));
    console.log("PROBLEMY:");
    for (const f of fail) console.log(`  ❌ ${f}`);
  }
  console.log("═".repeat(60));
  return fail;
}

main().catch(async (e) => {
  console.error("\n💥 BŁĄD SONDY:", e.message);
  await cleanup();
  process.exit(1);
});
