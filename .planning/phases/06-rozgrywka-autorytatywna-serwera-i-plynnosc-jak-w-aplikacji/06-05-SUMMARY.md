---
phase: 06-rozgrywka-autorytatywna-serwera-i-plynnosc-jak-w-aplikacji
plan: 05
subsystem: participant-ui
tags: [react, routing, localStorage, plan-projection, probe-attributes]
requires: ["06-04"]
provides:
  - "src/App.jsx — routing uczestnika = switch(fazy) z useParticipantGame, restore z localStorage, data-fue-* na body"
  - "src/screens/Quiz.jsx — UI pytania na propsach z planu (item.tpq, secondsLeft, phase, revealAns, answerStatus)"
  - "src/screens/Break.jsx, src/screens/WaitingResults.jsx — ekrany czysto prezentacyjne"
affects: [06-07, 06-08, 06-11]
tech-stack:
  added: []
  patterns: ["ekran = czysta funkcja fazy projekcji planu", "faza pochodna dla routingu i sondy liczona raz (gamePhase)", "ekrany gry bez własnych timerów i subskrypcji"]
key-files:
  created: []
  modified: [src/App.jsx, src/screens/Quiz.jsx, src/screens/Break.jsx, src/screens/WaitingResults.jsx]
key-decisions:
  - "Jedna pochodna faza gamePhase (loading/lobby/intro/countdown/quiz/reveal/paused/finished/results/ended/legacy) steruje zarówno routingiem, jak i data-fue-phase, więc sonda widzi dokładnie to, co ekran"
  - "Zakończona sesja próbna (ended + is_practice) mapowana na lobby — Lobby podaje id nowej sesji do game.refresh"
  - "Tło miasta: z wiersza sesji, jeśli ma bg/bg_mobile, inaczej getCityBg; snapshot v2 nie niesie bg"
requirements-completed: [P6-SC1, P6-SC2, P6-SC3, P6-SC4]
duration: ~25 min (z przerwami na wznowienia)
completed: 2026-09-24
---

# Phase 6 Plan 05: Routing uczestnika z projekcji planu Summary

**Ścieżka uczestnika w `App.jsx` przepięta na `useParticipantGame`. Ekran to `switch` po fazie liczonej z zamrożonego planu i `serverNow()`, uczestnik wraca po refreshu z localStorage bez kodu, a `document.body` niesie `data-fue-*` dla sondy. `Quiz`, `Break` i `WaitingResults` są czysto prezentacyjne. App.jsx: 745 → 301 linii.**

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | Quiz/Break/WaitingResults — propsy z planu, ekrany prezentacyjne | 4e4fc29 |
| 2 | App.jsx — routing z useParticipantGame, localStorage, data-fue-* | 75c3a90 |

## Co się zmieniło

- **Quiz.jsx:** licznik i progi kolorów liczone z `item.tpq`. Zniknęły `mod.timePerQ` i `useModules`. W fazie `quiz` licznik = `secondsLeft`; w `reveal` pasek „następne” też pokazuje `secondsLeft`, bo hook liczy wtedy do `revealUntil`. Lokalny `resultSec`/`setInterval` usunięty. Kolory poprawna/błędna pojawiają się dopiero, gdy `correctAns != null`; wcześniej na dole jest „Sprawdzamy odpowiedź…”, a fallback `currentQ.ans` zniknął. Pasek potwierdzenia pokazuje status zapisu: pending → „⏳ Zapisywanie…”, saved → „OSTATECZNA”, failed → „⚠️ Nie udało się zapisać odpowiedzi” (#E8376B). Nagłówek zachowuje format `Pytanie X / N · #G/T`, który parsuje sonda.
- **Break.jsx / WaitingResults.jsx:** usunięte kanały Realtime, polle co 20 s i callbacki `onResume`/`onReveal`. Zostały teksty i animacja kropek.
- **App.jsx:** usunięta cała stara maszyna stanów: timery, kanał sesji z dozorcą, `recordAnswer`, `handleTimeout`, `advanceQuestion`, `armAdvanceFallback`, `startQuiz`, gałęzie `break/admin_pause/waiting_results/countdown/module_intro/quiz`. Nowe są: stan `participant` z `loadParticipant()`, `useParticipantGame(screen === "game" ? participant : null)`, efekty `invalid_code` → ekran kodu, `markCodeUsed` raz na parę (kod, sesja), tło z sesji/`getCityBg` z zapisem do `BG_KEY`, `data-fue-phase/q/remaining/locked/choice` (usuwane poza grą) i ekran `legacy`. `plan_loading` oraz stan przed pierwszym snapshotem pokazują „Ładowanie…”, nigdy `legacy`.

## Verification

- `npx vitest run`: 5 plików, 139 testów zielonych
- `npm run build`: przechodzi
- Build DEMO (`VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite build --outDir <scratchpad>/dist-demo`): kod 0
- Grepy akceptacji: `timePerQ` w Quiz.jsx i App.jsx → 0; `advanceSessionQuestion|armAdvanceFallback|fallbackJitterMs|advanceLeadSeconds|setInterval(tick|sessionStorage` w App.jsx → 0; `useParticipantGame(` → 1; `dataset.fue*` → 8; `plan_loading` → 2; `game.refresh(s?.id)` → 1; `setInterval` w ekranach → tylko 2× `setDots`; `supabase|getSessionForCity|getSessionById` w Break/WaitingResults → 0; „Sprawdzamy odpowiedź” → 1; „Nie udało się zapisać odpowiedzi” → 1; format nagłówka → 1.
- Zachowania end-to-end (refresh w trakcie pytania, pauza, reveal) nie były klikane ręcznie. Sprawdzi je sonda 06-08.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correctness] Zastępczy `mod` dla modułu spoza ModulesContext.** Jeśli `useModules()` nie zna `item.m`, podstawiany jest `{ name: "Moduł N", icon, color }`. `Quiz` zwraca `null` bez `mod`, więc bez tego uczestnik zobaczyłby pusty ekran.

**2. [Rule 2 - Correctness] W reveal przed odsłonięciem wybrana odpowiedź zostaje z obrysem, a niewybrane są przygaszone.** Plan wymagał tylko braku kolorów i paska „Sprawdzamy…”. Obrys zachowuje czytelność wyboru.

**3. Drobne:** zamiast `ds.*` jest jawne `document.body.dataset.*`, żeby spełnić grep. Dwa komentarze przeredagowano, bo same łapały się na grepy (`sessionStorage`, „Sprawdzamy odpowiedź”). Przyciski „Wróć” z praktyki i z `no_questions` prowadzą teraz do `game` zamiast do nieistniejącego już ekranu `lobby`. Dodano też `data-fue-choice` (plan wymienia go w pkt 6).

## Known Stubs

- `src/App.jsx`, faza `loading`: nadal zwykły ekran „Ładowanie…”. Zgodnie z planem 06-07 zamieni go na szkielet.
- `myPts={0}` w `Ended`: celowo, bo gra liczy tylko poprawne odpowiedzi, bez punktów (tak było już wcześniej).
- `src/screens/ModuleIntro.jsx` nie jest już nigdzie importowany. Plik zostaje, bo usunięcie nie należy do tego planu.

## Self-Check: PASSED
- Pliki istnieją: src/App.jsx, src/screens/Quiz.jsx, src/screens/Break.jsx, src/screens/WaitingResults.jsx
- Commity 4e4fc29, 75c3a90 istnieją
