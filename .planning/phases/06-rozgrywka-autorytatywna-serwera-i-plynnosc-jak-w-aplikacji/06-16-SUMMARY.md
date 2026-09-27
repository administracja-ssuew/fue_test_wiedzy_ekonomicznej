---
phase: 06-rozgrywka-autorytatywna-serwera-i-plynnosc-jak-w-aplikacji
plan: 16
subsystem: gameplay-sync
tags: [react, realtime, view-transitions, admin-panel, breaks, pause, gap-closure, vitest]
requires: ["06-13", "06-14", "06-15"]
provides:
  - "participantState: CONTROL_FIELDS + applySnapshot(prev, n, { keepControl }) — stary snapshot nie nadpisuje pól sterujących z Realtime"
  - "useParticipantGame: rowSeqRef (licznik wierszy Realtime), natychmiastowy ponowny snapshot po keepControl"
  - "useParticipantGame.pushView: brak nakładania View Transitions (vtRef), limit VT_MAX_DELAY_MS = 150 ms + skipTransition, catch ready/updateCallbackDone"
  - "AdminPanel: auto-skrót tylko dla idx sprzed await i tylko w fazie quiz; goToNextQuestion(expectedIdx)"
  - "AdminPanel: baner „Przerwa planowa po module X”, złoty „▶ Wznów quiz” w przerwie, linia „Wstrzymano: faza + pytanie · zostało N s” w pauzie ręcznej"
  - "AdminPanel LiveTab: przerwa planowa z następnym modułem (breakNext) — domknięcie deferred z 06-15"
  - "Testy regresyjne: pauza na granicach faz (legacy + v2), pauza przed/po przerwie planowej, keepControl"
affects: [06-17]
tech-stack:
  added: []
  patterns:
    - "licznik sekwencji zdarzeń Realtime jako znacznik świeżości odpowiedzi RPC (seq przed await vs po await)"
    - "View Transition z twardym limitem opóźnienia fazy (setTimeout → skipTransition + setView z refa)"
    - "stan oceniony przed await jest ponownie weryfikowany po await przed akcją zapisu"
key-files:
  created: []
  modified:
    - src/lib/participantState.js
    - src/lib/participantState.test.js
    - src/hooks/useParticipantGame.js
    - src/lib/plan.test.js
    - src/screens/AdminPanel.jsx
    - .planning/phases/06-rozgrywka-autorytatywna-serwera-i-plynnosc-jak-w-aplikacji/06-VALIDATION.md
    - .planning/phases/06-rozgrywka-autorytatywna-serwera-i-plynnosc-jak-w-aplikacji/deferred-items.md
key-decisions:
  - "H4 = NIEROZSTRZYGNIĘTA w 06-DIAG → confirm() przed pauzą zostaje (plan: zmiana UX tylko przy POTWIERDZONA); zamiast tego panel pokazuje, w jakiej fazie i przy którym pytaniu pauza realnie wylądowała"
  - "Poprawki H1 (keepControl), H2 (limit VT 150 ms) i H3 (idx sprzed await) wdrożone defensywnie niezależnie od werdyktów"
  - "H5 OBALONA → bez filtra RTT w addClockSample"
  - "Auto-skrót: liveStats aktualizowane dalej w odsłonie tego samego pytania; bramka fazy quiz dotyczy tylko samego skrótu"
requirements-completed: [P6-GAP-PAUSE, P6-GAP-FLAKY, P6-GAP-BREAKS, P6-SC5]
duration: ~25 min
completed: 2026-09-27
---

# Phase 6 Plan 16: Naprawy G2/G7 wg 06-DIAG, panel przerwy planowej, testy regresyjne pauzy — Summary

**Telefon nie cofa już pauzy ani wznowienia starym snapshotem, bo wiersz Realtime odebrany w trakcie RPC ma pierwszeństwo, a snapshot jest od razu pobierany ponownie. Zmiana fazy nie czeka na View Transition dłużej niż 150 ms. Auto-skrót w panelu skraca tylko pytanie, dla którego policzył statystyki. W przerwie planowej admin widzi żółty baner i duży złoty przycisk „▶ Wznów quiz”, a w pauzie ręcznej informację, w jakiej fazie quiz stanął.**

## Zadania

