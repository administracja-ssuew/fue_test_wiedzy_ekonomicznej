/**
 * FUE Quiz — test integracyjny LIMITU PRÓB KODÓW na PRODUKCJI (sekcja 44)
 *
 * UWAGA: ten skrypt PISZE na produkcję (tworzy kod testowy „[SONDA] limit”,
 * zapisuje porażki w code_attempts i jeden wiersz w violations) i SPRZĄTA po
 * sobie w bloku `finally` — na końcu wypisuje linię „resztki: 0 ✅”.
 *
 * Sprawdza:
 *   0. marker sekcji 44 (schema_marker_44),
 *   1. 5× nieistniejący kod z urządzenia A → not_found,
 *   2. 6. próba z A (nawet z POPRAWNYM kodem) → rate_limited + retry_after_s 1..60,
 *   3. urządzenie B z poprawnym kodem → przechodzi (limit jest per urządzenie),
 *   4. po 61 s urządzenie A znów może próbować (not_found, nie rate_limited),
 *   5. record_violation: zapis per typ (count / type_count) i brak wyroczni kodu,
 *   6. test nagłówka IP (debug_request_ip_echo) → werdykt wybierający wariant 44.Z.
 *
 *   npm run verify-code-limit        (czas ~75 s — w tym 61 s czekania)
 *
 * WYŁĄCZNIE produkcja: VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY + SUPABASE_SERVICE_KEY.
 * Kod wyjścia: 0 = wszystko OK i brak resztek, 1 = problem albo resztki.
 */

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const URL = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!URL || !ANON || !SERVICE) {
  console.error("❌ Brak VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_KEY w .env (produkcja)");
  process.exit(1);
}

const anon = createClient(URL, ANON, { auth: { persistSession: false } });
const svc = createClient(URL, SERVICE, { auth: { persistSession: false } });

let pass = 0, fail = 0, warn = 0;
const ok   = (l, d = "") => { pass++; console.log(`  ✅ ${l.padEnd(50)} ${d}`); };
const bad  = (l, d = "") => { fail++; console.error(`  ❌ ${l.padEnd(50)} ${d}`); };
const note = (l, d = "") => { warn++; console.log(`  ⚠️  ${l.padEnd(50)} ${d}`); };

const isMissing = (e) => e && (e.code === "PGRST202" || /Could not find the function/i.test(e.message || ""));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SPOOF_IPS = ["1.1.1.1", "2.2.2.2", "3.3.3.3"];

function maskIp(ip) {
  if (ip == null) return "—";
  const s = String(ip);
  if (s.includes(".")) {
    const p = s.split(".");
    return `${p[0]}.${p[1] ?? "x"}.x.x`;
  }
  if (s.includes(":")) {
    const p = s.split(":");
    return `${p[0]}:${p[1] ?? "x"}:x:x`;
  }
  return "x.x.x.x";
}

function randomProbeCode() {
  return "PRB-" + String(crypto.randomInt(0, 10000)).padStart(4, "0");
}

async function codeExists(code) {
  const { data, error } = await svc.from("participant_codes").select("code").eq("code", code).limit(1);
  if (error) throw new Error(`participant_codes select: ${error.message}`);
  return (data?.length || 0) > 0;
}

async function freshMissingCode(taken) {
  for (let i = 0; i < 50; i++) {
    const c = randomProbeCode();
    if (taken.has(c)) continue;
    if (!(await codeExists(c))) { taken.add(c); return c; }
  }
  throw new Error("nie udało się wylosować wolnego kodu PRB-NNNN (50 prób)");
}

async function claim(code, device) {
  const { data, error } = await anon.rpc("claim_participant_code", { p_code: code, p_device: device });
  if (error) throw new Error(`claim_participant_code: ${error.message}`);
  return data;
}

