---
phase: 06-rozgrywka-autorytatywna-serwera-i-plynnosc-jak-w-aplikacji
plan: 01
subsystem: game-logic
tags: [plan, tdd, clock-sync, vitest]
requires: []
provides:
  - "src/lib/plan.js — czysta logika planu sesji (lustro SQL plan_position/sweep_decision)"
  - "src/lib/plan.fixtures.json — kontrakt fixture'ów JS↔SQL (position/sweep/project)"
  - "serverClock.addClockSample + filtr pasma min-RTT"
affects: [06-02, 06-03, 06-04, 06-06]
tech-stack:
  added: []
  patterns: ["deterministyczny plan (items, anchorMs, pausedAtMs, nowMs)", "przesunięcia wyłącznie kotwicy", "timesync-style band filter"]
key-files:
  created: [src/lib/plan.js, src/lib/plan.test.js, src/lib/plan.fixtures.json]
  modified: [src/lib/serverClock.js, src/lib/serverClock.test.js]
decisions:
  - "Fixture'y trzymają czasy względne (ms od anchorMs); opensAt/closesAt/revealUntil test liczy z items"
  - "computeOffset: pasmo rtt <= minRtt*1.5+10 + mediana (nie mediana±odchylenie — łamie test min-RTT)"
metrics:
  duration: ~10 min
  completed: 2026-09-24
---

# Phase 6 Plan 01: Czysta logika planu sesji + filtr zegara Summary

Deterministyczny plan sesji w JS (buildPlanItems/planPosition/projectPlanState/sweepDecision + przesunięcia kotwicy dla pauzy, „Następne”, „Powtórz”) ze wspólnymi fixture'ami JS↔SQL, oraz zegar serwera odporny na przekłamaną próbkę (pasmo min-RTT + mediana, próbki ze snapshotu).

## Tasks

| Task | Name | Commits |
| ---- | ---- | ------- |
| 1 | plan.js + fixture'y + testy | e7b2434 (RED), 13ae1ad (GREEN) |
| 2 | serverClock — filtr pasma, addClockSample, resync online | fd60c70 (RED), 2968ff6 (GREEN) |

## Verification

- `npx vitest run src/lib/plan.test.js` — 60 testów zielonych; filtry `-t` pauza (10), przesunięcie (5), moduły (2), zamiatacz (12), projectPlanState (11)
- `npx vitest run src/lib/serverClock.test.js` — 10 testów (5 starych + 5 nowych)
- `npm test` — 4 pliki, 123 testy zielone
- Fixture'y: position 19, sweep 10, project 8

## Deviations from Plan

None - plan executed exactly as written. (Drobne: zaktualizowano komentarz w startServerClock o liczbie wywołań server_now 4 → 6, bo zmienił się domyślny `rounds`.)

## Known Stubs

None.

## Self-Check: PASSED
