# Quick 261027-wuf — poprawki po finale TWE 27.10

Źródło: dane z produkcji po finale (event_log, answers, code_attempts) + zgłoszenia z sal.

1. **Kanał `quiz-<sesja>` (94× client_error na finale):** realtime-js 2.104 zwraca istniejący kanał o tej samej nazwie. Poczekalnia + hook gry (telefon) oraz panel + wbudowany Live View (admin) zakładały ten sam `quiz-<id>` → wyjątek „cannot add postgres_changes callbacks … after subscribe()” przy starcie sesji (Wrocław 52/58 telefonów), a removeChannel jednego zamykał kanał drugiemu. Nowy `src/lib/sessionSignal.js`: jeden współdzielony kanał broadcast na sesję z licznikiem (zamyka ostatni), postgres_changes na unikalnym kanale (`uniqueTopic`). Podpięte: useParticipantGame, Lobby, useLiveProjection, AdminPanel.
2. **Blokada pauzy 5 s po starcie/wznowieniu** (`pauseLockLeftMs` w gameLogic) — Wrocław zapauzował 11 s po „Wznów quiz” (przycisk Pauza w tym samym miejscu).
3. **Sesja logowania admina:** akcje admina (`adminRpcCall`) po odmowie z powodu logowania odświeżają sesję i ponawiają raz; inaczej komunikat „Sesja logowania wygasła - F5…” zamiast „forbidden”. (Brak twardego dowodu z finału — zabezpieczenie.)
4. **Baner zablokowanych kodów** w panelu sesji: kody z prób „na innym urządzeniu” (z `admin_recent_code_conflicts`, nie z listy uczestników — kod przypięty w próbie nie należy do sesji finału, dlatego WRO-9676/WRO-1991 były niewidoczne) z przyciskiem 🔓 (`releaseCodeByCode`, `activeConflicts`).
5. **Strona główna po wydarzeniu:** `EVENT_FINISHED` — zaślepka „Dziękujemy za udział”, bez „Zapisz się”, przycisków i odliczania; „Mam kod · Panel admina” dyskretnie w lewym górnym rogu (pełne nazwy dostępne zostają dla sond/e2e).