| Task | Nazwa | Commit |
| ---- | ----- | ------ |
| 1 (RED) | Testy keepControl + pauza na granicach faz (legacy/v2) + przypadki przerwy planowej | c3561c7 |
| 1 (GREEN) | CONTROL_FIELDS/keepControl, rowSeqRef + ponowny snapshot, bezpieczny pushView, wiersze V-16…V-19 | fccde16 |
| 2 | AdminPanel: auto-skrót z idx sprzed await, baner przerwy, faza pauzy, LiveTab z breakNext | 281bc10 |

## Działanie poprawek w zależności od werdyktów 06-DIAG

| H | Werdykt | Co zrobiono |
|---|---------|-------------|
| H1 — stary snapshot | NIEROZSTRZYGNIĘTA | **Poprawka defensywna.** `rowSeqRef` liczy wiersze Realtime. Jeśli podczas RPC `get_participant_state` przyszedł wiersz, `applySnapshot(..., { keepControl: true })` zostawia pola sterujące (`status`, `plan_anchor_at`, `plan_paused_at`, `plan_hold_idx`, `revealed_*`) z Realtime, a reszta (odpowiedzi, reveal, plan) pochodzi ze snapshotu. Zaraz potem idzie kolejny snapshot, bez czekania 15 s na siatkę bezpieczeństwa. |
| H2 — View Transition | OBALONA | **Poprawka defensywna** (plan wymaga jej niezależnie od werdyktu). Nowe przejście nie startuje, gdy trwa poprzednie (`vtRef`). Jeśli callback nie ruszy w ciągu 150 ms, wywołujemy `skipTransition()` i ustawiamy widok wprost. Timer idzie przez `later()`, więc sprząta się przy odmontowaniu. |
| H3 — auto-skrót | NIEROZSTRZYGNIĘTA | **Poprawka defensywna.** Po `await getLiveAnswerSummary` panel ponownie liczy `planPos()`. Przy innym pytaniu przerywa. Skrót wykonuje tylko wtedy, gdy to samo pytanie jest nadal w fazie `quiz`, a sesja ma status `running`. Woła `goToNextRef.current(idx)`. |
| H4 — `confirm()` przed pauzą | NIEROZSTRZYGNIĘTA (najbardziej prawdopodobna przyczyna G2) | **H4 nie potwierdzona, więc zabezpieczenie pauzy zostaje bez zmian** (`confirm("Czy na pewno chcesz zatrzymać quiz?")`), bo plan wiąże zmianę UX z werdyktem POTWIERDZONA. Zamiast tego panel pokazuje pod statusem „Wstrzymano: odsłona pytania 2 · zostało 3 s” (albo zapowiedź / odliczanie / pytanie). Spóźniona pauza nie wygląda już jak „zniknięte pytanie”. |
| H5 — skok zegara | OBALONA | Bez zmian w `addClockSample` (filtr RTT niepotrzebny). |
| H6 — artefakt sondy | NIEROZSTRZYGNIĘTA | Nic do zrobienia w aplikacji. Sonda liczy start z DOM, co rozstrzygnie sprawę w 06-17. |

**G7:** nie ma poprawki przyczynowej, bo zjawisko nie wystąpiło w 11 przebiegach (start ≤ 91 ms według DOM). Pośrednio może pomóc limit VT 150 ms. Weryfikacja: ≥ 5 przebiegów podstawowych w 06-17.

## Co się zmieniło

- **`participantState.js`:** `export const CONTROL_FIELDS` (`ROW_FIELDS` jest teraz aliasem, więc lista pól wiersza Realtime istnieje w jednym miejscu). `applySnapshot` przyjmuje trzeci argument `{ keepControl }`. Przy przełączeniu sesji (`switched`) opcja jest ignorowana.
- **`useParticipantGame.js`:**
  - `onRow` zwiększa `rowSeqRef` na początku.
  - `snapshot()` porównuje `seq0` z wartością po odpowiedzi i przy `keepControl` ustawia `needFresh`. Kolejne wywołanie trafia do `pendingRef` tylko wtedy, gdy nic innego nie czeka i nie jest potrzebny plan.
  - `pushView`: stała `VT_MAX_DELAY_MS = 150` i `vtRef`, `finished.then(clear, clear)` oraz `ready`/`updateCallbackDone` z `.catch`.
  - `later` przeniesiony nad `pushView`, bo `pushView` z niego korzysta.
