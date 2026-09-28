---
phase: 07-poprawki-po-tescie-na-telefonach-i-organizacja-konkursu
plan: 08
subsystem: participant-ui / kody-uczestnikow
tags: [kody-4-cyfrowe, limit-prob, code-entry, rtl, tdd]
requires:
  - "07-03: armWakeLockFromGesture({ force: true })"
  - "07-05: formatCodeInput, normalizeParticipantCode, validateParticipantCode → { rateLimited, retryAfterS }"
provides:
  - "src/screens/CodeEntry.jsx: auto-myślnik, walidacja formatu po stronie klienta, blokada z odliczaniem „Odczekaj {n} s”"
  - "src/screens/CodeEntry.test.jsx: 9 testów RTL (P7-CODE-DASH, P7-CODE-RATE)"
affects: [07-12]
tech-stack:
  added: []
  patterns:
    - "Blokada czasowa w UI jako lockUntil (ms) + now odświeżane interwałem 250 ms tylko w trakcie blokady"
key-files:
  created:
    - src/screens/CodeEntry.test.jsx
  modified:
    - src/screens/CodeEntry.jsx
decisions:
  - "retryAfterS brakujące/niepoprawne → 60 s w UI (UI-SPEC §4: domyślnie 60), niezależnie od domyślnej w supabase.js"
  - "Pole ma aria-label „Kod uczestnika” (dostępność + selektor w testach)"
metrics:
  duration: 8min
  completed: 2026-09-28
  tasks: 1
  files: 2
requirements: [P7-CODE-DASH, P7-CODE-RATE]
---

# Faza 7 Plan 08: Ekran kodu — auto-myślnik i czytelny limit prób Summary

`CodeEntry.jsx` przepuszcza każdą zmianę pola przez `formatCodeInput` (wpisanie „krk” daje „KRK-”, kasowanie na „KRK-” daje „KRK”, wklejenie `krk1111` / `KRK 1111` / `krk-1111` daje `KRK-1111`). Kod w złym formacie odrzuca już klient, bez RPC, więc literówka nie zużywa próby z limitu. Po odpowiedzi `rate_limited` przycisk jest nieaktywny i odlicza „Odczekaj {n} s”, a po dojściu do zera komunikat znika.

## Zadania

| # | Zadanie | Commit | Pliki |
|---|---------|--------|-------|
| 1 (RED) | Testy RTL: myślnik, wklejanie, atrybuty, walidacja, limit | `3e0e3dd` | src/screens/CodeEntry.test.jsx |
| 1 (GREEN) | Auto-myślnik, walidacja formatu, odliczanie limitu | `19434d5` | src/screens/CodeEntry.jsx |

## Jak działa

- `submit`: pierwsza instrukcja to nadal `armWakeLockFromGesture({ force: true })` (07-03). Potem kolejno: `if (locked || loading) return`, puste pole → „Wprowadź kod uczestnika.”, `normalizeParticipantCode` → `null` → komunikat `FORMAT_ERR` (bez RPC). Na końcu `validateParticipantCode(norm)`.
- `rateLimited` → `lockUntil = Date.now() + retryAfterS·1000`. Interwał 250 ms odświeża `now` tylko wtedy, gdy trwa blokada. `lockLeft = ceil((lockUntil − now)/1000)`. Gdy blokada wygaśnie, efekt czyści `err` i `lockUntil`.
- W trakcie blokady: przycisk ma `disabled`, `opacity .5` i `cursor: not-allowed`, Enter nie wysyła, a edycja pola nie czyści komunikatu limitu. Poza blokadą edycja czyści błąd tak jak wcześniej.
- Pole: `placeholder="KRK-1234"`, `maxLength={10}` (stare kody `XXX-NNNNNN` się mieszczą), `autoCapitalize="characters"`, `autoCorrect/autoComplete="off"`, `spellCheck={false}`, `inputMode="text"`. Podpowiedź: „Przykład: KRK-1111”. Komunikat ma `role="alert"` i `aria-live="polite"`.

## Weryfikacja

- `vitest run src/screens/CodeEntry.test.jsx src/lib/codeFormat.test.js`: 37/37 (w tym 9 nowych).
- Pełny `vitest run`: 14 plików, 293/293.
- `vite build`: kod 0.
- Wszystkie grepy z `acceptance_criteria` przechodzą (każdy wzorzec = 1; `KRK-482910|XXX-000000` = 0; 9 × `it(`).
- Test ręczny na iPhonie (klawiatura z wielkimi literami; 5 złych kodów → „Odczekaj 60 s”) zostaje do bramki 07-12.

## Odstępstwa od planu

Plan wykonano zgodnie z opisem. Są dwa drobne doprecyzowania, które nie zmieniają kontraktu:
- `setLockUntil(Date.now() + (Number(res.retryAfterS) || 60) * 1000)`: zabezpieczenie na wypadek braku `retryAfterS`, domyślnie 60 s wg UI-SPEC.
- Do pola dodano `aria-label="Kod uczestnika"`. Plan i tak go wymieniał w liście atrybutów, a testy używają go jako selektora.

### Uwaga środowiskowa (nie dotyczy kodu)
Główny `D:\Projects\fue-quiz-project\node_modules` był w chwili wykonania **pusty** (katalog utworzony 21:39). Ścieżka `../../../node_modules/vitest/vitest.mjs` z instrukcji orkiestratora nie działała. Testy i build uruchomiłem przez junction `node_modules` w worktree → `D:\Projects\fue-quiz-project\fue-quiz\node_modules` (wersje zgodne z package.json: vitest 2.1.9, jsdom 24.1.3, @testing-library/react 16.3.2, react 18.3.1). Junction jest w `.gitignore` i nie trafił do commita. W `fue-quiz/node_modules` brakuje pakietu `qrcode`, mimo to build przeszedł. Warto sprawdzić, dlaczego główny `node_modules` jest pusty. Możliwe, że trzeba tam ponownie zrobić `npm install`.

## Known Stubs

Brak.

## Self-Check: PASSED

- FOUND: src/screens/CodeEntry.jsx, src/screens/CodeEntry.test.jsx
- FOUND commits: 3e0e3dd, 19434d5
