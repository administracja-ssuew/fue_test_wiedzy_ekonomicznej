/**
 * FUE Quiz — parzystość planu sesji JS ↔ SQL (read-only)
 *
 * Dla każdego fixture'a z src/lib/plan.fixtures.json liczy wynik w JS
 * (planPosition / sweepDecision / buildPlanItems / holdDue z src/lib/plan.js) i w bazie
 * (RPC plan_position / sweep_decision — sekcja 39; build_plan_items / plan_hold_due —
 * sekcja 42) i porównuje pole po polu. Wszystkie te funkcje SQL są czyste
 * (IMMUTABLE, bez dostępu do tabel) — skrypt nic nie czyta ani nie zapisuje w danych.
 * Bezpieczne do uruchomienia na produkcji.
 *
 *   npm run verify-plan
 *
 * Używa produkcyjnych kluczy (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
 */

import { createClient } from "@supabase/supabase-js";
import fixtures from "../src/lib/plan.fixtures.json";
import { planPosition, sweepDecision, buildPlanItems, holdDue, toMs } from "../src/lib/plan.js";

const URL  = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;
if (!URL || !ANON) { console.error("❌ Brak VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY w .env"); process.exit(1); }

const anon = createClient(URL, ANON, { auth: { persistSession: false } });

const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const A = fixtures.anchorMs;
const V2 = fixtures.v2;
const isMissing = (e) => e && (e.code === "PGRST202" || /Could not find the function/i.test(e.message || ""));

let pass = 0, fail = 0;
const ok  = (l) => { pass++; console.log(`  ✅ ${l}`); };
const bad = (l, why) => { fail++; console.error(`  ❌ ${l}\n       ${why.join("\n       ")}`); };

function missingSection(fn, e, sect = 39) {
  console.error(`\n❌ ${fn} — BRAK na produkcji: sekcja ${sect} nie wgrana na produkcję (${e.message})`);
  process.exit(1);
}

// fx = fixture pozycji, items = plan, label = etykieta grupy (legacy / v2).
async function checkPosition(fx, items, label) {
  const at = A + fx.t;
  const paused = fx.pausedT == null ? null : A + fx.pausedT;
  const js = planPosition(items, A, paused, at);
  const { data, error } = await anon.rpc("plan_position", {
    p_items: items, p_anchor: iso(A), p_paused_at: iso(paused), p_at: iso(at),
  });
  if (isMissing(error)) missingSection("plan_position", error);
  if (error) return bad(`[${label}] ${fx.name}`, [`RPC błąd: ${error.message}`]);
  const sql = Array.isArray(data) ? data[0] : data;
  if (!sql || !js) return bad(`[${label}] ${fx.name}`, [`brak wyniku (js=${!!js}, sql=${!!sql})`]);

  const why = [];
  const cmp = (l, a, b) => { if (a !== b) why.push(`${l}: SQL=${a} JS=${b}`); };
  cmp("idx", sql.idx, js.idx);
  cmp("phase", sql.phase, js.phase);
  cmp("opens_at", toMs(sql.opens_at), js.opensAt);
  cmp("closes_at", toMs(sql.closes_at), js.closesAt);
  cmp("reveal_until", toMs(sql.reveal_until), js.revealUntil);
  cmp("question_id", sql.question_id, js.item.id);
  cmp("tpq", sql.tpq, js.item.tpq);
  cmp("expect.idx (JS)", js.idx, fx.expect.idx);
  cmp("expect.phase (JS)", js.phase, fx.expect.phase);
  cmp("expect.idx (SQL)", sql.idx, fx.expect.idx);
  cmp("expect.phase (SQL)", sql.phase, fx.expect.phase);
  why.length ? bad(`[${label}] ${fx.name}`, why) : ok(`[${label}] ${fx.name}`);
}

async function checkSweep(fx) {
  const r = fx.row;
  const row = {
    status: r.status,
    anchorMs: A,
    pausedAtMs: r.pausedT == null ? null : A + r.pausedT,
    curIdx: r.curIdx,
    qStartedAtMs: r.qStartedT == null ? null : A + r.qStartedT,
    revealedIdx: r.revealedIdx,
  };
  const js = sweepDecision(row, fixtures.items, A + fx.t);
  const { data, error } = await anon.rpc("sweep_decision", {
    p_items: fixtures.items, p_anchor: iso(A), p_paused_at: iso(row.pausedAtMs),
    p_status: r.status, p_cur_idx: r.curIdx, p_q_started: iso(row.qStartedAtMs),
    p_revealed_idx: r.revealedIdx, p_at: iso(A + fx.t),
  });
  if (isMissing(error)) missingSection("sweep_decision", error);
  if (error) return bad(fx.name, [`RPC błąd: ${error.message}`]);
  const sql = Array.isArray(data) ? data[0] : data;
  if (!sql) return bad(fx.name, ["brak wyniku SQL"]);

  const why = [];
  const cmp = (label, a, b) => { if (a !== b) why.push(`${label}: SQL=${a} JS=${b}`); };
  cmp("action", sql.action, js.action);
  if (js.action !== "none") {
    cmp("new_status", sql.new_status, js.status);
    cmp("new_idx", sql.new_idx, js.idx);
    cmp("new_q_started_at", toMs(sql.new_q_started_at), js.qStartedAtMs);
    cmp("new_revealed_idx", sql.new_revealed_idx ?? null, js.revealedIdx ?? null);
  }
  const e = fx.expect;
  cmp("expect.action (JS)", js.action, e.action);
  cmp("expect.action (SQL)", sql.action, e.action);
  if (e.status !== undefined) cmp("expect.status", js.status, e.status);
  if (e.idx !== undefined) cmp("expect.idx", js.idx, e.idx);
  if (e.qStartedT !== undefined) cmp("expect.qStartedT", js.qStartedAtMs, e.qStartedT == null ? null : A + e.qStartedT);
  if (e.revealedIdx !== undefined) cmp("expect.revealedIdx", js.revealedIdx ?? null, e.revealedIdx);
  why.length ? bad(`[zamiatacz] ${fx.name}`, why) : ok(`[zamiatacz] ${fx.name}`);
}

