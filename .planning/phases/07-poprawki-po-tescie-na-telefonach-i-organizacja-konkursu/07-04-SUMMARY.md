---
phase: 07-poprawki-po-tescie-na-telefonach-i-organizacja-konkursu
plan: 04
subsystem: ekran-uczestnika
tags: [haptyka, ios, view-transitions, plynnosc, quiz]
requires: []
provides:
  - "src/lib/haptics.js: hasSwitchHaptics(), vibrateTap()"
  - "Nakładka <label> z ukrytym przełącznikiem w kafelkach odpowiedzi (iOS 18+)"
  - "viewTransition.js: VT_STABLE_FRAMES, VT_STABLE_GAP_MS, VT_MAX_STRIKES, VT_INITIAL, nextVtState, isVtSuppressed, reguła granicy startu pytania"
  - "Wejście pytania animacją CSS fi 180 ms"
affects:
  - src/screens/Quiz.jsx
  - src/hooks/useParticipantGame.js
tech-stack:
  added: []
  patterns:
    - "Haptyka iOS przez <input type=checkbox switch> pod prawdziwym dotknięciem (label-nakładka), Android przez navigator.vibrate"
    - "Stan VT jako czysta maszyna stanów (strikes + stableFrames) aktualizowana w tickerze rAF bez alokacji"
key-files:
  created:
    - src/lib/haptics.js
    - src/screens/Quiz.test.jsx
  modified:
    - src/screens/Quiz.jsx
    - src/lib/viewTransition.js
    - src/lib/viewTransition.test.js
    - src/hooks/useParticipantGame.js
    - src/hooks/useParticipantGame.test.js
decisions:
  - "Start pytania (countdown/intro → quiz) nigdy nie idzie przez View Transition — wejście pytania animuje CSS (fi .18s) na .fue-quiz-main"
  - "Po wolnym przejściu VT wyłączone czasowo (wraca po 120 klatkach < 34 ms), na stałe po 2. porażce; jedno przejście = najwyżej jedna porażka (guard struck)"
  - "Nakładka haptyczna tylko gdy wybór możliwy (!answered && picked === null); przełącznik visibility:hidden (nie display:none, nie disabled), stopPropagation na nim = onPick raz"
metrics:
  duration: ~25min
  completed: 2026-09-28
  tasks: 2
  files: 7
requirements: [P7-IOS-HAPTIC, P7-VT-SMOOTH]
---

# Faza 07 Plan 04: Haptyka iOS i płynniejsze przejścia — podsumowanie

Tyknięcie haptyczne na iPhonie (iOS 18+) przez przezroczystą nakładkę `<label>` z ukrytym przełącznikiem `<input type="checkbox" switch>` w każdym kafelku odpowiedzi oraz złagodzenie „VT wyłączone na zawsze” (licznik porażek + powrót po 120 płynnych klatkach) z całkowitym wyłączeniem View Transition na starcie pytania (zastąpione animacją CSS `fi` 180 ms).

## Wykonane zadania

| # | Zadanie | Commity | Pliki |
|---|---------|---------|-------|
| 1 | Haptyka — `haptics.js` + nakładka w `Quiz.jsx` + `Quiz.test.jsx` | f9768d1 (RED), da9676c (GREEN) | src/lib/haptics.js, src/screens/Quiz.jsx, src/screens/Quiz.test.jsx |
| 2 | VT — reguła granicy startu pytania, licznik porażek, wejście pytania CSS | 94fecd0 (RED), d36def4 (GREEN) | src/lib/viewTransition.js, src/lib/viewTransition.test.js, src/hooks/useParticipantGame.js, src/hooks/useParticipantGame.test.js, src/screens/Quiz.jsx |

## Szczegóły

**Haptyka (P7-IOS-HAPTIC):**
- `hasSwitchHaptics()` wykrywa `"switch" in HTMLInputElement.prototype`; `vibrateTap()` = `navigator.vibrate?.(15)` w try/catch (Android bez zmian).
- W `<button className="ans-btn">` pierwsze dziecko to `<label aria-hidden="true">` (absolute, inset 0, zIndex 1, przezroczysty, bez podświetlenia dotyku) z `<input type="checkbox" tabIndex={-1}>`; atrybut `switch` ustawiany w ref (React nie zna tego atrybutu), `onClick={e => e.stopPropagation()}`, `visibility: "hidden"`.
- Dotknięcie labela: przeglądarka przełącza przełącznik (haptyka), syntetyczny klik przełącznika zatrzymany, oryginalny klik labela bąbelkuje do przycisku → `onPick` dokładnie raz.
- Wygląd kafelków bez zmian.

