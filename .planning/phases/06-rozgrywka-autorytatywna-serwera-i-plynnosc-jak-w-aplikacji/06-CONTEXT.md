# Phase 6: Rozgrywka autorytatywna serwera i płynność jak w aplikacji — Context

**Gathered:** 2026-09-24
**Status:** Ready for planning
**Research:** `.planning/research/PLYNNOSC-ROZGRYWKI.md` (czytać w całości — diagnoza D1–D6, wzorzec, plan wdrożenia)

<domain>
## Phase Boundary

Przebudowa mechaniki rozgrywki tak, żeby przebieg quizu był funkcją planu zamrożonego w bazie i zegara serwera, a nie działania którejkolwiek przeglądarki. Plus płynność UI uczestnika na natywnych API. Poza zakresem: ekran admina dla rozłączonych uczestników (`releaseCode` bez UI) — osobny `/gsd:quick`.
</domain>

<decisions>
## Implementation Decisions

### Model czasu
- Plan sesji (kolejność pytań + czas każdego) zamrażany przy `start_quiz_session`. Czas pytania na kliencie pochodzi WYŁĄCZNIE z planu, nie z `ModulesContext`.
- Faza każdego ekranu (uczestnik, LiveView, podgląd admina) = czysta funkcja `(serverNow(), plan, pauzy)` — rozszerzenie istniejącego `projectLiveState`.
- Pauza/wznowienie przesuwa przyszłe terminy jednym zapisem.

### Przejścia
- Przejścia wykonuje baza: `advance_due_sessions()` wywoływane przez `pg_cron` co 1 s, idempotentne (CAS jak w `advance_session_question`), obejmuje też przejście ostatnie pytanie → wyniki.
- Kierowca w `AdminPanel.jsx` (`driverTick`) i awaryjny kierowca uczestników (`fallbackJitterMs`) do usunięcia po wdrożeniu.
- `submit_answer` wyznacza aktywne pytanie z planu i `clock_timestamp()`, niezależnie od zamiatacza.

### Przycisk „⏭ Następne"
- **Zostaje** jako przesunięcie planu: skraca bieżące pytanie, serwer przesuwa wszystkie kolejne terminy jednym zapisem; wszyscy przeskakują jednocześnie.

### Punktacja i uczciwość
- **Czysty zegar serwera**: czas odpowiedzi = moment dotarcia do bazy − otwarcie pytania. Bez korekty o opóźnienie sieci.
- `correct_ans` NIE wraca z `submit_answer`; klient dostaje ją dopiero w fazie reveal (po deadline).
- Odpowiedź w strefie tolerancji po deadline (dziś 1,5 s) przyjęta, ale bez bonusu czasowego.

### Odświeżenie / reconnect
- Jeden RPC-snapshot (`get_participant_state`): faza, pytanie, terminy, `server_now`, własna odpowiedź na bieżące pytanie, suma punktów. Jedyna ścieżka restore: start, refresh, `visibilitychange → visible`, reconnect socketu.
- Stan uczestnika w `localStorage` (klucz ważny dla `session_id`), nie `sessionStorage`.

### Płynność (natywne API, bez bibliotek UI — ograniczenie projektu)
- Screen Wake Lock na lobby + quiz, ponawiany przy `visibilitychange`.
- Pasek czasu jako animacja CSS z ujemnym `animation-delay` liczonym z terminu; cyfry z `requestAnimationFrame` + `serverNow()`.
- Optimistic lock-in odpowiedzi + `navigator.vibrate` gdzie dostępne.
- View Transitions API, prefetch następnego pytania w oknie reveal, szkielet ekranu przy refreshu, `prefers-reduced-motion`.

### Środowisko i bezpieczeństwo wdrożenia
- **Brak stagingu** (`iaehipybmcxrvgyfmcfr` → ENOTFOUND). Testy na PRODUKCJI (`dmoydtavstpurqebkngu`) samosprzątającymi sondami (`PROBE_CONFIRM=1`).
- W konsekwencji: **każda migracja SQL addytywna** — nowe kolumny nullable, nowe RPC pod nowymi nazwami albo kompatybilne sygnatury, zamiatacz działa tylko na sesjach posiadających plan. Obecnie wdrożony frontend (Vercel) musi działać bez zmian aż do wdrożenia nowego.
- Migracje w `SUPABASE_FIXES.sql` jako nowe numerowane sekcje (konwencja repo). Uwaga: sekcja 37 była oznaczona jako niewgrana (STATE.md, 02.09) — sprawdzić stan przed dopisaniem nowych.
- `pg_cron`: czyszczenie `cron.job_run_details`, minimalne logowanie dla zadania 1 s.

### Weryfikacja
- Nowe tryby sondy `scripts/probe-gameplay.js`: `PROBE_ADMIN_EXIT=1`, `PROBE_REFRESH=1`, `PROBE_OFFLINE=1` (kryteria w ROADMAP.md, faza 6).
- Testy jednostkowe Vitest dla projekcji z planu, przesunięcia planu (pauza, „Następne"), decyzji zamiatacza.

### Claude's Discretion
- Kształt planu w bazie (`jsonb` w `quiz_sessions` vs osobna tabela).
- Podział na plany wykonawcze i kolejność w obrębie kolejności z research (kroki 1–6).
- Filtr próbek zegara w stylu timesync.
</decisions>

<specifics>
## Specific Ideas

- Kryterium, które użytkownik uznaje za „mechanicznie nie do podważenia": admin zamyka przeglądarkę, quiz dochodzi do końca identycznie wszędzie; odświeżenie u uczestnika nic nie zmienia.
- Wzorzec referencyjny: buzrr (`ARCHITECTURE.md`) — „the countdown never drives a transition", snapshot przy reconnect, backstop odpalający zaległe przejścia.
- Formatu pytań TWE: maks. 20 s na pytanie, `REVEAL_SECONDS = 6`, zapowiedź modułu 30 s, odliczanie 4 s.
</specifics>

<deferred>
## Deferred Ideas

- Ekran admina dla rozłączonych/utkniętych uczestników z akcją `releaseCode` — osobny `/gsd:quick`.
- Wyjaśnienie ~70 s zawieszenia na ostatnim pytaniu z sondy — powinno zniknąć z konstrukcji (przejście do wyników przez zamiatacz); jeśli po fazie 6 nadal występuje, osobne `/gsd:debug`.
- Plan Supabase Pro + limit połączeń przed realnym 500 — decyzja budżetowa, poza kodem.
</deferred>
