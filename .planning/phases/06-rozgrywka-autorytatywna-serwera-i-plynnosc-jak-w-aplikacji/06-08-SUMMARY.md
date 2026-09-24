---
phase: 06-rozgrywka-autorytatywna-serwera-i-plynnosc-jak-w-aplikacji
plan: 08
subsystem: e2e-probe
tags: [playwright, probe, production, sc1, sc2, sc3, sc5, refresh, offline, pg_cron]
requires: ["06-03", "06-05", "06-06", "06-07"]
provides:
  - "scripts/probe-gameplay.js — tryby PROBE_ADMIN_EXIT / PROBE_REFRESH / PROBE_OFFLINE, odczyt data-fue-*, plan z session_plans, offset zegara server_now, monitor wiersza sesji, asercja SC5, sprzątanie planu"
  - "Zielone przebiegi sondy na produkcji (ytbwmmqwbfcugouourih) z lokalnym buildem nowego frontu: podstawowy, ADMIN_EXIT, REFRESH, OFFLINE (+ FULL)"
  - "Poprawka klienta: refresh bez mignięcia poczekalni i z blokadą odpowiedzi od pierwszej klatki"
affects: [06-09, 06-10, 06-11]
tech-stack:
  added: []
  patterns: ["asercje sondy w czasie serwera (offset z server_now)", "MutationObserver na data-fue-* łapie mignięcia krótsze niż tick próbkowania", "cache gry z myAnswers + ponowny zapis wpisów pending po restore"]
key-files:
  created: []
  modified: [scripts/probe-gameplay.js, src/hooks/useParticipantGame.js, src/lib/participantState.js]
key-decisions:
  - "Sonda porównuje telefony tylko z dala od granic faz planu (±700 ms) i traktuje finished≡results — status results ustawia zamiatacz ≤ ~1,3 s po ostatnim reveal"
  - "Asercje startu pytań, idx w bazie i results od zamiatacza działają w KAŻDYM trybie, nie tylko w ADMIN_EXIT"
  - "fue_game_cache przechowuje myAnswers; restorowane wpisy pending są wysyłane ponownie (serwer rozstrzyga duplikat/termin)"
requirements-completed: [P6-SC1, P6-SC2, P6-SC3, P6-SC5]
duration: ~70 min
completed: 2026-09-24
---

# Phase 6 Plan 08: Sonda — tryby SC1/SC2/SC3 + SC5 i przebieg na produkcji Summary

**Sonda Playwright zna już nowego klienta. Czyta `data-fue-*`, oczekiwane czasy bierze z zamrożonego planu i zegara serwera, a na każdym przebiegu pilnuje SC5 i zgodności bazy z planem. Ma też trzy tryby z ROADMAP. Na produkcji, z lokalnym buildem nowego frontu, wszystkie cztery wymagane przebiegi kończą się kodem 0. REFRESH wykrył dwa realne błędy klienta przy refreshu i oba zostały naprawione. Anomalia D6 na ostatnim pytaniu nie występuje.**

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | Zmiany bazowe sondy: localStorage, READ z data-fue-*, plan, SC5, sprzątanie planu | 193495d |
| 2 | Tryby PROBE_ADMIN_EXIT / PROBE_REFRESH / PROBE_OFFLINE (+ fix detektora postgres_changes) | 9749b37 |
| 3 | Przebiegi na produkcji; poprawka klienta (refresh) | 1c340e4 (klient), 7aca0b3 (sonda: MutationObserver), 814b1ca (sonda: poczekalnia w FULL) |

## Wyniki przebiegów (produkcja `ytbwmmqwbfcugouourih`, `vite preview` :4173, Kraków, 3 pytania × 20 s, 2 telefony)

Wszystkie przebiegi są na finalnym buildzie (po poprawce `1c340e4`).

