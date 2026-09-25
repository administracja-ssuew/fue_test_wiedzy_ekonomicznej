---
phase: 06-rozgrywka-autorytatywna-serwera-i-plynnosc-jak-w-aplikacji
plan: 11
subsystem: frontend-cleanup
tags: [refactor, legacy-removal, admin-panel, live-view, plan]
requires: ["06-10"]
provides:
  - "gameLogic.js bez logiki kierowcy i projekcji legacy (shouldAdvance, advanceLeadSeconds, fallbackJitterMs, remainingSeconds, projectLiveState)"
  - "useLiveProjection wyłącznie z planu sesji; sesja bez planu → waiting, timePerQ = planTpq ?? 0"
  - "AdminPanel wyłącznie sterowanie v2; sesja bez planu w grze → baner „uruchomiona starszą wersją panelu”"
  - "supabase.js bez advanceSessionQuestion, startQuizSession, getParticipantAnswers"
affects: []
tech-stack:
  added: []
  patterns: ["jeden model rozgrywki: plan + zamiatacz w bazie; front nie zapisuje przejść pytań"]
key-files:
  created: []
  modified:
    - src/lib/gameLogic.js
    - src/lib/gameLogic.test.js
    - src/hooks/useLiveProjection.js
    - src/screens/AdminPanel.jsx
    - src/lib/supabase.js
    - scripts/verify-clock.js
key-decisions:
  - "submitAnswer zostaje w supabase.js — importuje go scripts/bot-runner.js"
  - "remainingSeconds przeniesione jako lokalna kopia do scripts/verify-clock.js (jedyny importer poza usuwanym kodem)"
  - "driverTick w panelu liczy tylko dla sesji z planem (pos z planu, tpq z planu) — auto-skrót idzie przez adminSkipQuestion"
  - "Sesja bez planu w running/paused: brak Pauzy/Wznów/Następne/Powtórz/Ogłoś; zostają Zakończ i Odśwież + baner ostrzegawczy"
requirements-completed: [P6-SC1, P6-SC4]
duration: ~35 min
completed: 2026-09-25
---

# Phase 6 Plan 11: Usunięcie kodu legacy (kierowca, projekcja z modułów) — Summary

**Kod rozgrywki istnieje teraz w jednym modelu: plan sesji + zamiatacz w bazie. W bundlu nie ma już żadnego zapisu przejścia pytania z przeglądarki (`advance_session_question`, `start_quiz_session`, `get_participant_answers` — 0 trafień w `dist/assets`), a LiveView/podgląd admina nie liczą czasu z ModulesContext. Testy (112), build, verify-prod (45 OK) i obie sondy na produkcji — zielone.**

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | gameLogic + testy + useLiveProjection (+ blok kierowcy w AdminPanel, verify-clock) | c00dc75 |
| 2 | AdminPanel LEGACY + supabase.js wrappery; testy, build, verify-prod, sondy | 4eafec8 |

## Co usunięto

- **gameLogic.js:** `shouldAdvance`, `advanceLeadSeconds`, `fallbackJitterMs`, `remainingSeconds`, `projectLiveState`. Komentarz przy `REVEAL_SECONDS`/`MODULE_INTRO_SECONDS` odnosi się teraz do planu; dodana sygnatura „Przejścia pytań wykonuje zamiatacz w bazie (faza 6, advance_due_sessions); projekcja: src/lib/plan.js”. Zostały stałe czasu, `shouldEndEarly`, `earlySkipFloorSeconds`, `answerPlateauMs`, `AUTO_SKIP_MIN_TPQ`, `cityInfo`, `getModule`.
- **gameLogic.test.js:** bloki `projectLiveState`, `remainingSeconds`, `shouldAdvance`, `advanceLeadSeconds`, `fallbackJitterMs`. Testy `shouldEndEarly` (w tym regresja 500/60) i `AUTO_SKIP_MIN_TPQ` zostały (16 wystąpień `shouldEndEarly`).
- **useLiveProjection.js:** gałąź `projectLiveState`, `modulesRef`, gałąź reveal przez `getLiveAnswerSummary` (publiczny projektor → wyłącznie `getAnswerSummaryV2`, admin → `getLiveQuestionStats`). Sesja bez planu lub plan niepobrany → `phase "waiting"` bez licznika. `timePerQ = planTpq ?? 0`; `mod` zostaje (nazwa/ikona/kolor).
- **AdminPanel.jsx:** blok `KIEROWCA PRZEJŚCIA PYTANIA` (z `advanceSessionQuestion`, `advancingRef`, `if (s.plan_anchor_at) return;`), wszystkie gałęzie `LEGACY (sesje bez planu)` (pauza/wznowienie/Następne/Powtórz przez `upd`), `curQuestionTimePerQ` (czas z modułów), `MODULES` w `SesjaTab`, importy `shouldAdvance`, `advanceLeadSeconds`, `advanceSessionQuestion`. `driverTick` działa tylko dla sesji z planem (pozycja i `tpq` z planu). Nowy baner dla sesji bez planu w running/paused: „Ta sesja została uruchomiona starszą wersją panelu — zakończ ją (⏹ Zakończ) i uruchom ponownie.”
- **supabase.js:** `advanceSessionQuestion`, `startQuizSession`, `getParticipantAnswers` (−84 linie).

