---
phase: 06-rozgrywka-autorytatywna-serwera-i-plynnosc-jak-w-aplikacji
plan: 13
subsystem: probe-diagnostics
tags: [sonda, playwright, diagnoza, gap-closure, production, pauza, view-transitions, zegar]
requires: ["06-12"]
provides:
  - "Tryb sondy PROBE_PAUSE_PHASE=reveal|countdown (PROBE_PAUSE_Q, PROBE_PAUSE_HOLD_MS): pauza w zadanej fazie, asercje P1–P6, kod 2 = przebieg niewykonany"
  - "PROBE_TRACE: ślad przyczynowy per telefon (startViewTransition __fueVT, dziennik zegara __fueClockLog, snapshoty get_participant_state vs wiersze Realtime) + sekcja DIAGNOZA i zrzut test-results/probe-trace-*.json"
  - "Start pytania liczony z chwili zmiany data-fue-phase w DOM (devDom), próbka tylko jako fallback"
  - "Globalna asercja ciągłości current_question_idx (+1); PROBE_FULL przechodzi przez przerwy planowe po modułach 2 i 4"
  - "serverClock.js: pasywny dziennik próbek (globalThis.__fueClockLog, tylko gdy tablica istnieje)"
  - "06-DIAG-G2-G7.md: 11 przebiegów na produkcji i werdykty H1–H6 — wejście dla 06-16"
affects: [06-16]
tech-stack:
  added: []
  patterns: ["pasywny hook diagnostyczny aktywowany przez init script sondy (globalThis.__fueClockLog) — zero kosztu w produkcji", "kod wyjścia 0/1/2 sondy (PASS / FAIL / przebieg niewykonany — powtórz)"]
key-files:
  created: [.planning/phases/06-rozgrywka-autorytatywna-serwera-i-plynnosc-jak-w-aplikacji/06-DIAG-G2-G7.md]
  modified: [scripts/probe-gameplay.js, src/lib/serverClock.js, src/lib/serverClock.test.js]
key-decisions:
  - "G2 i G7 nie odtworzyły się w 11 przebiegach na produkcji; H2 i H5 obalone, H1/H3/H6 nierozstrzygnięte przy czystych wskaźnikach"
  - "H4 (confirm() przed pauzą) to najbardziej prawdopodobna przyczyna G2 — sonda auto-akceptuje confirm, więc ludzkiej latencji nie mierzy; 06-16: uzbrajany przycisk zamiast confirm + komunikat, gdzie pauza wylądowała"
  - "Kryterium startu pytania w sondzie liczone z DOM (MutationObserver), bo próbka co 250 ms jest systematycznie późniejsza o 5–300 ms (wspólny tick dla obu telefonów)"
requirements-completed: [P6-GAP-PAUSE, P6-GAP-FLAKY]
duration: ~112 min (z oczekiwaniem na zgodę na sondy)
completed: 2026-09-27
---

# Phase 6 Plan 13: Diagnoza G2/G7 — sonda z pauzą w fazie i śladem przyczynowym — Summary

**Sonda umie teraz pauzować w odsłonięciu i w odliczaniu (asercje P1–P6), a przy PROBE_TRACE zapisuje ślad przyczynowy: View Transitions, offset zegara telefonu, świeżość snapshotu względem Realtime i dokładną chwilę zmiany fazy w DOM. Wykonałem 11 przebiegów na produkcji: 5 podstawowych i 6 z pauzą (reveal/countdown, tpq 20 i 60). Ani G2, ani G7 się nie odtworzyły. Start pytania mieścił się w ≤ 91 ms od planu (DOM), wszystkie pauzy przeszły P1–P5. Werdykty H1–H6 i zalecenia dla 06-16 są w `06-DIAG-G2-G7.md`. Najbardziej prawdopodobna przyczyna G2 to H4: człowiek czyta okno `confirm()`, zanim pauza trafi do bazy.**

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | Sonda: PROBE_PAUSE_PHASE (reveal/countdown) + przerwy planowe w PROBE_FULL | bae8c50 |
| 2 | PROBE_TRACE: VT, zegar, snapshot vs Realtime, start z DOM + pasywny dziennik zegara | 92e3770 |
| 3 | Zgoda „sondy OK” → 11 przebiegów na produkcji → 06-DIAG-G2-G7.md | aecdc01 (poprawka parsera w trakcie serii), b63ffb9 (DIAG) |

## Co powstało

