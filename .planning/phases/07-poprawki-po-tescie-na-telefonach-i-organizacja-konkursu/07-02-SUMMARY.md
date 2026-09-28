---
phase: 07-poprawki-po-tescie-na-telefonach-i-organizacja-konkursu
plan: 02
subsystem: projektor (LiveView)
tags: [projektor, live-view, G8, vitest, tdd]
requires: []
provides:
  - "projectorIdlePhase(v, status) — czysta decyzja ekranu projektora bez pytania"
  - "Faza \"ended\" w useLiveProjection"
  - "Ekran „Koniec testu” na projektorze + atrybut data-fue-live-phase"
affects:
  - src/hooks/useLiveProjection.js
  - src/screens/LiveView.jsx
tech-stack:
  added: []
  patterns: ["czysta funkcja decyzyjna w src/lib + test Vitest, hook tylko ją woła"]
key-files:
  created:
    - src/lib/projector.js
    - src/lib/projector.test.js
  modified:
    - src/hooks/useLiveProjection.js
    - src/screens/LiveView.jsx
decisions:
  - "Koniec testu rozpoznajemy po fazie planu (results/ended) ALBO po samym statusie sesji — projektor otwarty po końcu testu, zanim plan się pobierze, też pokazuje „Koniec testu”"
  - "getSessionForCity bez zmian: po ended + „Nowy quiz” projektor wraca do „Oczekiwanie” (zachowanie pożądane)"
  - "AdminPanel/LiveTab bez zmian — renderowany tylko przy status running, faza ended go nie dotyczy"
requirements: [P7-PROJ-END]
metrics:
  duration: 4min
  completed: 2026-09-28
  tasks: 2
  files: 4
---

# Faza 07 Plan 02: Projektor „Koniec testu” (G8) — podsumowanie

Projektor (LiveView) po zakończeniu testu (status sesji `results`/`ended`) pokazuje „🏁 Koniec testu / Dziękujemy! Wyniki za chwilę.” zamiast „Oczekiwanie” z kodem QR, aż admin wypchnie podium. Decyzję podejmuje czysta funkcja `projectorIdlePhase` przetestowana Vitestem.

## Co zrobiono

**Zadanie 1 (TDD): `src/lib/projector.js` + `src/lib/projector.test.js`**
- RED: 4 testy / 8 asercji `expect(` wg `<behavior>` z planu, najpierw niezdane (brak modułu) — `e69a034`.
- GREEN: `projectorIdlePhase(v, status)`: `v.phase` lub `status` ∈ {results, ended} → `"ended"`, w pozostałych przypadkach → `"waiting"` — `c94bb33`.

**Zadanie 2: hook + widok** — `c6a48ed`
- `useLiveProjection.js`: gałąź `!v.item` w `tickPlan` → `setPhase(projectorIdlePhase(v, s.status))`; `tick()` (sesja bez planu / plan się pobiera) → `setPhase(projectorIdlePhase(null, s?.status))`. Komentarz fazy uzupełniony o `"ended"`. W pliku nie zostało żadne `setPhase("waiting")`.
- `LiveView.jsx`: `data-fue-live-phase={phase}` na korzeniu głównego kontenera; nowy blok `phase === "ended"` (klasa `fi`, 🏁, Bebas Neue 48 px złoty, podtytuł 16 px `#9B89CC`, bez `JoinQR`). Kolejność renderu bez zmian: podium → odliczanie → kontener.

## Weryfikacja

- `vitest run src/lib/projector.test.js`: 4/4 zielone.
- Pełny `vitest run`: 9 plików, 218/218 testów zielonych (bez regresji).
- `vite build`: kod 0.
- Kryteria akceptacji (grep): `projectorIdlePhase(` w hooku = 2, `setPhase("waiting")` = 0, `data-fue-live-phase={phase}` = 1, „Dziękujemy! Wyniki za chwilę.” = 1, 🏁 = 1.
- Weryfikacja wizualna na projektorze: bramka 07-12 (test ręczny).

## Odstępstwa od planu

Brak odstępstw w kodzie, plan wykonany zgodnie z opisem.

Uwagi środowiskowe (nie dotyczą kodu):
- Worktree startował ze starszego commita (`272dbf0`) bez planów fazy 07. Zrobiłem fast-forward do `main` (`aca4369`), bez żadnej lokalnej pracy do utraty.
- Straż powłoki zablokowała utworzenie złącza `node_modules` przez cmd/PowerShell. Worktree leży wewnątrz `D:\Projects\fue-quiz-project`, więc Node i tak znajduje `node_modules` repo głównego, idąc w górę drzewa katalogów. Testy i build uruchamiałem przez `node ../../../node_modules/vitest/vitest.mjs run` i `node ../../../node_modules/vite/bin/vite.js build` (odpowiedniki `npm test` / `npm run build`).

## Decyzje (do przeniesienia do STATE.md przez orkiestratora)

- 07-02: projektor rozpoznaje koniec testu po fazie planu albo po samym statusie sesji (results/ended), także zanim plan się pobierze. Po „Nowy quiz” wraca do „Oczekiwanie”, bo `getSessionForCity` pozostało bez zmian.

## Known Stubs

Brak.

## Self-Check: PASSED

- FOUND: src/lib/projector.js, src/lib/projector.test.js, src/hooks/useLiveProjection.js, src/screens/LiveView.jsx
- FOUND commits: e69a034, c94bb33, c6a48ed
