/**
 * FUE Quiz — weryfikacja zegara serwera (sekcja 28: server_now)
 *
 *   npm run verify-clock
 *
 * Sprawdza, że RPC server_now działa dla anon, mierzy offset (NTP-lite) i RTT,
 * oraz symuluje dwóch klientów o RÓŻNYCH lokalnych zegarach — pokazując, że po
 * korekcie offsetem liczą tę samą pozostałą sekundę z tego samego q_started_at.
 */
import { createClient } from "@supabase/supabase-js";
import { computeOffset } from "../src/lib/serverClock.js";
import { remainingSeconds } from "../src/lib/gameLogic.js";

const USING_STAGE = !!process.env.VITE_SUPABASE_URL_STAGE;
const URL = process.env.VITE_SUPABASE_URL_STAGE || process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY_STAGE || process.env.VITE_SUPABASE_ANON_KEY;
if (!URL || !ANON) { console.error("❌ Brak VITE_SUPABASE_URL[_STAGE]/ANON w .env"); process.exit(1); }
console.log(`🌐 Cel: ${URL}  ${USING_STAGE ? "(STAGING ✓)" : "⚠️ (PRODUKCJA)"}`);

const anon = createClient(URL, ANON, { auth: { persistSession: false } });

async function sample() {
  const t0 = Date.now();
  const { data, error } = await anon.rpc("server_now");
  const t1 = Date.now();
  if (error) return { error };
  return { t0, t1, serverMs: Number(data), rtt: t1 - t0 };
}

async function main() {
  console.log("\n🕐 WERYFIKACJA ZEGARA SERWERA\n");
  const samples = [];
  for (let i = 0; i < 6; i++) {
    const s = await sample();
    if (s.error) { console.error(`  ❌ server_now nie działa: ${s.error.message}\n     → wgraj sekcję 28 na tym projekcie.`); process.exit(1); }
    samples.push(s);
    console.log(`  próba ${i + 1}: RTT ${String(s.rtt).padStart(4)} ms`);
  }
  const offset = computeOffset(samples);
  const minRtt = Math.min(...samples.map((s) => s.rtt));
  console.log(`\n  ✅ server_now działa dla anon`);
  console.log(`  📏 offset (serwer − lokalny): ${offset >= 0 ? "+" : ""}${offset} ms`);
  console.log(`  📡 najlepszy RTT: ${minRtt} ms  (niepewność offsetu ≈ ±${Math.round(minRtt / 2)} ms)`);

  // Dwóch klientów: A z zegarem +7000 ms, B z −4000 ms względem prawdy.
  // Po korekcie offsetem oba muszą policzyć tę samą pozostałą sekundę.
  const trueNow = samples.at(-1).serverMs;
  const qStarted = trueNow - 12_000;      // pytanie wystartowało 12 s temu (serwer)
  const tpq = 30;
  const skewA = 7000, skewB = -4000;
  // Klient o skew ma lokalny zegar ≈ trueNow+skew; RPC zwraca serverMs≈trueNow,
  // a środek przedziału t0..t1 wypada na jego lokalnym zegarze → offset ≈ −skew.
  const mkOffset = (skew) => computeOffset([{ t0: trueNow + skew - 30, t1: trueNow + skew + 30, serverMs: trueNow }]);
  const localA = trueNow + skewA, localB = trueNow + skewB;
  const offA = mkOffset(skewA), offB = mkOffset(skewB);
  const remA = remainingSeconds(tpq, qStarted, localA + offA);
  const remB = remainingSeconds(tpq, qStarted, localB + offB);
  const naiveA = remainingSeconds(tpq, qStarted, localA); // bez korekty
  const naiveB = remainingSeconds(tpq, qStarted, localB);
  console.log(`\n  Symulacja rozjechanych zegarów (A +7s, B −4s), pytanie 30s, minęło 12s:`);
  console.log(`    bez korekty:  A=${naiveA}s  B=${naiveB}s  → rozjazd ${Math.abs(naiveA - naiveB)}s`);
  console.log(`    z serverNow:  A=${remA}s  B=${remB}s  → rozjazd ${Math.abs(remA - remB)}s`);
  if (remA === remB) console.log(`  ✅ Po korekcie A i B liczą identyczną sekundę (${remA}s).`);
  else { console.error(`  ❌ Rozjazd po korekcie!`); process.exit(1); }
  console.log(`\n✅ ZEGAR OK\n`);
}
main().catch((e) => { console.error("💥 FATAL:", e.message); process.exit(1); });
