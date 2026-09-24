/**
 * FUE Quiz — parzystość planu sesji JS ↔ SQL (read-only)
 *
 * Dla każdego fixture'a z src/lib/plan.fixtures.json liczy wynik w JS
 * (planPosition / sweepDecision z src/lib/plan.js) i w bazie (RPC plan_position /
 * sweep_decision, sekcja 39) i porównuje pole po polu. Obie funkcje SQL są czyste
 * (IMMUTABLE, bez dostępu do tabel) — skrypt nic nie czyta ani nie zapisuje w danych.
 * Bezpieczne do uruchomienia na produkcji.
 *
 *   npm run verify-plan
 *
 * Używa produkcyjnych kluczy (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
 */

import { createClient } from "@supabase/supabase-js";
import fixtures from "../src/lib/plan.fixtures.json";
import { planPosition, sweepDecision, toMs } from "../src/lib/plan.js";

const URL  = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;
if (!URL || !ANON) { console.error("❌ Brak VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY w .env"); process.exit(1); }

const anon = createClient(URL, ANON, { auth: { persistSession: false } });

const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const A = fixtures.anchorMs;
const isMissing = (e) => e && (e.code === "PGRST202" || /Could not find the function/i.test(e.message || ""));

let pass = 0, fail = 0;
const ok  = (l) => { pass++; console.log(`  ✅ ${l}`); };
const bad = (l, why) => { fail++; console.error(`  ❌ ${l}\n       ${why.join("\n       ")}`); };

function missingSection(fn, e) {
  console.error(`\n❌ ${fn} — BRAK na produkcji: sekcja 39 nie wgrana na produkcję (${e.message})`);
  process.exit(1);
}

async function checkPosition(fx) {
  const at = A + fx.t;
  const paused = fx.pausedT == null ? null : A + fx.pausedT;
  const js = planPosition(fixtures.items, A, paused, at);
  const { data, error } = await anon.rpc("plan_position", {
    p_items: fixtures.items, p_anchor: iso(A), p_paused_at: iso(paused), p_at: iso(at),
  });
  if (isMissing(error)) missingSection("plan_position", error);
  if (error) return bad(fx.name, [`RPC błąd: ${error.message}`]);
  const sql = Array.isArray(data) ? data[0] : data;
  if (!sql || !js) return bad(fx.name, [`brak wyniku (js=${!!js}, sql=${!!sql})`]);

  const why = [];
  const cmp = (label, a, b) => { if (a !== b) why.push(`${label}: SQL=${a} JS=${b}`); };
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
  why.length ? bad(`[pozycja] ${fx.name}`, why) : ok(`[pozycja] ${fx.name}`);
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

async function main() {
  console.log(`\n🌐 PRODUKCJA: ${URL}\n`);
  console.log(`🧮 PARZYSTOŚĆ planu sesji JS ↔ SQL (sekcja 39) — ${fixtures.position.length} pozycji, ${fixtures.sweep.length} decyzji zamiatacza\n`);
  for (const fx of fixtures.position) await checkPosition(fx);
  console.log("");
  for (const fx of fixtures.sweep) await checkSweep(fx);

  console.log("\n" + "─".repeat(56));
  console.log(`${fail ? "❌" : "✅"} PARZYSTOŚĆ JS↔SQL: ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("💥 FATAL:", e.message); process.exit(1); });
