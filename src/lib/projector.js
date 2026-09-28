// ── Projektor: ekran bez bieżącego pytania (G8) ──────────────────────────────
// Po teście na telefonach projektor po zakończeniu testu wracał do „Oczekiwanie”,
// bo useLiveProjection dla każdego stanu bez pytania ustawiał "waiting".
// Osobna czysta funkcja rozróżnia koniec testu od poczekalni i jest testowana
// Vitestem bez Reacta i bez Supabase.

// Ekran projektora, gdy plan nie ma bieżącego pytania: koniec testu (results/ended) albo poczekalnia.
export function projectorIdlePhase(v, status) {
  if (v?.phase === "results" || v?.phase === "ended") return "ended";
  if (status === "results" || status === "ended") return "ended";
  return "waiting"; // lobby, legacy, brak planu
}