async function main() {
  console.log(`\n🌐 PRODUKCJA: ${URL}`);
  console.log("🎟️  TEST LIMITU PRÓB KODÓW (sekcja 44) — PISZE na produkcję i sprząta po sobie\n");

  // 0 — marker sekcji 44.
  {
    const { data, error } = await anon.rpc("schema_marker_44", {});
    if (isMissing(error)) {
      bad("schema_marker_44 — BRAK", "→ wgraj sekcję 44 (plan 07-06)");
      process.exit(1);
    }
    if (error || data !== true) {
      bad("schema_marker_44 — nieoczekiwana odpowiedź", error?.message || JSON.stringify(data));
      process.exit(1);
    }
    ok("schema_marker_44 — sekcja 44 wgrana");
  }

  const used = new Set();
  let testCode = null;
  let testInserted = false;
  const devA = "verify-limit-A-" + crypto.randomUUID();
  const devB = "verify-limit-B-" + crypto.randomUUID();

  try {
    // 1 — przygotowanie: kod testowy + 6 nieistniejących kodów.
    testCode = await freshMissingCode(used);
    {
      const { error } = await svc.from("participant_codes").insert({
        code: testCode, name: "[SONDA] limit", surname: "Sonda", city: "Kraków",
      });
      if (error) throw new Error(`wstawienie kodu testowego: ${error.message}`);
      testInserted = true;
    }
    const missing = [];
    for (let i = 0; i < 6; i++) missing.push(await freshMissingCode(used));
    console.log(`  ℹ️  kod testowy ${testCode}, 6 nieistniejących kodów PRB-NNNN, urządzenia A/B\n`);

    // 2 — 5× nieistniejący kod z urządzenia A → not_found.
    {
      let allNotFound = true;
      for (let i = 0; i < 5; i++) {
        const d = await claim(missing[i], devA);
        if (d?.reason !== "not_found") {
          allNotFound = false;
          bad(`próba ${i + 1} z urządzenia A — oczekiwano not_found`, JSON.stringify(d));
        }
      }
      if (allNotFound) ok("5 błędnych kodów z urządzenia A → not_found");
    }

    // 3 — 6. próba z A z POPRAWNYM kodem → rate_limited.
    {
      const d = await claim(testCode, devA);
      const s = Number(d?.retry_after_s);
      if (d?.ok === false && d?.reason === "rate_limited" && s >= 1 && s <= 60) {
        ok("6. próba z urządzenia A odrzucona", `retry_after_s=${s}`);
      } else {
        bad("6. próba z urządzenia A — oczekiwano rate_limited", JSON.stringify(d));
      }
    }

    // 4 — urządzenie B z poprawnym kodem → przechodzi.
    {
      const d = await claim(testCode, devB);
      if (d?.ok === true && d?.data?.code === testCode) ok("inne urządzenie z poprawnym kodem przechodzi");
      else bad("urządzenie B z poprawnym kodem — oczekiwano ok", JSON.stringify(d));
    }

    // 5 — odczekaj 61 s, potem A znów może próbować.
    {
      const total = 61;
      for (let left = total; left > 0; left -= 15) {
        console.log(`  ⏳ czekam na wygaśnięcie blokady urządzenia A… zostało ${left} s`);
        await sleep(Math.min(15, left) * 1000);
      }
      const d = await claim(missing[5], devA);
      if (d?.reason === "not_found") ok("po 60 s urządzenie A znów może próbować");
      else bad("po 61 s urządzenie A — oczekiwano not_found", JSON.stringify(d));
    }

    // 6 — record_violation: zapis per typ + brak wyroczni kodu.
    {
      const { error } = await anon.rpc("record_violation", {
        p_code: testCode, p_session_id: null, p_type: "tab_switch", p_count: 3, p_type_count: 2,
      });
      if (error) bad("record_violation (kod testowy) — błąd", error.message);
      else {
        const { data: rows, error: er } = await svc.from("violations")
          .select("count,type_count").eq("participant_code", testCode);
        if (er) bad("violations — odczyt po record_violation", er.message);
        else if (rows?.length === 1 && rows[0].count === 3 && rows[0].type_count === 2)
          ok("record_violation zapisuje count i type_count", "count=3, type_count=2");
        else bad("record_violation — zły zapis", JSON.stringify(rows));
      }

      const { error: e2 } = await anon.rpc("record_violation", {
        p_code: "PRB-NIEMA", p_session_id: null, p_type: "tab_switch", p_count: 1, p_type_count: 1,
      });
      if (e2) bad("record_violation (nieistniejący kod) — błąd", `${e2.message} (wyrocznia kodu!)`);
      else {
        const { data: rows, error: er } = await svc.from("violations")
          .select("id").eq("participant_code", "PRB-NIEMA");
        if (er) bad("violations — odczyt PRB-NIEMA", er.message);
        else if ((rows?.length || 0) === 0) ok("record_violation z nieistniejącym kodem — cisza", "brak wyroczni, brak wiersza");
        else bad("record_violation zapisał wiersz dla nieistniejącego kodu", `${rows.length} wierszy`);
      }
    }

    // 7 — test nagłówka IP (tylko gdy echo jeszcze istnieje).
    {
      const { data: ipPlain, error: e1 } = await anon.rpc("debug_request_ip_echo", {});
      if (isMissing(e1)) {
        ok("echo usunięte (44.Z wgrany)", "test nagłówka IP pominięty");
      } else if (e1) {
        bad("debug_request_ip_echo — błąd", e1.message);
      } else {
        // Każdy nagłówek osobno: Cloudflare odrzuca całe żądanie z podrobionym
        // CF-Connecting-IP (błąd 1000, strona HTML), co przy wysyłce łącznej ukrywało
        // wynik dla X-Forwarded-For / X-Real-IP. Odrzucenie przez brzeg = nagłówek
        // nie dociera do PostgREST = nie da się nim podrobić IP.
        const SPOOF_HEADERS = [["X-Forwarded-For", "1.1.1.1"], ["CF-Connecting-IP", "2.2.2.2"], ["X-Real-IP", "3.3.3.3"]];
        let spoofed = false;
        let answered = 0;
        for (const [h, v] of SPOOF_HEADERS) {
          const spoofClient = createClient(URL, ANON, { auth: { persistSession: false }, global: { headers: { [h]: v } } });
          const { data: ipSpoof, error: e2 } = await spoofClient.rpc("debug_request_ip_echo", {});
          if (e2) {
            const edge = /cloudflare|<!doctype html/i.test(e2.message || "");
            console.log(`  ℹ️  ${h}: ${edge ? "żądanie odrzucone przez Cloudflare (nie dociera)" : `błąd: ${String(e2.message).slice(0, 80)}`}`);
            if (!edge) bad(`debug_request_ip_echo (${h}) — błąd`, String(e2.message).slice(0, 120));
            continue;
          }
          answered++;
          const diff = SPOOF_IPS.includes(ipSpoof) || ipSpoof !== ipPlain;
          if (diff) spoofed = true;
          console.log(`  ℹ️  ${h}: IP widziane przez bazę ${maskIp(ipSpoof)} ${diff ? "— PODROBIONE" : "— bez zmian"}`);
        }
        console.log(`\n  ℹ️  IP bez nagłówków: ${maskIp(ipPlain)}\n`);
        if (ipPlain == null) {
          console.log("  IP: brak (nagłówek nie dociera do PostgREST) → wariant 44.Z-B");
        } else if (spoofed || answered === 0) {
          console.log("  IP: podrabialne → wariant 44.Z-B");
        } else {
          console.log("  IP: niepodrabialne → wariant 44.Z-A");
        }
        note("debug_request_ip_echo — jeszcze istnieje", "→ wgraj 44.Z według werdyktu powyżej (07-06)");
      }
    }
  } finally {
    // 8 — sprzątanie (service key).
    console.log("\n🧹 Sprzątanie:\n");
    let leftovers = 0;
    if (testCode) {
      const { error: ev } = await svc.from("violations").delete().eq("participant_code", testCode);
      if (ev) console.error(`  ❌ delete violations: ${ev.message}`);
      if (testInserted) {
        const { error: ep } = await svc.from("participant_codes").delete().eq("code", testCode);
        if (ep) console.error(`  ❌ delete participant_codes: ${ep.message}`);
      }
    }
    {
      const { error: ea } = await svc.from("code_attempts").delete().in("device", [devA, devB]);
      if (ea) console.error(`  ❌ delete code_attempts: ${ea.message}`);
    }

    // Odczyt resztek.
    if (testCode) {
      const { data: pc, error: e1 } = await svc.from("participant_codes").select("id").eq("code", testCode);
      if (e1) { leftovers++; console.error(`  ❌ odczyt resztek participant_codes: ${e1.message}`); }
      else leftovers += pc?.length || 0;
      const { data: vi, error: e2 } = await svc.from("violations").select("id").eq("participant_code", testCode);
      if (e2) { leftovers++; console.error(`  ❌ odczyt resztek violations: ${e2.message}`); }
      else leftovers += vi?.length || 0;
    }
    {
      const { data: ca, error: e3 } = await svc.from("code_attempts").select("id").in("device", [devA, devB]);
      if (e3) { leftovers++; console.error(`  ❌ odczyt resztek code_attempts: ${e3.message}`); }
      else leftovers += ca?.length || 0;
    }

    if (leftovers === 0) console.log("  resztki: 0 ✅");
    else console.error(`  ⚠️ zostały resztki (${leftovers}) — usuń ręcznie kod ${testCode} i próby urządzeń verify-limit-*`);

    console.log("\n" + "─".repeat(56));
    if (fail === 0 && leftovers === 0) console.log(`✅ LIMIT PRÓB DZIAŁA (${pass} OK${warn ? `, ${warn} uwag` : ""})`);
    else console.log(`❌ ${fail} PROBLEM(ÓW)${leftovers ? `, resztki: ${leftovers}` : ""}`);
    process.exitCode = fail === 0 && leftovers === 0 ? 0 : 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => { console.error("💥 FATAL:", e.message); process.exit(1); });
