---
phase: 06-rozgrywka-autorytatywna-serwera-i-plynnosc-jak-w-aplikacji
plan: 15
subsystem: participant-ui
tags: [react, screens, breaks, end-screen, projector, gap-closure]
requires: ["06-12"]
provides:
  - "participantState.mergeSessionRow niesie plan_hold_idx z wiersza Realtime (snapshot przenosi je przez spread sesji)"
  - "useParticipantGame: holdIdx w projekcji, znacznik przerwy planowej w viewKey, jeden rozrzucony snapshot przy wejściu w finished"
  - "Break.jsx: tryb przerwy planowej („Przerwa”, Moduł X — nazwa rozpocznie się po przerwie)"
  - "Ended.jsx: jeden ekran „Koniec testu” z wynikiem poprawne / liczba pytań w planie i siatką modułów z planu"
  - "useLiveProjection: holdIdx, breakNext, autoSec całkowite z REVEAL_MS; LiveView: „Przerwa” + następny moduł"
  - "data-fue-break na <body> dla sondy e2e"
affects: [06-16, 06-17]
tech-stack:
  added: []
  patterns: ["ekran końca gry liczony wyłącznie z planu i odsłoniętej poprawności (bez punktów, bez listy allAnswers)", "moduły w efekcie z pustymi zależnościami czytane przez ref"]
key-files:
  created: [.planning/phases/06-rozgrywka-autorytatywna-serwera-i-plynnosc-jak-w-aplikacji/deferred-items.md]
  modified: [src/lib/participantState.js, src/lib/participantState.test.js, src/hooks/useParticipantGame.js, src/App.jsx, src/screens/Break.jsx, src/screens/Ended.jsx, src/hooks/useLiveProjection.js, src/screens/LiveView.jsx]
  deleted: [src/screens/WaitingResults.jsx, src/screens/ModuleIntro.jsx]
key-decisions:
  - "finished, results i ended to jeden ekran Ended — bez pośredniego „czekaj na admina”; podium dalej ręcznie z panelu"
  - "Mianownik wyniku = gamePlan.length (fallback: liczba odpowiedzi, gdy planu brak); licznik tylko wpisy correct === true z pytań planu"
  - "Ręczna pauza admina bez zmian („Wstrzymano”, „Oczekiwanie na administratora”); przerwa planowa ma własny tekst „Czekamy na wznowienie”"
requirements-completed: [P6-GAP-BREAKS, P6-GAP-ENDSCREEN, P6-GAP-DENOM, P6-GAP-REVEAL10]
duration: ~4 min
completed: 2026-09-27
---

# Phase 6 Plan 15: Ekrany przerwy planowej i „Koniec testu” — Summary

**Telefon w przerwie po module 2/4 pokazuje „☕ Przerwa” z numerem i nazwą następnego modułu (od chwili kotwica + r, zanim zamiatacz zapisze pauzę), a po wznowieniu nie wraca do przerwy dzięki `plan_hold_idx` z Realtime i snapshotu. Po ostatnim pytaniu jest jeden ekran „Koniec testu” z wynikiem X / liczba pytań w planie — bez komunikatu o czekaniu na administratora. Projektor pokazuje przerwę z następnym modułem.**

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 (RED) | Testy plan_hold_idx w mergeSessionRow / normalizeSnapshot / applySnapshot | 1282360 |
| 1 (GREEN) | plan_hold_idx w ROW_FIELDS, holdIdx w computeView, viewKey z „B”, snapshot przy finished | 25716f3 |
| 2 | Break (przerwa planowa), Ended („Koniec testu”), routing App, data-fue-break, usunięcie martwych ekranów | 3e8fd9c (+ usunięcia w ad3b841, patrz odchylenia) |
| 3 | useLiveProjection (holdIdx, breakNext, REVEAL_MS) + LiveView „Przerwa” | c3a102b |

## Co się zmieniło

