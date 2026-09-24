---
phase: 06-rozgrywka-autorytatywna-serwera-i-plynnosc-jak-w-aplikacji
plan: 04
subsystem: participant-client
tags: [supabase, rpc-v2, realtime, localStorage, react-hook, tdd]
requires: ["06-01", "06-02"]
provides:
  - "src/lib/supabase.js — 11 wrapperów v2 (start/submit/snapshot/plan/summary, 4 akcje admina, sweeper) + DEMO na planie lokalnym"
  - "src/lib/participantState.js — localStorage uczestnika + cache planu z kluczem session_id, normalizacja snapshotu, scalanie"
  - "src/hooks/useParticipantGame.js — jedyne źródło fazy ekranu uczestnika"
affects: [06-05, 06-06, 06-08, 06-11]
tech-stack:
  added: []
  patterns: ["snapshot RPC jako jedyna prawda, Realtime jako sygnał", "rozrzucone (jitter) i scalane snapshoty", "ticker rAF z setView tylko przy zmianie klucza", "optymistyczny lock-in z ponawianiem w oknie tolerancji"]
key-files:
  created: [src/lib/participantState.js, src/lib/participantState.test.js, src/hooks/useParticipantGame.js]
  modified: [src/lib/supabase.js]
key-decisions:
  - "Snapshot wymusza includePlan=true, gdy w pamięci nie ma planu — sygnał startu (broadcast/UPDATE) sam dociąga plan"
  - "Rozrzucone snapshoty scalają się w jeden oczekujący timer (dozorca + ponowne SUBSCRIBED nie dublują RPC)"
  - "loadState=error tylko gdy nie ma żadnej sesji do pokazania; z cache projekcja działa dalej offline"
requirements-completed: [P6-SC2, P6-SC3, P6-SC5]
duration: ~15 min
completed: 2026-09-24
---

# Phase 6 Plan 04: Warstwa danych i stan gry uczestnika Summary

**Wrappery RPC v2 z pełnym DEMO na lokalnym planie, czyste funkcje stanu uczestnika w localStorage (16 testów) oraz hook `useParticipantGame`: snapshot `get_participant_state` jako jedyna ścieżka restore, Realtime tylko jako rozrzucony sygnał, faza liczona co klatkę z planu i `serverNow()`.**

## Tasks

| Task | Name | Commits |
| ---- | ---- | ------- |
| 1 | supabase.js — wrappery v2 + DEMO | 2735bf8 |
| 2 | participantState.js (TDD) | 7b2ecc2 (RED), 0012b37 (GREEN) |
| 3 | useParticipantGame | a698762 |

## Verification

- `npm test`: 5 plików, 139 testów zielonych (w tym 16 nowych w `participantState.test.js`; `-t "nieaktualne sessionId"` uruchamia 1 test)
- `npm run build`: przechodzi
- Wszystkie grepy z kryteriów akceptacji spełnione (11 eksportów v2, 4 rpc v2, 4 stare eksporty, 0 `correct_ans` w submitAnswerV2; hook: rAF, addClockSample, online/visibilitychange, 7× snapshotJittered, brak timePerQ/useModules/sessionStorage)
- Hook nie jest jeszcze importowany w App.jsx (06-05), więc build go nie sprawdza. Dlatego uruchomiono tymczasowy test `renderHook` z zamockowanym supabase.js: snapshot → faza quiz → `pick` → pending → saved, `correct` pozostaje null, sessionId przypięty w localStorage. Test przeszedł i został usunięty, nie jest commitowany.
- SQL 39–40 nie jest jeszcze na produkcji (06-03), więc ścieżka prod nie była testowana na żywo.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correctness] Wymuszenie planu przy braku planu w pamięci.** `snapshot()` ustawia `includePlan=true` zawsze, gdy `plan` jest null. Bez tego broadcast startu (`includePlan:false`) zostawiłby telefon w `plan_loading` aż do osobnego wyzwalacza.

**2. [Rule 2 - Load] Scalanie rozrzuconych snapshotów.** Kolejne wywołania `snapshotJittered` przed odpaleniem timera łączą się w jedno (OR na includePlan, najnowszy hint). Dozorca dodatkowo woła `snapshotJittered(..., 2000)` na wypadek, gdyby kanał długo nie wracał. Scalanie sprawia, że razem z ponownym SUBSCRIBED nie wychodzą dwa RPC.

**3. [Rule 2 - Correctness] applySnapshot zachowuje też wpisy `failed` i lokalnie odsłoniętą poprawność.** Plan mówił tylko o `pending`. Wpis `failed` też zostaje, żeby nie znikał wybór. Lokalne `correct` z `revealed_*` zostaje, gdy snapshot przyszedł jeszcze przed bramką i ma `is_correct=null`.

**4. Poprawność uzupełniana dla obu par (revealed_idx/ans i reveal.idx/ans), nie tylko dla `view.idx`.** Snapshot w fazie odliczania kolejnego pytania niesie reveal poprzedniego, więc samo `view.idx` gubiłoby jego ocenę. `revealAns` zwracane z hooka nadal dotyczy `view.idx`.

## Known Stubs

None.

## Self-Check: PASSED
- Pliki istnieją: src/lib/participantState.js, src/lib/participantState.test.js, src/hooks/useParticipantGame.js
- Commity 2735bf8, 7b2ecc2, 0012b37, a698762 istnieją