## Weryfikacja

- `grep -rn "shouldAdvance|advanceLeadSeconds|fallbackJitterMs|projectLiveState|remainingSeconds" src` → 0.
- `grep -rn "advanceSessionQuestion|advance_session_question|armAdvanceFallback" src` → 0. `LEGACY (sesje bez planu)` i `KIEROWCA PRZEJŚCIA PYTANIA` w AdminPanel → 0; „uruchomiona starszą wersją panelu” → 1.
- V-11: `timePerQ` w `App.jsx`, `Quiz.jsx`, `useParticipantGame.js` → 0; w `useLiveProjection.js` tylko `planTpq ?? 0` + klucz zwracany.
- `dist/assets/*.js` bez `advance_session_question` / `start_quiz_session"` / `get_participant_answers`.
- `npm test` → 5 plików, 112 testów, kod 0. `npm run build` → kod 0. `npm run verify-prod` → kod 0, „PRODUKCJA GOTOWA pod kątem SQL (45 OK)”.
- Sondy na prod (preview :4173):

| Sonda | Kod | Widoczność pytań (plan 26 s) | Start vs plan (maks.) | Idx w bazie | `results` od zamiatacza | SC5 | Sprzątanie |
|---|---|---|---|---|---|---|---|
| podstawowa | **0** | 25,9 / 25,9 / 25,6 s | 185 ms | 88/88 | +1147 ms | OK (21 asercji, v2 ×3) | 0/0/0 |
| `PROBE_ADMIN_EXIT=1` | **0** | 25,8 / 25,7 / 25,8 s | 138 ms | 96/96 | +1202 ms (bez admina) | OK (21 asercji, v2 ×3) | 0/0/0 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Blok kierowcy w AdminPanel usunięty już w Task 1**
- **Found during:** Task 1 (build)
- **Issue:** `AdminPanel.jsx` importował `shouldAdvance`/`advanceLeadSeconds`, więc po usunięciu ich z `gameLogic.js` build Task 1 padał („not exported”).
- **Fix:** blok `KIEROWCA PRZEJŚCIA PYTANIA`, `advancingRef` i te importy usunięte w commicie Task 1; reszta AdminPanel (gałęzie LEGACY przycisków, import `advanceSessionQuestion`) w Task 2. Każdy commit się buduje.
- **Commit:** c00dc75

**2. [Rule 3 - Blocking] `scripts/verify-clock.js` importował `remainingSeconds`**
- **Fix:** lokalna kopia tej 2-liniowej formuły w skrypcie (skrypt demonstruje korektę offsetu zegara, nie projekcję gry). Kryterium „0 trafień w src” spełnione. `npm run verify-clock` ładuje się bez błędu importu, ale pełnego przebiegu nie potwierdzono: skrypt celuje w projekt STAGING (`VITE_SUPABASE_URL_STAGE`) i zakończył się na `server_now: TypeError: fetch failed` (sieć/projekt stagingowy niedostępny), zanim doszedł do zmienionej formuły.
- **Commit:** c00dc75

**3. `submitAnswer` pozostawiony** — importuje go `scripts/bot-runner.js` (zgodnie z instrukcją planu: zostaw i odnotuj). Stary RPC `submit_answer` jest utwardzony sekcją 41.

**4. Dodatkowo usunięte (poza listą planu, ta sama kategoria):** `getLiveAnswerSummary` z importów `useLiveProjection` (reveal legacy), `curQuestionTimePerQ` i `MODULES` w `SesjaTab` (jedyne źródło czasu z modułów w panelu po usunięciu legacy). Wrapper `getLiveAnswerSummary` w `supabase.js` zostaje — używa go `AdminPanel` (licznik na żywo) i fallback `getAnswerSummaryV2`.

**Total deviations:** 2 auto-fixed (blocking) + 2 udokumentowane. **Impact:** brak zmian zachowania ścieżki v2; sondy potwierdzają.

## Uwagi

- `scripts/load-runner.js` i `scripts/verify-prod.js` wołają RPC `advance_session_question` bezpośrednio (bez wrappera) — funkcja zostaje w bazie (SC6: bez zmian sygnatur), więc to poza zakresem.
- `src/screens/ModuleIntro.jsx` (tekst „{mod.timePerQ} sekund na odpowiedź”) nie jest nigdzie importowany — martwy plik spoza zakresu planu; rozgrywka używa `ModuleIntroFS.jsx`. Nie ruszane, do ewentualnego usunięcia przy okazji.

## Przypomnienie dla użytkownika

Po tym planie potrzebny jest **kolejny deploy frontu na Vercel** (https://fue-quiz.vercel.app/) — poza wydarzeniem. Produkcja bazy nie była zmieniana.

## Known Stubs

Brak.

## Self-Check: PASSED

- FOUND: 06-11-SUMMARY.md
- FOUND: commity c00dc75, 4eafec8