- **`AdminPanel.jsx` (SesjaTab):** import `breakIdxAt`. `breakIdx` jest liczone przy renderze ze stanu sesji i `serverNow()`, `pausedUnder` z `planPosition(plan, anchor, null, plan_paused_at)`. Doszedł baner przerwy (tło `rgba(245,197,24,.12)`, kolor `#F5C518`) i przycisk „▶ Wznów quiz” w stylu `gold` (flex 2, 18 px) podczas przerwy. W innej pauzie ma styl `success`, a tekst przycisku się nie zmienił, żeby sonda nadal go znajdowała.
- **`AdminPanel.jsx` (LiveTab):** przy `phase === "paused" && breakNext` pokazuje „☕ Przerwa — po przerwie: {icon} Moduł {id} — {name}”. Ręczna pauza wyświetla się jak wcześniej. Pozycja w `deferred-items.md` oznaczona jako zrobiona.
- **Testy:** `participantState.test.js` ma 6 nowych testów (CONTROL_FIELDS, keepControl, tylko klucze obecne w prev, brak opcji, switched, projekcja → paused). `plan.test.js` ma `describe("pauza na granicach faz (G2)")`: 2 plany × 2 pytania × 6 chwil (c, c+1500, r−1, r, o₊₁−1, o₊₁) = 24 przypadki. Do tego 2 przypadki v2: ręczna pauza w odsłonie przed przerwą planową (przerwa nie przepada) oraz pauza w zapowiedzi modułu 3 po zużytej przerwie (intro 3, 18 500 ms).
- **`06-VALIDATION.md`:** wiersze V-16…V-19, status ⬜ pending (06-17 ustawi wynik). W V-19 zamiast `reveal|countdown` wpisane są dwie osobne komendy, bo `|` psułby tabelę Markdown.

## Weryfikacja

- `npx vitest run src/lib/participantState.test.js src/lib/plan.test.js`: 153/153. W fazie RED 4 testy keepControl nie przechodziły, a testy granic pauzy przeszły od razu, bo to regresje istniejącej logiki.
- `npm test`: 202/202 (6 plików). `npm run build`: OK po każdym zadaniu.
- Kryteria grep z planu:
  - `export const CONTROL_FIELDS` = 1, `keepControl` w participantState = 3.
  - `rowSeqRef` = 4, `keepControl` w hooku = 3.
  - `VT_MAX_DELAY_MS` = 3, `vtRef` = 5, `skipTransition` = 1.
  - „pauza na granicach faz” = 1, `| V-1[6-9] |` = 4.
  - `goToNextRef.current(idx)` = 1, `posNow.idx !== idx` = 1.
  - „Czy na pewno chcesz zatrzymać quiz” = 1 (gałąź H4 ≠ POTWIERDZONA), „Kliknij ponownie, aby wstrzymać” = 0.
  - „Przerwa planowa po module” = 1, „▶ Wznów quiz” = 3, `breakIdxAt(` = 1.
- Nic nie było uruchamiane na produkcji. Sondy zamykające są w 06-17.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — zgodnie z „Inne przyczyny” 06-DIAG, obs. 2] Nieobsłużone odrzucenie View Transition**
- **Found during:** Task 1
- **Issue:** `startViewTransition` bez `.catch` na `ready`/`updateCallbackDone`: pominięte przejście dawało `pageerror: Transition was skipped` (06-DIAG, przebieg 01).
- **Fix:** `vt.ready?.catch?.(() => {})`, `vt.updateCallbackDone?.catch?.(() => {})`, `finished.then(clear, clear)`.
- **Files modified:** src/hooks/useParticipantGame.js
- **Commit:** fccde16

**2. [Rule 1] Auto-skrót: bramka fazy tylko dla skrótu, nie dla licznika odpowiedzi**
- **Found during:** Task 2
- **Issue:** Plan przewidywał `return` po `await`, gdy faza ≠ `quiz`. Wtedy `setLiveStats` i śledzenie plateau zatrzymałyby się w odsłonie tego samego pytania, a dotąd licznik „⏭ Następne (x/y)” i statystyki odświeżały się także w odsłonie (odpowiedzi ze strefy tolerancji 1,5 s).
- **Fix:** `if (!posNow || posNow.idx !== idx) return;` (inne pytanie → nic nie liczymy) oraz `canSkip = posNow.phase === "quiz" && status === "running"` jako warunek samego skrótu. Skutek dla H3 jest ten sam (skrót tylko dla idx w fazie quiz), a licznik nie traci danych.
- **Files modified:** src/screens/AdminPanel.jsx
- **Commit:** 281bc10