- **`scripts/probe-gameplay.js`**
  - `pausePhaseScenario` liczy okno kliknięcia na bieżąco (auto-skrót i zmiana kotwicy przesuwają terminy). Sprawdza, gdzie pauza REALNIE wylądowała (`planPosition` w `plan_paused_at`) i oblicza chwilę wznowienia z przesunięcia kotwicy.
  - Asercje P1–P5 opierają się na historii DOM telefonu, a P3 liczy stan od nowej kotwicy w chwili próbki. P6 zapisuje czas klik→baza i fazę lądowania.
  - Monitor czyta `select("*")` razem z `plan_hold_idx`, a sprzątanie przywraca `plan_hold_idx`.
  - Nowa asercja: sekwencja idx w bazie musi rosnąć dokładnie o 1.
  - FULL klika „Wznów quiz” po każdej przerwie planowej i dodaje do raportu etap „przerwy planowe po modułach 2 i 4”.
  - PROBE_TRACE daje sekcję `🔍 DIAGNOZA (PROBE_TRACE)` (H1/H2/H4/H5/H6) i zrzut JSON.
- **`src/lib/serverClock.js`**: `traceClock()` wywoływany w `addClockSample` („snap”) i `syncServerClock` („sync”). Pisze tylko wtedy, gdy `globalThis.__fueClockLog` jest tablicą. Test w `serverClock.test.js`.

## Wyniki serii (skrót, pełna tabela w DIAG)

- Build: HEAD `92e3770` (zawiera 06-15 do `c74421b`). Przed serią `verify-prod` = 0 (54 ✅, sekcje 42 i 43).
- 5 przebiegów podstawowych: kod 0. Start DOM ≤ 80 ms, próbka ≤ 316 ms, idx zgodny z planem w 100% odczytów.
- 4 przebiegi pauzy przy tpq 20 (reveal ×2, countdown ×2): kod 0, P1–P5 ✅, klik→baza 141–189 ms.
- 2 przebiegi pauzy przy tpq 60 (auto-skrót aktywny: 3 skróty na przebieg): P1–P5 ✅, idx 160/160 i 159/159. Kod 1 wynika wyłącznie z kontroli widoczności pytań, która nie uwzględnia auto-skrótu (ograniczenie sondy, opisane w DIAG).
- Przebiegów niewykonanych (kod 2): 0. Po każdym przebiegu `check-planless` = 0, sprzątanie „czysto”, czasy modułów przywrócone 20/30/60/75/20.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Parser ramek Realtime w PROBE_TRACE nie rozpoznawał wiersza sesji**
- **Found during:** Task 3 (przebieg 01)
- **Issue:** Rekord w ramce `postgres_changes` ma spację po dwukropku (`"status": "running"`), więc regex nie trafiał. Wszystkie wiersze miały `status: null`, a detektor H1 pokazał 2 fałszywe „stare snapshoty”.
- **Fix:** `JSON.parse` ramki (vsn 2.0 i 1.0), regex tolerujący białe znaki jako fallback, pomijanie ramek bez rozpoznanego wiersza. Dodatkowo zrzut pierwszych surowych ramek (`rawFrames`).
- **Files modified:** scripts/probe-gameplay.js
- **Commit:** aecdc01. Przebiegi 01–02 nie mają danych H1, co jest oznaczone w DIAG.

**2. [Rule 1 - Bug] Domyślny RUN_MS dla PROBE_PAUSE_PHASE: 360000 zamiast 240000**
- **Found during:** Task 1
- **Issue:** Przy `PROBE_TPQ=60` sam plan 3 pytań trwa ~233 s, a z pauzą 8 s przekracza 240 s, więc przebieg zostałby ucięty.
- **Fix:** Domyślnie 360000 ms. Pętla i tak kończy się na ekranie wyników.
- **Commit:** bae8c50

**3. [Rule 2] Uzupełnienia trybu pauzy**
- Przy PAUSE_PHASE razem z FULL własna pauza FULL jest wyłączona, a raport pomija jej etapy.
- Odliczanie przed pierwszym pytaniem modułu jest rozpoznawane jako faza `intro`.
- Chwila wznowienia jest liczona z przesunięcia kotwicy, z fallbackiem na odczyt monitora.
- Kod 2 ma pierwszeństwo przed 1.
- **Commit:** bae8c50

## Known Stubs

Brak.

## Deferred Issues

- Kontrola „czas widoczności pytań” w sondzie nie uwzględnia auto-skrótu przy tpq ≥ 45 s i daje fałszywe FAIL. Zalecenie w DIAG (obserwacja 1) do wykonania w 06-16 albo przy następnej zmianie sondy.

## Self-Check: PASSED

- FOUND: scripts/probe-gameplay.js, src/lib/serverClock.js, src/lib/serverClock.test.js, 06-DIAG-G2-G7.md
- FOUND commits: bae8c50, 92e3770, aecdc01, b63ffb9
- `node --check` OK, `npx vitest run` 170/170, `npm run build` 0, `check-planless` 0 po serii