// Budowa planu: SQL build_plan_items vs JS buildPlanItems vs fixture v2.items (sekcja 42).
async function checkBuild() {
  const { data, error } = await anon.rpc("build_plan_items", { p_questions: V2.questions, p_modules: V2.modules });
  if (isMissing(error)) missingSection("build_plan_items", error, 42);
  if (error) return bad("[budowa] build_plan_items", [`RPC błąd: ${error.message}`]);
  const sql = Array.isArray(data) ? data : [];
  const js = buildPlanItems(V2.questions, V2.modules);
  const fx = V2.items;
  const why = [];
  if (sql.length !== fx.length || js.length !== fx.length) {
    why.push(`długość: SQL=${sql.length} JS=${js.length} fixture=${fx.length}`);
  }
  const n = Math.min(sql.length, js.length, fx.length);
  for (let k = 0; k < n; k++) {
    for (const f of ["i", "id", "m", "tpq", "lead", "o", "c", "r"]) {
      if (sql[k][f] !== js[k][f] || js[k][f] !== fx[k][f]) {
        why.push(`item ${k}.${f}: SQL=${sql[k][f]} JS=${js[k][f]} fixture=${fx[k][f]}`);
      }
    }
    if (!!sql[k].h !== !!js[k].h || !!js[k].h !== !!fx[k].h) {
      why.push(`item ${k}.h: SQL=${!!sql[k].h} JS=${!!js[k].h} fixture=${!!fx[k].h}`);
    }
  }
  why.length ? bad(`[budowa] build_plan_items (${fx.length} pytań, 5 modułów)`, why)
             : ok(`[budowa] build_plan_items (${fx.length} pytań, 5 modułów, reveal 11,5 s, przerwy po 2 i 4)`);
}

// Należna przerwa planowa: SQL plan_hold_due vs JS holdDue vs fixture (sekcja 42).
async function checkHold(fx) {
  const { data, error } = await anon.rpc("plan_hold_due", {
    p_items: V2.items, p_anchor: iso(A), p_hold_idx: fx.holdIdx, p_at: iso(A + fx.t),
  });
  if (isMissing(error)) missingSection("plan_hold_due", error, 42);
  if (error) return bad(`[przerwa] ${fx.name}`, [`RPC błąd: ${error.message}`]);
  const sql = data ?? null;
  const js = holdDue(V2.items, A, fx.holdIdx, A + fx.t);
  const why = [];
  if (sql !== js) why.push(`SQL=${sql} JS=${js}`);
  if (js !== fx.expect) why.push(`expect (JS): ${js} ≠ ${fx.expect}`);
  if (sql !== fx.expect) why.push(`expect (SQL): ${sql} ≠ ${fx.expect}`);
  why.length ? bad(`[przerwa] ${fx.name}`, why) : ok(`[przerwa] ${fx.name}`);
}

async function main() {
  console.log(`\n🌐 PRODUKCJA: ${URL}\n`);
  console.log(`🧮 PARZYSTOŚĆ planu sesji JS ↔ SQL (sekcje 39 + 42) — ${fixtures.position.length} pozycji legacy, `
    + `${V2.position.length} pozycji v2, ${fixtures.sweep.length} decyzji zamiatacza, 1 budowa planu, `
    + `${V2.hold.length} przerw planowych\n`);
  for (const fx of fixtures.position) await checkPosition(fx, fixtures.items, "pozycja");
  console.log("");
  for (const fx of V2.position) await checkPosition(fx, V2.items, "pozycja v2");
  console.log("");
  for (const fx of fixtures.sweep) await checkSweep(fx);
  console.log("");
  await checkBuild();
  console.log("");
  for (const fx of V2.hold) await checkHold(fx);

  console.log("\n" + "─".repeat(56));
  console.log(`${fail ? "❌" : "✅"} PARZYSTOŚĆ JS↔SQL: ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("💥 FATAL:", e.message); process.exit(1); });
