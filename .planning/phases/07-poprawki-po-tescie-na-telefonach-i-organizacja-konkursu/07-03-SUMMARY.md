---
phase: 07-poprawki-po-tescie-na-telefonach-i-organizacja-konkursu
plan: 03
subsystem: participant-ui / wake-lock
tags: [ios, wake-lock, nosleep, pwa, lobby]
requires: []
provides:
  - "src/lib/wakeLock.js: createWakeLockController, getWakeLock, armWakeLockFromGesture, MP4_DATA_URI"
  - "src/hooks/useWakeLock.js: useWakeLock(active), useWakeLockState()"
affects:
  - src/screens/CodeEntry.jsx (07-08 przebudowuje resztę pliku — pierwsza linia submit musi zostać)
  - src/screens/Lobby.jsx
  - src/App.jsx
tech-stack:
  added: []
  patterns:
    - "Kontroler-singleton poza Reactem + useSyncExternalStore dla stanu UI"
    - "Uzbrajanie API wymagających gestu w nasłuchu click/touchend/keydown (faza przechwytywania)"
key-files:
  created:
    - src/lib/wakeLock.js
    - src/lib/wakeLock.test.js
  modified:
    - src/hooks/useWakeLock.js
    - src/App.jsx
    - src/screens/CodeEntry.jsx
    - src/screens/Lobby.jsx
decisions:
  - "Odmowa natywnej blokady poza gestem NIE przełącza na wideo; dopiero odmowa w geście (albo brak API) — kolejny gest gra mp4 NoSleep.js"
  - "Stan failed liczony tylko gdy natywna niedostępna/odmówiona w geście ORAZ wideo odrzucone ORAZ nic nie trzyma blokady"
  - "Spóźniony sentinel (wanted=false albo już trzymany inny) jest od razu zwalniany — brak wycieku przy podwójnym kliknięciu (nasłuch document + onClick paska)"
metrics:
  duration: 12min
  completed: 2026-09-28
  tasks: 2
  files: 6
requirements: [P7-IOS-WAKE]
---

# Faza 7 Plan 03: Blokada ekranu na iOS (uzbrajanie gestem + fallback wideo) Summary

Własny kontroler blokady ekranu `src/lib/wakeLock.js`: natywny `navigator.wakeLock` wołany synchronicznie w geście (click/touchend/keydown, faza przechwytywania), z fallbackiem na niewyciszone wideo mp4 z dźwiękiem z NoSleep.js (MIT, 3753 B, bez `muted`/`loop`, pętla przez `timeupdate`); „Dołącz do quizu →” uzbraja blokadę jako pierwsza instrukcja, Lobby pokazuje pasek „💡 Dotknij ekranu, aby nie gasł”, a blokada jest chciana od lobby do `results`/`ended`.

## Zadania

| # | Zadanie | Commit | Pliki |
|---|---------|--------|-------|
| 1 (RED) | Testy kontrolera (17 przypadków) | `017ac40` | src/lib/wakeLock.test.js |
| 1 (GREEN) | Kontroler blokady + mp4 NoSleep.js | `69c22c9` | src/lib/wakeLock.js |
| 2 | useWakeLock na kontrolerze, pasek w Lobby, uzbrojenie w CodeEntry, fazy results/ended w App | `9e4a731` | src/hooks/useWakeLock.js, src/App.jsx, src/screens/CodeEntry.jsx, src/screens/Lobby.jsx |

## Jak działa

- `setWanted(true)` (z `useWakeLock` w App) od razu próbuje natywnej blokady — Android i desktop przyznają ją bez gestu. Odmowa poza gestem nic nie psuje: nasłuch gestów na `document` zostaje aktywny.
- Dopóki `wanted && !held`, każdy `click`/`touchend`/`keydown` woła `armFromGesture()` → `request("screen")` synchronicznie w handlerze. Odmowa w geście (albo brak API) ustawia `nativeFailed` → następny gest gra ukryte wideo 1×1 px.
- Sentinel zwolniony przez system (`release`) albo wideo zatrzymane przez iOS przy ukryciu karty (`pause`) → `held=false`, nasłuch gestów wraca; `visibilitychange → visible` ponawia natywną prośbę.
- `setWanted(false)` (wyjście z gry) zwalnia sentinel i pauzuje wideo; `body.dataset.fueWake` = `held`/`off`, usuwany poza grą (do testów ręcznych i sond). Lobby ma też `data-fue-wake` na korzeniu.
- `getState()` zwraca ten sam obiekt, dopóki nic się nie zmieniło (wymóg `useSyncExternalStore`).

## Weryfikacja

- `npx vitest run src/lib/wakeLock.test.js` — 17/17.
- `npm test` — 9 plików, 231/231.
- `npm run build` — OK.
- Wszystkie grepy z `acceptance_criteria` obu zadań spełnione.
- Test ręczny na iPhonie (Safari + Chrome, Auto-Lock 30 s) — w bramce 07-12.

## Odstępstwa od planu

### Drobne poprawki (bez wpływu na kontrakt)

**1. [Rule 1 - Bug] Zwalnianie zdublowanego sentinela**
- **Znalezione w:** Zadanie 1
- **Problem:** kliknięcie paska w Lobby odpala i globalny nasłuch na `document`, i `onClick` paska — dwie równoległe prośby mogłyby dać dwa sentinele, z których jeden by wyciekł.
- **Poprawka:** w `then` prośby natywnej sentinel jest od razu zwalniany, jeśli `wanted=false`, kontroler zniszczony albo inny sentinel już jest trzymany. Analogicznie `play()` rozwiązany po `wanted=false` pauzuje wideo.
- **Commit:** `69c22c9`

**2. Kosmetyka pod kryteria grep**
- Komentarz nie wymienia nazwy `pointerdown` (kryterium „brak wyników”), a tablica `GESTURES` ma zdarzenia w osobnych wierszach (kryterium `grep -c ≥ 3`). Zachowanie bez zmian.

**3. Środowisko worktree**
- Gałąź worktree była za `main` (brak planów fazy 07) — przewinięta `git merge --ff-only main` przed startem. `node_modules` podpięte junction’em przez `fs.symlinkSync` (nie jest commitowane).

## Decyzje (do przeniesienia do STATE przez orkiestratora)

- 07-03: blokada ekranu jako singleton `getWakeLock()` poza Reactem; hook tylko ustawia `wanted`. Kolejne plany (07-08 CodeEntry) muszą zachować `armWakeLockFromGesture({ force: true })` jako pierwszą instrukcję `submit`.
- 07-03: fallback wideo dopiero po odmowie natywnej W GEŚCIE — odmowa poza gestem (normalna na iOS) nie wyłącza natywnej ścieżki.

## Known Stubs

Brak.

## Self-Check: PASSED

- FOUND: src/lib/wakeLock.js, src/lib/wakeLock.test.js, src/hooks/useWakeLock.js
- FOUND: 017ac40, 69c22c9, 9e4a731