- **Stan uczestnika:** `plan_hold_idx` trafia do sesji z wiersza Realtime (jawny `null` czyści, brak pola zachowuje). `normalizeSnapshot`/`applySnapshot` przenosiły je już wcześniej (spread sesji) — teraz jest to przykryte testami.
- **Hook uczestnika:** projekcja dostaje `holdIdx`, więc przerwa zużyta nie wraca po wznowieniu; `viewKey` rozróżnia ręczną pauzę i przerwę planową. Przy pierwszym wejściu w `finished` (na sesję) idzie jeden snapshot z rozrzutem 0–1,5 s — `is_correct` ostatniego pytania z serwera bez czekania na Realtime. Ref zerowany przy przełączeniu sesji i zmianie uczestnika.
- **App:** `case "paused"` → przerwa planowa (`gv.plannedBreak`, nazwa/ikona z `useModules`) albo „Wstrzymano”. `finished`/`results`/`ended` → `Ended` z `correctN`, `totalQ = gamePlan.length`, `perModule`, `pending` („Aktualizuję wynik…”, gdy któraś odpowiedź z planu czeka na poprawność).
- **Ended:** nagłówek „Koniec testu” (próba: „Próba zakończona!”), „Twój wynik X / N”, siatka modułów z planu (do 5 kolumn), karta „Dziękujemy za udział, Imię Nazwisko! / Ranking i podium ogłosimy na sali.”. Karta „⏳ Poczekaj na ogłoszenie organizatora” usunięta.
- **Projektor:** `useLiveProjection` z `holdIdx` i `breakNext` (moduły przez `modulesRef`), `autoSec` startuje od `Math.ceil(REVEAL_MS / 1000)` = 12. `LiveView`: „☕ Przerwa — Po przerwie: {ikona} Moduł X — nazwa”.
- `REVEAL_SECONDS` występuje już tylko w `gameLogic.js` i jego teście.

## Weryfikacja

- `npx vitest run src/lib/participantState.test.js` — 19/19 (RED: 1 błąd przed zmianą).
- `npm test` — 169/169 (5→6 plików testów; liczba rośnie z testami równoległego 06-14), `npm run build` — OK po każdym zadaniu.
- Kryteria grep z planu: wszystkie spełnione (`"plan_hold_idx"` = 1, `holdIdx: s.plan_hold_idx` = 1 w obu hookach, `finishedSnapRef` ≥ 3, `gv.plannedBreak` = 3, `fueBreak` = 2, `totalQ={totalQ}` = 1, „rozpocznie się po przerwie” = 1, brak „Poczekaj na ogłoszenie”, `breakNext` w LiveView = 4).
- Ręczny przebieg (przerwa po module 2/4 na telefonie i projektorze, ekran końca z X / N) — w 06-17 na produkcji.

## Deviations from Plan

### Wspólny indeks gita z równoległym wykonawcą

- **Found during:** Task 2
- **Issue:** `git rm src/screens/WaitingResults.jsx src/screens/ModuleIntro.jsx` zostało zaindeksowane, a równoległy wykonawca 06-14 zrobił commit ad3b841 („SQL section 43…”) w tym samym drzewie roboczym, zanim ja zrobiłem swój. W efekcie oba usunięcia weszły do jego commitu, a nie do 3e8fd9c.
- **Fix:** Nie przepisywałem historii (współdzielona gałąź, równolegli wykonawcy). Pliki są usunięte w HEAD; stan końcowy jest zgodny z planem, różni się tylko przypisanie usunięć do commitu.

### Odroczone (poza zakresem plików planu)

- **Podgląd admina (`LiveTab` w `AdminPanel.jsx`)** w przerwie planowej dalej pokazuje ogólne „Quiz wstrzymany — za chwilę wznowienie.”. Hook zwraca już `breakNext`, ale `AdminPanel.jsx` należał w tej fali do 06-14 i nie mogłem go edytować. Zapisane w `deferred-items.md` (kilka linii do dopisania w 06-16/06-17). Prawda z must_haves „podgląd admina pokazuje Przerwę + następny moduł” jest przez to spełniona tylko częściowo: projektor tak, podgląd admina jeszcze nie.

### Drobne doprecyzowania

- Break w trybie przerwy planowej pokazuje ikonę następnego modułu (`nextModuleIcon`) przed „Moduł X — nazwa”, żeby prop był użyty.
- Ended ma domyślne wartości propsów (`correctN = 0`, `totalQ = 0`, `perModule = []`) i fallback nazwy modułu, gdy `useModules()` nie zna id.

## Known Stubs

Brak.

## Self-Check: PASSED

- Pliki: src/lib/participantState.js, src/hooks/useParticipantGame.js, src/App.jsx, src/screens/Break.jsx, src/screens/Ended.jsx, src/hooks/useLiveProjection.js, src/screens/LiveView.jsx — istnieją; WaitingResults.jsx i ModuleIntro.jsx — usunięte.
- Commity: 1282360, 25716f3, 3e8fd9c, c3a102b, ad3b841 — obecne w `git log`.
