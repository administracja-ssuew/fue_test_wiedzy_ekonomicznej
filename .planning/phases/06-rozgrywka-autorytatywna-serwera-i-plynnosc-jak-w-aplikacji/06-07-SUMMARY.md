---
phase: 06-rozgrywka-autorytatywna-serwera-i-plynnosc-jak-w-aplikacji
plan: 07
subsystem: participant-ui
tags: [wake-lock, view-transitions, css-animation, prefers-reduced-motion, skeleton, vibrate]
requires: ["06-05"]
provides:
  - "src/hooks/useWakeLock.js — Screen Wake Lock z ponawianiem przy visibilitychange"
  - "src/styles/global.css — @keyframes fueDrain/fueRing, ::view-transition 0,18 s, prefers-reduced-motion"
  - "src/hooks/useParticipantGame.js — pushView: zmiana fazy/pytania przez startViewTransition + flushSync; prefetch obrazków tła sesji"
  - "src/screens/Quiz.jsx — pasek i pierścień czasu jako animacje CSS zakotwiczone w opensAt, vibrate(15), pulsowanie w trakcie zapisu"
  - "src/App.jsx — useWakeLock w fazach gry, QuizSkeleton dla loading/plan_loading"
affects: [06-08, 06-09]
tech-stack:
  added: []
  patterns: ["animacja CSS z ujemnym animation-delay liczonym raz na klucz (pytanie, opensAt)", "View Transitions tylko dla zmian strukturalnych widoku, callback ustawia najnowszy widok z refa", "szkielet jako wartość JSX, nie komponent"]
key-files:
  created: [src/hooks/useWakeLock.js]
  modified: [src/styles/global.css, src/hooks/useParticipantGame.js, src/App.jsx, src/screens/Quiz.jsx]
key-decisions:
  - "animation-delay liczony raz na (item.id, opensAt) w useRef — liczony co render przesuwałby działającą animację do przodu przy każdym tiku sekund"
  - "View Transitions podpięte we wspólnym pushView (ticker rAF i commit snapshotu), więc pauza/skip z Realtime też przechodzą płynnie"
  - "Prefetch = tylko obrazki tła sesji; q/opts całego planu są już lokalnie w snapshocie i cache"
requirements-completed: [P6-FLUID]
duration: ~10 min
completed: 2026-09-24
---

# Phase 6 Plan 07: Płynność jak w aplikacji Summary

**Wszystkie 8 punktów płynności z CONTEXT zrobione na natywnych API, bez nowych zależności. Wake Lock w lobby i grze, ponawiany po powrocie karty. Pasek (`transform: scaleX`, kompozytor) i pierścień czasu to animacje CSS zakotwiczone w `opensAt` ujemnym `animation-delay`. Cyfry dalej liczy ticker rAF. Wybór odpowiedzi jest widoczny w tej samej klatce, z `vibrate(15)` i pulsowaniem do potwierdzenia zapisu. Zmiana fazy/pytania idzie przez View Transitions (`flushSync`). Tło sesji jest prefetchowane. Refresh bez cache pokazuje szkielet ekranu pytania. `prefers-reduced-motion` wyłącza animacje.**

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | useWakeLock + global.css + View Transitions i prefetch w hooku | 4006a32 |
| 2 | Quiz.jsx — pasek/pierścień CSS z terminu, vibrate; szkielet w App | 3a98038 |

## Co się zmieniło

- **useWakeLock.js (nowy):** wzorzec z RESEARCH. `acquire` pomija ukrytą kartę, `visibilitychange` ponawia blokadę, cleanup zwalnia ją. Dodatkowo blokada zdobyta już po odmontowaniu jest od razu zwalniana. Brak wsparcia (iOS PWA < 18.4) jest cicho pomijany.
- **App.jsx:** `useWakeLock(screen === "game" && [lobby, no_session, plan_loading, intro, countdown, quiz, reveal, paused, finished].includes(gv.phase))`. `QuizSkeleton` (wartość JSX inline, bez osobnego pliku) ma pasek górny 54 px, pusty pasek czasu, 2 linie pytania i siatkę 2×2 kafli `minHeight: 100` z `pulse 1.4s`. Tło to `var(--fue-bg)`. Renderuje go `case "loading"`, a do tej fazy trafia zarówno `loadState === "loading"` bez planu/sesji, jak i `plan_loading`. Atrybut `data-fue-phase="loading"` dla sondy się nie zmienił.
- **useParticipantGame.js:** nowy `pushView(v, k)` używany przez ticker rAF i `commit`. Gdy zmienia się `phase` albo `idx`, a przeglądarka ma `startViewTransition`, karta jest widoczna i nie ma `prefers-reduced-motion`, woła `document.startViewTransition(() => flushSync(() => setView(viewRef.current)))`. W pozostałych przypadkach zwykłe `setView`. Prefetch: raz na `session.id` wyciąga URL-e z `url(...)` w `bg`/`bg_mobile` i robi `new Image().src = url`. Nie ma żadnego dodatkowego pobierania pytań ani `refresh(` w reveal.
- **Quiz.jsx:** nowy pasek czasu 6 px pod paskiem górnym (`fueDrain`) i pierścień SVG (`className="fue-ring"`, `fueRing`, `--fue-circ`). Oba mają `key={item.id-opensAt}`, `animationDuration: tpq s`, `animationPlayState` running tylko w `quiz`. Usunięte `transition: stroke-dashoffset .95s`. `svg width="54"` i `<span>` z cyframi zostały (fallback sondy). Klik odpowiedzi: guard, `navigator.vibrate?.(15)`, potem `onPick(i)`. Przy `answerStatus === "pending"` wybrany kafel ma `pulse 1s infinite`.
- **global.css:** `@keyframes fueDrain`/`fueRing`, `::view-transition-old/new(root)` 0,18 s i blok `@media (prefers-reduced-motion: reduce)` dokładnie wg planu.