| Tryb | Kod | Start pytania vs plan (maks.) | Telefon vs telefon | Idx w bazie vs plan | `results` od zamiatacza | SC5 | Sprzątanie |
|---|---|---|---|---|---|---|---|
| podstawowy | **0** | 287 ms | ≤ 1 s | 96/96 | +1062 ms po r[last] | OK (21 asercji, submit ×3) | pytania 0, kody 0, plany 0 |
| ADMIN_EXIT | **0** | 243 ms (limit 1500) | 0 s | 96/96 | +1266 ms (limit 3000) | OK (21, ×3) | 0 / 0 / 0 |
| REFRESH | **0** | 288 ms | ≤ 1 s | 93/93 | +953 ms | OK (21, ×3) | 0 / 0 / 0 |
| OFFLINE | **0** | 196 ms | 0 s | 96/96 | +1139 ms | OK (21, ×3) | 0 / 0 / 0 |
| FULL (opcjonalny; 10 pytań, 5 modułów, tpq 20 s) | **0** (2. przebieg) | 264 ms | 0 s | 403/403 | +928 ms | OK (70 asercji, submit ×10) | 0 / 0 / 0 |

**FULL:** komplet etapów ✅: poczekalnia (odczyt przed startem), 5 zapowiedzi modułów, pytania 25,1–25,9 s przy planie 26 s, pauza w pyt.5 widoczna u uczestnika, wznowienie z tą samą fazą i pytaniem i licznikiem ±1 s (t1/t2: quiz q5 15 s → pauza 15 s → quiz q5 14 s), wyniki od zamiatacza bez „Ogłoś wyniki”, ekran wyniku. Pierwszy przebieg FULL skończył się kodem 1 z jednym FAIL-em „etap nieosiągnięty: poczekalnia”. To artefakt sondy, bo próbkowanie rusza dopiero po kliknięciu Start (poprawka `814b1ca`). Wszystkie pozostałe metryki pierwszego przebiegu też były zielone.

**SC1 (ADMIN_EXIT):** przeglądarka admina zamknięta zaraz po potwierdzeniu `running` i kotwicy. Oba telefony przeszły wszystkie 3 pytania (czas widoczności 25,6–25,8 s przy planie 26 s), dotarły do `finished`/`results`, a status `results` ustawił zamiatacz. Wiersze raportu „Bez admina: wszystkie pytania na czas ✅” i „Bez admina: wyniki ustawione przez zamiatacz ✅”.

**SC2 (REFRESH), telefon 2 vs telefon 1:**

| Faza reloadu | Powrót (reload → faza ≠ loading) | Różnica licznika po refreshu | Fazy po reloadzie (MutationObserver) |
|---|---|---|---|
| intro pyt.1 | 234 ms | 0 s | intro |
| quiz pyt.1 przed odpowiedzią | 222 ms | 0 s | quiz |
| countdown pyt.2 | 57 ms | 0 s | countdown |
| quiz pyt.2 po odpowiedzi | 312 ms | 0 s; wybór zablokowany od 1. klatki | quiz |
| reveal pyt.3 | 119 ms | 0 s | reveal→finished |

Maksymalna różnica licznika po refreshu wynosi **0 s** (limit 1 s).

**SC3 (OFFLINE):** telefon 2 był offline 10 s, od 5,0 s po otwarciu pytania 2, i w tym czasie kliknął odpowiedź C. UI zablokował ją od razu. Przez cały czas offline różnica licznika z telefonem 1 wynosiła 0 s. Pełna zgodność wróciła 135 ms po powrocie. Wariant: powrót 6,5 s przed bramką, więc odpowiedź musiała trafić do bazy. W `answers` jest `chosen = C`.

**SC5:** w każdym przebiegu sprawdzane jest 21 asercji: snapshot (`reveal`, `my_answers.is_correct`) i `get_answer_summary_v2` w 1. sekundzie pytania oraz po zablokowaniu odpowiedzi, a do tego body każdej odpowiedzi `submit_answer_v2`. Żadna nie ujawniła poprawności przed bramką (closes + 1,5 s).

**D6 (ostatnie pytanie):** nie występuje. Ślad z przebiegu podstawowego pokazuje oba telefony na pytaniu 3 synchronicznie: 20→0 s, potem reveal 6→1, `finished` w 96,2 s i `results` w 96,4 s. Najdłuższy czas w pytaniu to 19,7–19,9 s (w starym buildzie 77,9 s), a różnica licznika między telefonami ≤ 1 s (w starym buildzie 70 s).

