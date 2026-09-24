---
phase: 06-rozgrywka-autorytatywna-serwera-i-plynnosc-jak-w-aplikacji
plan: 06
subsystem: admin-live-view
tags: [plan-sesji, rpc-v2, live-view, admin-panel, pg_cron, sweeper]
requires: ["06-04"]
provides:
  - "src/hooks/useLiveProjection.js — projekcja LiveView/embedu z planu sesji, reveal v2 po bramce, timePerQ z planu"
  - "src/screens/AdminPanel.jsx — sterowanie sesją z planem wyłącznie przez RPC v2, baner + awaryjny sweep przy martwym zamiataczu"
affects: [06-08, 06-11]
tech-stack:
  added: []
  patterns: ["plan pobierany raz na session.id", "gałąź plan-aware obok gałęzi LEGACY (do 06-11)", "applyV2: wspólna obsługa wyniku RPC + broadcast jako sygnał"]
key-files:
  created: []
  modified: [src/hooks/useLiveProjection.js, src/screens/AdminPanel.jsx]
key-decisions:
  - "Sesja z kotwicą, ale bez pobranego jeszcze planu → projekcja legacy z q_started_at (zamiatacz trzyma wiersz w synchronizacji), bez pustego ekranu"
  - "Start bez cichego fallbacku do startQuizSession — brak sekcji 39 ma dać alert"
  - "Zdarzenie logEvent z applyV2 tylko przy ok=true (drugi klik = noop nie jest logowany)"
requirements-completed: [P6-SC1, P6-SC4, P6-SC5]
duration: ~25 min (z przerwami na wstrzymania)
completed: 2026-09-24
---

# Phase 6 Plan 06: Podgląd i panel admina na planie sesji Summary

**LiveView i embed admina liczą fazę oraz czas z zamrożonego planu sesji (projectPlanState + serverNow), a poprawną odpowiedź publicznie pokazują dopiero po closes_at + 1,5 s przez get_answer_summary_v2. Panel steruje sesją z planem jednym wywołaniem RPC v2 na akcję, nie zapisuje przejść pytań (robi to zamiatacz pg_cron). Gdy zamiatacz milczy dłużej niż 5 s, panel pokazuje czerwony baner i co 2 s sam woła admin_sweep_session.**

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | useLiveProjection: projekcja z planu + reveal v2 po bramce | 4d894c8 |
| 2 | AdminPanel: akcje v2, brak zapisu przejść dla planu, baner zamiatacza, wyniki w finished | 89b7924 |

## Szczegóły

- **useLiveProjection:** `applySession` jest jedyną ścieżką zapisu sesji (initial load, Realtime, poll, szybki kanał `quiz-${id}`). Pobiera plan raz na `session.id` i ponawia, gdy odpowiedź przyjdzie pusta. `tickPlan` mapuje fazy planu na dotychczasowy kontrakt: intro/countdown → quiz + cdNum, finished → reveal z autoSec 0, lobby/results/ended → waiting. Indeks pytania szukany jest po `id` w `questionsRef`. Reveal pobierany jest raz na pytanie po bramce, z jednym ponowieniem po 1 s, gdy `ans` jest null. Klucze zwracanego obiektu się nie zmieniły, `LiveView.jsx` bez zmian.
- **AdminPanel:** zawiera `plan`/`planRef`/`planPos()`, `applyV2` i Start przez `startQuizSessionV2`. Pauza, Wznów, Następne i Powtórz idą przez RPC v2 dla sesji z planem, a gałęzie legacy są oznaczone `// LEGACY (sesje bez planu) — usunąć w 06-11` (5×). `driverTick` liczy idx/tpq/opensAt z planu (licznik odpowiedzi i auto-skip działają dalej) i przed blokiem kierowcy ma `if (s.plan_anchor_at) return;`. `curQuestionTimePerQ` bierze czas z planu. Nieużywany import `startQuizSession` usunięty (eksport w supabase.js zostaje do 06-11).

## Verification

- `npx vitest run`: 5 plików, 139 testów zielonych
- `npm run build`: przechodzi
- Grepy akceptacyjne: projectPlanState/getSessionPlan/getAnswerSummaryV2/REVEAL_GATE_MS obecne. `timePerQ` występuje tylko w linii z `planTpq` i w zwracanym kontrakcie. Wywołania v2 w AdminPanel: 5. `if (s.plan_anchor_at) return;` stoi w linii 764, przed `advanceSessionQuestion(...)` w linii 783. `startQuizSession(session.id)` nie występuje, baner jest w 1 linii, sweep/status po ≥ 1, LEGACY 5×.
- Produkcja nie była dotykana. Scenariusz „admin zamyka przeglądarkę” sprawdzi sonda w 06-08.

## Deviations from Plan

**1. [Rule 2 - Correctness] Szybki kanał `quiz-${id}` w useLiveProjection także idzie przez `applySession`.** Wcześniej ustawiał tylko `sessionRef`, przez co zmiana sesji na tym kanale nie dociągnęłaby planu.

**2. [Rule 1 - Bug] Ochrona przed spóźnioną odpowiedzią reveal.** Wynik `getAnswerSummaryV2` jest odrzucany, jeśli w międzyczasie zmieniło się pytanie, więc nie nadpisuje stanu nowego pytania.

**3. Drobne:** usunięto nieużywany import `startQuizSession`. `logEvent` w `applyV2` wywoływany jest tylko przy `ok=true`. Pozostałe akcje czytają `plan_anchor_at` z `sessionRef` (świeższe niż stan React) zamiast z `isPlan`.

## Known Stubs

None. Stan `plan` w AdminPanel jest ustawiany, ale renderowanie korzysta z `planRef`/`planPos()`. Stan wymusza przerysowanie po pobraniu planu.

## Self-Check: PASSED
- Pliki istnieją: src/hooks/useLiveProjection.js, src/screens/AdminPanel.jsx
- Commity 4d894c8, 89b7924 istnieją