**View Transitions (P7-VT-SMOOTH):**
- `shouldStartViewTransition` przyjmuje opcjonalne `fromPhase`/`toPhase`; `countdown`/`intro` → `quiz` zawsze `false`.
- `nextVtState`/`isVtSuppressed` — czysta maszyna stanów; bez porażek klatka zwraca ten sam obiekt (zero alokacji w rAF).
- `useParticipantGame`: `vtStateRef` zamiast `vtSlowRef`; w `pushView` guard `struck` (callback odpalony po `skipTransition` nie liczy drugiej porażki); ticker rAF karmi stan klatkami.
- `Quiz.jsx`: `animation: "fi .18s ease-out both"` na `.fue-quiz-main` — odpala się przy zamontowaniu (wejście pytania), nie przy quiz → reveal; reduced-motion wyłącza ją globalnie.

## Weryfikacja

- `vitest run` — 9 plików, 226 testów, wszystkie zielone (w tym 4 nowe w `Quiz.test.jsx`, 8 nowych w `viewTransition.test.js`, 2 przepisane w `useParticipantGame.test.js`).
- `vite build` — kod 0.
- Kryteria grep z planu spełnione (visibility/stopPropagation/setAttribute("switch") po 1; brak `navigator.vibrate`, `label.click`, `display: "none"` w Quiz.jsx; `vtSlowRef` = 0; `nextVtState(` = 2; `toPhase: v.phase` = 1; 3 stałe VT; animacja `fi .18s`).
- Do zrobienia w 07-12: sonda 5× z PROBE_TRACE (devDom ≤ 1500 ms, cel < 400 ms; liczba VT w śladzie zmaleje — oczekiwane) i ręczny test na iPhonie (Safari + Chrome) — odczuwalne tyknięcie.

## Odstępstwa od planu

### Automatycznie naprawione

**1. [Reguła 1 - Błąd/test] Przepisane 2 testy VT w `useParticipantGame.test.js`**
- **Wykryto podczas:** Zadanie 2
- **Problem:** Istniejące testy („callback odkładany 400 ms …, kolejne przejścia bez VT”, „szybki callback …”) zakładały VT na granicy intro → quiz i trwałe wyłączenie VT po pierwszej porażce — dokładnie to zachowanie, które plan zmienia.
- **Poprawka:** Testy sprawdzają teraz nowe reguły na pełnym przebiegu dwóch pytań: start pytania bez VT, faza po ≤ 150 ms przy wolnym callbacku, powrót VT po serii płynnych klatek (co przy okazji dowodzi, że callback po `skipTransition` nie liczy drugiej porażki), trwałe wyłączenie po 2. porażce.
- **Pliki:** src/hooks/useParticipantGame.test.js
- **Commit:** d36def4

**2. [Reguła 3 - Blokada] Uruchamianie testów bez junction `node_modules`**
- Narzędzie odrzuciło `mklink`/`New-Item -ItemType Junction` w izolowanym worktree. Worktree leży wewnątrz głównego repo, więc rozwiązywanie modułów Node znajduje `D:\Projects\fue-quiz-project\node_modules` wyżej w drzewie; testy i build uruchomione przez `node …/node_modules/vitest/vitest.mjs run` i `node …/node_modules/vite/bin/vite.js build`. Bez zmian w repo.

**3. Worktree startował z nieaktualnego commita (272dbf0)** — przed pracą wykonano `git merge --ff-only main` (do aca4369), żeby mieć pliki fazy 07.

## Decyzje (do przeniesienia do STATE.md przez orkiestratora)

- 07-04: start pytania (countdown/intro → quiz) nigdy przez View Transition — wejście pytania to animacja CSS `fi` 180 ms (nie opóźnia zmiany DOM, chroni devDom).
- 07-04: VT po wolnym przejściu wyłączone czasowo (powrót po 120 klatkach < 34 ms), na stałe po 2. porażce; jedno przejście liczy najwyżej jedną porażkę.
- 07-04: haptyka iOS przez nakładkę `<label>` z ukrytym (`visibility:hidden`) przełącznikiem, tylko gdy wybór możliwy; Android dalej `navigator.vibrate(15)`.

## Znane zaślepki

Brak.

## Uwagi

- `<label>` wewnątrz `<button>` formalnie narusza model treści HTML (treść interaktywna w przycisku), ale tak wymaga plan/Wzorzec 3 — nakładka musi leżeć pod palcem w kafelku. React nie zgłasza ostrzeżenia; skuteczność haptyki potwierdzi dopiero test na fizycznym iPhonie (07-12).

## Self-Check: PASSED

- FOUND: src/lib/haptics.js, src/screens/Quiz.test.jsx
- FOUND: f9768d1, da9676c, 94fecd0, d36def4