**3. [Zakres z orkiestratora] LiveTab w przerwie planowej (deferred z 06-15)**
- Dopisane w tym planie, bo `AdminPanel.jsx` należał w tej fali do 06-16. Commit 281bc10.

### Drobne doprecyzowania

- Linia pauzy ręcznej pokazuje też „· zostało N s” (zalecenie z 06-DIAG: „Pauza: odsłonięcie pyt. 2, zostało 2,5 s”).
- Komentarz JSX banera sformułowany tak, żeby grep „Przerwa planowa po module” dawał dokładnie 1.

### Addendum — decyzja użytkownika: pauza z dwóch kliknięć (H4)

Po zakończeniu planu użytkownik zdecydował (przez orkiestratora), że `confirm()` przed pauzą ma zastąpić przycisk uzbrajany. Rozstrzygnięcie „confirm() zostaje” z tabeli H4 powyżej jest przez to **nieaktualne**. Commit `3b188e0`:
- Pierwsze kliknięcie „⏸ Pauza” nic nie zapisuje w bazie, tylko uzbraja przycisk na 3 s: pojawia się tekst „⏸ Kliknij ponownie, aby wstrzymać” i czerwony styl `danger`. Drugie kliknięcie w tym czasie od razu wywołuje `adminPauseSession`. Po 3 s albo po zmianie statusu sesji przycisk sam się rozbraja. Okna `confirm("Czy na pewno chcesz zatrzymać quiz?")` już nie ma. Inne `confirm()` (Zakończ, Ogłoś wyniki, Powtórz, Nowy quiz) zostały bez zmian.
- Uzbrojony przycisk ma `aria-label` „⏸ Pauza — Kliknij ponownie, aby wstrzymać”. Nazwa dostępna pasuje więc zarówno do `/Pauza/`, jak i do `/Kliknij ponownie, aby wstrzymać/`.
- Logika jest w czystej funkcji `pauseClickAction(armedUntil, nowMs)` z `PAUSE_ARM_MS = 3000` w `src/lib/gameLogic.js` i ma test w `gameLogic.test.js`.
- **[Rule 3] Sonda, tryb FULL** (`scripts/probe-gameplay.js`, własna pauza w połowie przebiegu) klikała „Pauza” tylko raz, więc po tej zmianie pauza by się w nim nie wykonała. Dodałem drugie kliknięcie uzbrojonego przycisku, tak jak w trybie `PROBE_PAUSE_PHASE`.
- Weryfikacja: `npm test` 203/203, `npm run build` OK, `node --check` sondy OK. Na produkcji nic nie uruchamiałem.

## Otwarte

- ~~**H4 / zabezpieczenie pauzy — decyzja dla użytkownika.**~~ Rozstrzygnięte: użytkownik wybrał pauzę z dwóch kliknięć (addendum powyżej, `3b188e0`). Skuteczność wobec G2 sprawdzi 06-17 (sonda z pauzą w odsłonie i w odliczaniu) oraz próba z ludźmi.
- **Sonda: kontrola widoczności pytań ignoruje auto-skrót** (06-DIAG obs. 1) i daje fałszywy kod 1 przy `PROBE_TPQ ≥ 45`. Plik `scripts/probe-gameplay.js`, sekcja raportu 1 (`expOf`), jest poza plikami tego planu. Trzeba to uwzględnić przy ocenie sond w 06-17.
- Obciążenie: przy 500 telefonach wiersz Realtime, który trafi w snapshot w locie, wywołuje jeden dodatkowy snapshot bez rozrzutu. Dotyczy to tylko telefonów, które akurat miały RPC w locie, więc skala jest niewielka. Warto obserwować w teście obciążeniowym.

## Known Stubs

Brak.

## Self-Check: PASSED

- Pliki: src/lib/participantState.js, src/lib/participantState.test.js, src/hooks/useParticipantGame.js, src/lib/plan.test.js, src/screens/AdminPanel.jsx, 06-VALIDATION.md, deferred-items.md istnieją.
- Commity: c3561c7, fccde16, 281bc10 są obecne w `git log`.
