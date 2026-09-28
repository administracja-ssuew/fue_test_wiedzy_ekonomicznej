---
phase: 06-rozgrywka-autorytatywna-serwera-i-plynnosc-jak-w-aplikacji
plan: 17
subsystem: bramka zamknięcia luk G1–G7
tags: [sondy-prod, wdrozenie, test-telefonow]
requires: [06-16]
provides: [G2/G7 zamknięte, front fazy 6 na produkcji]
affects: [faza 7]
key-files:
  created:
    - .planning/phases/06-rozgrywka-autorytatywna-serwera-i-plynnosc-jak-w-aplikacji/06-17-GATE.md
  modified: []
decisions:
  - "Seria sond powtarzana od nowa po poprawce G7 (58b5af0, 308b9c9); przebiegi przerwane środowiskowo nie liczone jako zaliczone"
  - "Wdrożenie 28.09.2026 11:51, bundle index-DXJufQaC.js"
metrics:
  completed: 2026-09-28
---

# Plan 06-17: bramka zamknięcia luk G1–G7 — podsumowanie

**Sondy zamykające (seria 3):** 16/16 przebiegów na produkcji z kodem 0: 5 podstawowych (maks. start pytania DOM 304 ms, limit 1500), ADMIN_EXIT 2/2, pauza 6/6 (P1–P5), REFRESH, OFFLINE, FULL. **G2/G7 zamknięte: TAK.**

**Wdrożenie:** push `4529658..272dbf0`, https://fue-quiz.vercel.app serwuje `assets/index-DXJufQaC.js` = lokalny build. Sondy na wdrożeniu: podstawowa i ADMIN_EXIT z kodem 0.

**Test na telefonach:** ogólna akceptacja użytkownika („jest fajnie – widać, jak zegar jest dobrze skalibrowany”). Nowe luki: **G8** (projektor po końcu testu pokazuje „Oczekiwanie”) i **G9** (iPhone/Chrome: brak wibracji, ekran się wygasza). Przeniesione do fazy 7 razem z prośbami koordynatorów. Czasy modułów przywrócone (20/30/60/75/20).

## Odchylenia

- **Seria 1** (27.09) zatrzymana na przebiegu 05 przez błąd aplikacji G7 (zawieszony snapshot bez limitu czasu). Naprawione w `/gsd:debug`, commity 58b5af0 i 308b9c9.
- **Seria 2** (27/28.09) przerwana środowiskowo. Najpierw resztki po przerwanym przebiegu poprzedniej sesji (3 pytania `[SONDA]`, kody, admin, sesja w `results` z planem) skaziły przebieg. Resztki usunięto ręcznie tak jak `cleanup()`. Potem komputer zasnął w trakcie przebiegu. Nie był to błąd aplikacji.
- Push wymagał logowania do GitHuba przez Git Credential Manager (przeglądarka), bo sesja domyślnie ma wyłączoną interaktywność.

## Self-Check: PASSED