Po wszystkich przebiegach `npm run verify-prod` daje kod 0 („PRODUKCJA GOTOWA pod kątem SQL (40 OK)”), a `verify-plan` 29/29. Odczyt kontrolny (svc, read-only): sesja Krakowa `waiting / idx 0 / plan_anchor_at null / plan_paused_at null / revealed_idx null`, `session_plans` 0, pytania `[SONDA]` 0, kody `PRB-` 0, profile sondy 0, czasy modułów przywrócone (20/30/60/75/20). Preview na :4173 zatrzymany (port wolny).

## Co się zmieniło w sondzie

- Uczestnik jest wstrzykiwany do `localStorage.fue_participant` (`sessionId: null`), tylko gdy klucza brak. Dzięki temu reload testuje prawdziwy restore.
- `READ` czyta `document.body.dataset.fue*` (`phase/q/remaining/locked/choice`), a regexy zostają jako fallback dla panelu admina. `normPhase` sprowadza nazwy ze starego bundla do kanonicznych.
- Plan z `session_plans` i kotwica z bazy po `running`. Brak planu kończy się FAIL „sesja bez planu”. Offset zegara jest liczony przez RPC `server_now` (pasmo min-RTT, jak w aplikacji), a wszystkie asercje czasu działają w czasie serwera.
- Monitor wiersza sesji co 1 s: `current_question_idx` zgodny z `planPosition` (tolerancja 1,5 s) i moment `status='results'`.
- SC5: przechwytywanie odpowiedzi `submit_answer_v2` na telefonie 1 oraz anonimowe `get_participant_state`/`get_answer_summary_v2` w fazie quiz.
- FULL nie wymaga już pauzy przed wynikami. Pauza w połowie sprawdza, czy po wznowieniu faza, pytanie i licznik zgadzają się ze stanem sprzed pauzy (±1 s).
- `cleanup()` usuwa `session_plans` sesji testowej (i odtwarza plan sprzed testu, jeśli był) oraz przywraca `plan_anchor_at/plan_paused_at/revealed_idx/revealed_ans`. Raport: „plany sondy: N”.
- MutationObserver na `data-fue-phase/q/locked` w telefonach: po każdym reloadzie żadna faza (poza `loading`) nie może różnić się od telefonu 1, a wybrana odpowiedź ma być zablokowana od 1. klatki.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug, sonda] Detektor `postgres_changes` nie rozumiał protokołu realtime-js vsn 2.0.0**
- **Found during:** Task 3 (pierwszy przebieg podstawowy)
- **Issue:** realtime-js 2.104 wysyła ramki jako tablice `[join_ref, ref, topic, "postgres_changes", payload]`. Sonda szukała `"event":"postgres_changes"` (vsn 1.0.0), więc zmiany wiersza sesji od zamiatacza były niewidoczne i sonda zgłaszała fałszywe „GŁUCHY” (1 zdarzenie / 3 pytania)
- **Fix:** regex obsługuje oba formaty; po poprawce jest 7–9 zdarzeń na 3 pytania
- **Files modified:** scripts/probe-gameplay.js
- **Commit:** 9749b37

**2. [Rule 1 - Bug, klient] Po refreshu przez chwilę widać poczekalnię zamiast bieżącej fazy**
- **Found during:** Task 3, REFRESH (reload w intro pyt.1: próbka `lobby` 300 ms po reloadzie)
- **Issue:** po reloadzie App startuje z `screen="welcome"`, więc hook dostaje `participant=null` (pusty stan, `loadState="idle"`). W pierwszym renderze z `screen="game"` stan jest jeszcze pusty i `no_session` mapuje się na `lobby`. Efekt montażu ustawiał potem stan z cache przez `commit` → `pushView`, a przy zmianie strukturalnej `setView` czekał na asynchroniczny callback View Transition. W tym czasie `view` pozostawał `no_session`
- **Fix:** `useParticipantGame` liczy render po zmianie uczestnika wprost z cache (czysto, bez zapisu stanu), a reinit w efekcie montażu ustawia `game`/`view` bezpośrednio, bez View Transition
- **Files modified:** src/hooks/useParticipantGame.js
- **Commit:** 1c340e4

