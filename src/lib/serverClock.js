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

let samples = [];      // bufor ostatnich próbek (max SAMPLE_BUFFER), także ze snapshotów
const SAMPLE_BUFFER = 8;

// Czysta funkcja (testowalna): offset = serwer − lokalny środek przedziału (t0..t1).
// Filtr w stylu timesync: zostawiamy tylko próbki z pasma najlepszego RTT
// (rtt <= minRtt * 1,5 + 10 ms) i bierzemy medianę ich offsetów. Mały RTT = mała
// niepewność co do chwili odczytu zegara; mediana w paśmie odrzuca pojedynczą
// przekłamaną próbkę (np. pakiet opóźniony tylko w jedną stronę).
// Dlaczego pasmo min-RTT, a nie „mediana ± odchylenie” po wszystkich próbkach: przy
// rozrzucie RTT 20/600/1000 odchylenie jest tak duże, że filtr zatrzymałby wszystkie
// próbki, a mediana wybrałaby zaszumioną — pasmo min-RTT trzyma się tylko najlepszych.
// samples: [{ t0, t1, serverMs }]
export function computeOffset(samples) {
  const list = [];
  for (const s of samples || []) {
    if (typeof s?.serverMs !== "number" || !Number.isFinite(s.serverMs)) continue;
    list.push({ rtt: s.t1 - s.t0, off: s.serverMs - (s.t0 + s.t1) / 2 });
  }
  if (!list.length) return 0;
  const minRtt = Math.min(...list.map((x) => x.rtt));
  const band = list.filter((x) => x.rtt <= minRtt * 1.5 + 10).map((x) => x.off).sort((a, b) => a - b);
  const mid = Math.floor(band.length / 2);
  const median = band.length % 2 ? band[mid] : (band[mid - 1] + band[mid]) / 2;
  return Math.round(median);
}

// Próbka z dowolnej odpowiedzi serwera niosącej jego czas (np. snapshot sesji) —
// darmowa synchronizacja bez dodatkowych wywołań server_now.
export function addClockSample(sample) {
  if (!Number.isFinite(sample?.serverMs)) return;
  samples.push({ t0: sample.t0, t1: sample.t1, serverMs: sample.serverMs });
  if (samples.length > SAMPLE_BUFFER) samples = samples.slice(-SAMPLE_BUFFER);
  offset = computeOffset(samples);
  synced = true;
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
export async function syncServerClock(rounds = 6) {
  if (DEMO || !supabase) { offset = 0; synced = true; return 0; }
  const fresh = [];
  for (let i = 0; i < rounds; i++) {
    const s = await measureOnce();
    if (s) fresh.push(s);
  }
  if (fresh.length) {
    samples = fresh.slice(-SAMPLE_BUFFER);
    offset = computeOffset(samples);
    synced = true;
  }
  return offset;
}

// Uruchom raz na starcie aplikacji; odświeżaj okresowo (dryf zegara, zmiana sieci).
// refreshMs = 5 min, nie 60 s: syncServerClock robi 6 sekwencyjnych wywołań server_now,
// więc przy 500 uczestnikach odświeżanie co minutę to 3000 zapytań/min (50/s) czystego
// narzutu przez całe wydarzenie. Offset raz zmierzony nie dryfuje w ciągu godziny na
// tyle, żeby to uzasadniało — a timery i tak liczą się z q_started_at, nie z licznika.
export function startServerClock(refreshMs = 300000) {
  syncServerClock();
  if (timer) clearInterval(timer);
  timer = setInterval(() => syncServerClock(), refreshMs);

  // Telefon z zablokowanym ekranem to najbardziej realne źródło rozjazdu na sali:
  // przeglądarka usypia timery, więc odświeżenie co 5 min może nie wykonać się wcale,
  // a uczestnik wraca do quizu z offsetem sprzed kilkunastu minut. Przy powrocie karty
  // na pierwszy plan mierzymy od nowa — to jedna seria zapytań na odblokowanie
  // telefonu, więc kosztu przy 500 osobach praktycznie nie ma.
  const onVisible = () => { if (!document.hidden) syncServerClock(); };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);

  // Powrót sieci (zmiana Wi-Fi → LTE na sali) potrafi zmienić trasę i RTT — mierzymy od nowa.
  const onOnline = () => syncServerClock();
  if (typeof window !== "undefined") window.addEventListener("online", onOnline);

  return () => {
    if (timer) clearInterval(timer);
    timer = null;
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    if (typeof window !== "undefined") window.removeEventListener("online", onOnline);
  };
}
