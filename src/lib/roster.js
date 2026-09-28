// ─── Lista uczestników „kto utknął” dla admina (P7-ADMIN-STUCK, 07-RESEARCH Wzorzec 10) ─
// Dlaczego BEZ presence w trakcie gry: limity Realtime (Pro: 500 msg/s, 50 presence msg/s)
// liczą doręczenia z fan-outem — fala reconnectu 100 telefonów w kanale presence miasta to
// ~10 000 doręczeń w kilka sekund, a przekroczenie limitu rozłącza połączenia (w tym jedyny
// kanał sterujący rozgrywką). Sygnałem żywotności jest więc wiersz w `answers` ostatniego
// ZAMKNIĘTEGO pytania: żywy telefon zawsze go zostawia (odpowiedź albo pusty zapis 0–1 s
// po `closes`). Koszt: +1 RPC na pytanie (wynik po zamknięciu się nie zmienia → cache).
// W poczekalni (waiting) używamy istniejącej listy presence lobby admina.

export const ROSTER_STATES = {
  lobby:        { label: "W poczekalni", short: "W poczekalni", color: "#9B89CC", problem: false, pulse: true },
  online:       { label: "W grze", short: "W grze", color: "#10D9A0", problem: false, pulse: true },
  answered:     { label: "W grze", short: "W grze", color: "#10D9A0", problem: false, pulse: true },
  no_answer:    { label: "Brak odpowiedzi na bieżące pytanie", short: "Brak odpowiedzi", color: "#F5C518", problem: true, pulse: false },
  disconnected: { label: "Rozłączony", short: "Rozłączony", color: "#E8376B", problem: true, pulse: false },
  conflict:     { label: "Inny telefon próbuje wejść", short: "Inny telefon", color: "#FF9A3C", problem: true, pulse: false },
};

// Okno, w którym próba wejścia z innego telefonu (code_attempts reason='taken') jest „świeża”.
export const CONFLICT_WINDOW_MS = 5 * 60 * 1000;

// Zapas po `closes`: pusty zapis telefonu (0–1 s) + bramka odsłonięcia (1,5 s) + opóźnienie sieci.
export const CLOSED_GRACE_MS = 4500;

// Indeks ostatniego pytania, które zamknęło się co najmniej graceMs temu (czas planu,
// zamrożony w pauzie), albo null. items: plan sesji { i, id, c, … } (c = ms od kotwicy).
export function lastClosedIndex(items, anchorMs, pausedAtMs, nowMs, graceMs = CLOSED_GRACE_MS) {
  if (!items?.length || anchorMs == null) return null;
  const t = (pausedAtMs ?? nowMs) - anchorMs;
  let found = null;
  for (let i = 0; i < items.length; i++) {
    if (items[i].c + graceMs <= t) found = i;
    else break;
  }
  return found;
}

// lastClosed: null (brak zamkniętego pytania / danych) | "answered" | "empty" (pusty zapis) | "missing" (brak wiersza).
// inLobby: true / false / null (presence nieznane — np. kanał nie działa → nie oznaczamy jako rozłączony).
export function classifyParticipant({ status, inLobby = null, lastClosed = null, conflictAt = null, nowMs }) {
  if (conflictAt != null && nowMs - conflictAt <= CONFLICT_WINDOW_MS) return "conflict";
  if (status === "waiting") return inLobby === false ? "disconnected" : "lobby";
  if (lastClosed === "answered") return "answered";
  if (lastClosed === "empty") return "no_answer";
  if (lastClosed === "missing") return "disconnected";
  return "online";
}

const RANK = { conflict: 0, disconnected: 1, no_answer: 2 };

// Kopia posortowana: konflikt → rozłączony → brak odpowiedzi → reszta; w grupie po kodzie rosnąco.
export function sortRoster(rows) {
  return [...(rows || [])].sort((a, b) =>
    (RANK[a.state] ?? 3) - (RANK[b.state] ?? 3) || String(a.code).localeCompare(String(b.code)));
}

// Liczniki do pigułek podsumowania (online = online + answered).
export function summarizeRoster(rows) {
  const s = { online: 0, no_answer: 0, disconnected: 0, conflict: 0, lobby: 0 };
  for (const r of rows || []) {
    if (r.state === "online" || r.state === "answered") s.online++;
    else if (r.state in s) s[r.state]++;
  }
  return s;
}

export function conflictLabel(atMs, nowMs) {
  return `${ROSTER_STATES.conflict.label} · ${Math.max(0, Math.floor((nowMs - atMs) / 60000))} min temu`;
}