**3. [Rule 1 - Bug, klient] Po refreshu udzielona odpowiedź przez ~200 ms była odblokowana**
- **Found during:** Task 3, REFRESH (quiz pyt.2 po odpowiedzi: `locked=false, wybór null` w pierwszej próbce po reloadzie; zależne od timingu)
- **Issue:** `fue_game_cache` trzymał tylko plan i sesję. `myAnswers` wracały dopiero ze snapshotu, więc uczestnik widział aktywne kafle i mógł kliknąć ponownie, co narusza SC2
- **Fix:** `saveGameCache` zapisuje `myAnswers` (wywołanie bez nich zachowuje te z cache), `initialGame` je odtwarza, a `setAnswer` zapisuje cache przy każdej zmianie. Wpisy `pending` przywrócone z cache są wysyłane ponownie przez wydzielony `runSubmit` (jeden zapis w locie na pytanie). Serwer zwraca duplikat z oryginalnym wyborem albo, po terminie, `failed`, więc wpis nie wisi jako „Zapisywanie…”
- **Files modified:** src/hooks/useParticipantGame.js, src/lib/participantState.js
- **Commit:** 1c340e4

**4. [Rule 2 - Correctness, sonda] Próbkowanie co 250 ms gubi jednoklatkowe mignięcia**
- **Found during:** Task 3 (po poprawce 2)
- **Fix:** historia każdej zmiany `data-fue-*` z MutationObservera (init script), sprawdzana po każdym reloadzie. Pierwsza wersja obserwowała `document.documentElement`, który w init scripcie jeszcze nie istnieje (pageerror). Poprawione na `document`
- **Commit:** 7aca0b3

**5. [Rule 1 - Bug, sonda] FULL: etap „poczekalnia” niewidoczny.** Pętla próbkowania startuje po kliknięciu Start. Poprawka: telefony są odczytywane raz przed startem (`state.preStart`, log „przed startem: t1 lobby, t2 lobby”). Commit 814b1ca.

**6. [Rozszerzenie zakresu asercji, sonda]** Start pytań względem planu (≤ 1,5 s), zgodność `current_question_idx` z planem i `results` od zamiatacza w ≤ 3 s są oceniane w każdym trybie, nie tylko w ADMIN_EXIT. Porównanie telefonów obejmuje wszystkie fazy z licznikiem (intro/countdown/quiz/reveal/paused), a nie tylko quiz. Czas widoczności pytania to quiz + reveal z planu (r − o), z tolerancją 2 s (wcześniej 5 s).

Poprawki klienta mieszczą się w `files_modified` planu (`useParticipantGame.js`, `participantState.js`). Nie było zmian w SQL ani na produkcji poza danymi sondy, które zostały posprzątane.

## Verification

- `npm test`: 5 plików, 139 testów zielonych (po poprawce klienta)
- `npm run build`: przechodzi
- `npm run verify-prod`: kod 0 (40 OK) przed przebiegami i po nich. `npm run verify-plan`: 29/29
- `node --check scripts/probe-gameplay.js`: OK. Grepy akceptacji: `localStorage.setItem("fue_participant"` → 1, `sessionStorage.setItem("fue_participant"` → 0, `dataset.fuePhase` ≥ 1, `session_plans` ≥ 2, `is_correct|correct_ans` ≥ 2, `PROBE_TARGET=prod` w nagłówku, `PROBE_ADMIN_EXIT|PROBE_REFRESH|PROBE_OFFLINE` ≥ 6, `ctxAdmin.close()`, `setOffline(true)`, `.reload(`, „różnica licznika po refreshu”

## Known Stubs

Brak.

## Self-Check: PASSED
- FOUND: scripts/probe-gameplay.js, src/hooks/useParticipantGame.js, src/lib/participantState.js, 06-08-SUMMARY.md
- FOUND: commity 193495d, 9749b37, 1c340e4, 7aca0b3, 814b1ca
- `git diff --stat` planu: tylko pliki z `files_modified` (sonda, useParticipantGame.js, participantState.js)
- verify-prod kod 0 (40 OK) po przebiegach; produkcja bez resztek sondy; port 4173 wolny