## Verification

- `npx vitest run`: 5 plików, 139 testów zielonych
- `npm run build`: przechodzi (po obu taskach)
- Grepy akceptacji Task 1: `wakeLock.request("screen")` → 1, `visibilitychange` → 3, `useWakeLock(` w App → 1, keyframes/reduced-motion w CSS → 4, `startViewTransition|flushSync|prefers-reduced-motion` w hooku → 6
- Grepy akceptacji Task 2: `animationDelay` → 2, `fueDrain|fueRing` → 4, `stroke-dashoffset .95s` → 0, `navigator.vibrate` → 1, `svg width="54"` → 1, `timePerQ|setInterval` → 0, `Skeleton` w App → 2, `new Image()` → 1, `refresh(` w hooku → tylko definicja
- `git diff package.json`: bez zmian
- Zachowania na urządzeniach (Wake Lock, vibrate, View Transitions, reduced-motion) nie były sprawdzane ręcznie. To checkpoint w 06-09.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `animation-delay` liczony raz na klucz, nie w każdym renderze.**
- **Found during:** Task 2
- **Issue:** Plan liczył `-(serverNow() - opensAt)/1000` bezpośrednio w stylu. Quiz renderuje się co tik sekund, a zmiana `animation-delay` działającej animacji CSS nie resetuje jej czasu startu. Każdy render przesuwałby więc pasek i pierścień do przodu o czas, który upłynął, i pasek kończyłby się dużo przed terminem.
- **Fix:** opóźnienie trzymane w `useRef` pod kluczem `${item.id}-${opensAt}` (tym samym co `key` elementów). Nowy `opensAt` przy skip, repeat albo wznowieniu liczy je na nowo.
- **Files modified:** src/screens/Quiz.jsx
- **Commit:** 3a98038

**2. [Rule 2 - Correctness] Skokowy zapas dla `prefers-reduced-motion`.**
- **Found during:** Task 2
- **Issue:** Przy `animation: none !important` pasek i pierścień stałyby pełne przez całe pytanie, czyli pokazywałyby błędny stan.
- **Fix:** inline `transform: scaleX(timerPct)` na pasku i `strokeDashoffset: circ*(1-timerPct)` na pierścieniu, oba bez `transition`. Działająca animacja CSS ma w kaskadzie pierścień i pasek pod kontrolą (animacje wygrywają ze stylem inline), więc zapas działa tylko przy wyłączonych animacjach. Plan kazał usunąć `strokeDashoffset` z `timerPct`. Usunięta została przyczyna skoków (`transition .95s`), a wartość została tylko jako fallback.
- **Files modified:** src/screens/Quiz.jsx
- **Commit:** 3a98038

**3. [Rule 2 - Correctness] View Transitions także dla zmian z `commit` (snapshot/Realtime), nie tylko z tickera.** Pauza albo skip przychodzą przez snapshot, a `commit` sam aktualizuje `viewKeyRef`, więc ticker by ich nie zauważył. Callback przejścia ustawia `viewRef.current`, żeby asynchroniczny callback nie nadpisał nowszego widoku starszym. Commit 4006a32.

**4. Drobne:** `--fue-circ` przekazywane z jednostką `px` (bezpieczniejsza interpolacja `stroke-dashoffset`). `useWakeLock` sprawdza też `typeof navigator`. `QuizSkeleton` ma `aria-busy` i `data-fue-skeleton`.

## Known Stubs

None. `closesAt`/`revealUntil` w propsach Quiz nadal nie są używane (pasek „następne” bierze `secondsLeft` z hooka). Zostały celowo, dla spójności z projekcją.

## Self-Check: PASSED
- Pliki istnieją: src/hooks/useWakeLock.js, src/styles/global.css, src/hooks/useParticipantGame.js, src/App.jsx, src/screens/Quiz.jsx
- Commity 4006a32, 3a98038 istnieją
