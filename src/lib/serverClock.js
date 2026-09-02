import { supabase, DEMO } from "./supabase.js";

// Wspólny zegar serwera dla synchronizacji timerów "co do sekundy" na wszystkich
// ekranach (uczestnik / Live View / admin). Każdy klient liczy pozostały czas z
// q_started_at − teraz; gdyby "teraz" pochodziło z lokalnego (rozjechanego) zegara
// urządzenia, timery różniłyby się o rozjazd zegarów. Tu mierzymy offset względem
// serwera (RPC server_now) metodą NTP-lite i wystawiamy serverNow().

let offset = 0;        // serverNow − Date.now() w ms
let synced = false;
let timer = null;

// serverNow() — czas, na którym MUSZĄ zgadzać się wszystkie ekrany.
export function serverNow() { return Date.now() + offset; }
export function getClockOffset() { return offset; }
export function isClockSynced() { return synced; }

// Czysta funkcja (testowalna): z próbek wybierz tę o najmniejszym RTT i policz
// offset jako serwer − lokalny środek przedziału (t0..t1). Najmniejszy RTT = najmniej
// niepewności co do tego, kiedy serwer odczytał zegar.
// samples: [{ t0, t1, serverMs }]
export function computeOffset(samples) {
  let best = null;
  for (const s of samples) {
    if (typeof s?.serverMs !== "number") continue;
    const rtt = s.t1 - s.t0;
    if (!best || rtt < best.rtt) best = { rtt, offset: s.serverMs - (s.t0 + s.t1) / 2 };
  }
  return best ? Math.round(best.offset) : 0;
}

async function measureOnce() {
  const t0 = Date.now();
  const { data, error } = await supabase.rpc("server_now");
  const t1 = Date.now();
  const serverMs = typeof data === "number" ? data : Number(data);
  if (error || !Number.isFinite(serverMs)) return null;
  return { t0, t1, serverMs };
}

// Zmierz offset (kilka prób, bierzemy najlepszą). Bezpieczne gdy RPC nie istnieje
// jeszcze (sekcja 28 nie wgrana) lub DEMO → offset 0 (serverNow == Date.now()).
export async function syncServerClock(rounds = 4) {
  if (DEMO || !supabase) { offset = 0; synced = true; return 0; }
  const samples = [];
  for (let i = 0; i < rounds; i++) {
    const s = await measureOnce();
    if (s) samples.push(s);
  }
  if (samples.length) { offset = computeOffset(samples); synced = true; }
  return offset;
}

// Uruchom raz na starcie aplikacji; odświeżaj okresowo (dryf zegara, zmiana sieci).
// refreshMs = 5 min, nie 60 s: syncServerClock robi 4 sekwencyjne wywołania server_now,
// więc przy 500 uczestnikach odświeżanie co minutę to 2000 zapytań/min (33/s) czystego
// narzutu przez całe wydarzenie. Offset raz zmierzony nie dryfuje w ciągu godziny na
// tyle, żeby to uzasadniało — a timery i tak liczą się z q_started_at, nie z licznika.
export function startServerClock(refreshMs = 300000) {
  syncServerClock();
  if (timer) clearInterval(timer);
  timer = setInterval(() => syncServerClock(), refreshMs);
  return () => { if (timer) clearInterval(timer); timer = null; };
}
