---
phase: 07-poprawki-po-tescie-na-telefonach-i-organizacja-konkursu
plan: 05
subsystem: kody-uczestnikow, anty-cheat, warstwa-danych
tags: [kody-4-cyfrowe, csv, limit-prob, naruszenia, vitest, tdd]
requires: []
provides:
  - "src/lib/codeFormat.js: CITY_PREFIX, CODE_RE, formatCodeInput, normalizeParticipantCode, parseCodesCsv, pickFreeNumbers, assignNumbers, takenNumbersFromCodes, joinLines"
  - "src/lib/violations.js: VIOLATION_LABELS, summarizeViolations, violationsFor"
  - "supabase.js: validateParticipantCode (rateLimited/retryAfterS), generateParticipantCode({ number }) z conflict, recordViolation({ typeCount }), getViolationSummary"
affects: [07-07, 07-08, 07-09, 07-11]
tech-stack:
  added: []
  patterns:
    - "Czyste moduły logiki + testy Vitest, supabase.js tylko je woła"
    - "Soft-fallback PGRST202 dla każdego nowego RPC sekcji 44"
key-files:
  created:
    - src/lib/codeFormat.js
    - src/lib/codeFormat.test.js
    - src/lib/violations.js
    - src/lib/violations.test.js
  modified:
    - src/lib/supabase.js
decisions:
  - "Numer podany przez admina (ręcznie lub z CSV) zajęty → błąd z conflict: true, bez ponawiania; losowy → pętla do 30 prób (koniec rekurencji)"
  - "Podpowiedź o Excelu w błędzie CSV dopisywana, gdy surowa komórka to 1–3 cyfry (UI-SPEC §5: „komórka ma same cyfry i mniej niż 4”)"
  - "Import CSV: 6 cyfr w kolumnie Kod = błąd „musi mieć 4 cyfry” (nowe kody tylko 4-cyfrowe); logowanie nadal przyjmuje 6 cyfr"
  - "pickFreeNumbers: rng(max) → liczba całkowita z [0, max), częściowy Fisher–Yates na puli wolnych 0000–9999"
  - "DEMO: limiter prób w pamięci modułu (5 porażek / 60 s), jak w SQL"
metrics:
  duration: 25min
  completed: 2026-09-28
  tasks: 3
  files: 5
---

# Faza 07 Plan 05: Kontrakty kodów 4-cyfrowych i naruszeń — podsumowanie

Czyste moduły `codeFormat.js` (myślnik w polu kodu, normalizacja wklejenia, parser CSV `Imię;Nazwisko;Kod` z błędami wierszy, losowanie wolnych numerów) i `violations.js` (agregacja naruszeń per typ), przetestowane Vitestem, oraz zmiany w `supabase.js`: limit prób (`rate_limited`), nowe teksty UI-SPEC, kody 4-cyfrowe z ręcznym numerem i konfliktem, zapis naruszeń przez RPC `record_violation` i podsumowanie `getViolationSummary` — wszystko z soft-fallbackiem działającym przed wgraniem sekcji 44.

## Zadania

| # | Zadanie | Commity | Pliki |
|---|---------|---------|-------|
| 1 | codeFormat.js + testy (TDD) | `bbc2bbd` (RED), `a48d06a` (GREEN) | src/lib/codeFormat.js, src/lib/codeFormat.test.js |
| 2 | violations.js + testy (TDD) | `57960d2` (RED), `f68e1a2` (GREEN) | src/lib/violations.js, src/lib/violations.test.js |
| 3 | supabase.js — kody i naruszenia | `86d4f0f` | src/lib/supabase.js |

## Co powstało

**codeFormat.js** (28 testów, 60 asercji `expect(`)
- `formatCodeInput(raw, prev)` — wielkie litery, myślnik po 3 literach, rozpoznanie kasowania („KRK-” → „KRK”), wklejenie `krk1111` / `KRK 1111` / `krk-1111` → `KRK-1111`, maks. 6 cyfr.
- `normalizeParticipantCode` — `KRK-1111` / `KRK-482910` albo `null`.
- `parseCodesCsv(text, { prefix, city, takenNumbers })` — BOM, `;` i `,`, nagłówek `imię`/`imie`, fizyczna numeracja linii, `="0042"`, `KRK-0042`, `krk0042`; błędy: brak imienia lub nazwiska, nie-4 cyfry (z podpowiedzią Excela dla 1–3 cyfr), inne miasto, duplikat w pliku (wszystkie wiersze), zajęty w mieście; błędy posortowane po linii.
- `pickFreeNumbers`, `assignNumbers` (bez mutacji wejścia, `random: true`), `takenNumbersFromCodes` (tylko 4-cyfrowe z prefiksem), `joinLines`.

**violations.js** (9 testów)
- `VIOLATION_LABELS` — jedno źródło etykiet dla panelu i XLSX.
- `summarizeViolations(rows)` — `total = max(count)`, per typ `max(type_count)`, dla starych wierszy liczba wierszy; klucze snake_case i camelCase (DEMO); `total ≥ tab_switch + screenshot_attempt`; wynik bez pól pomocniczych.
- `violationsFor(map, code)` — kopia wpisu albo zera.

**supabase.js**
- `CITY_PREFIX` importowany z `codeFormat.js` (lokalna definicja usunięta), `randomCodeBody(len = 4)` z komentarzem o decyzji użytkownika.
- `validateParticipantCode`: `CODE_NOT_FOUND` („Nie znaleziono kodu. Sprawdź litery i cyfry na karcie od organizatora.”) we wszystkich 5 miejscach; `reason === "rate_limited"` → `{ error: "Za dużo prób — spróbuj za minutę", rateLimited: true, retryAfterS }`; DEMO z tym samym limitem 5/60 s.
- `generateParticipantCode({ ..., number = null })`: walidacja 4 cyfr, jedna próba dla numeru admina (23505 → `{ error: "Kod KRK-1111 jest już zajęty w mieście Kraków.", conflict: true, code }`), losowy do 30 prób, bez rekurencji; DEMO na tych samych regułach.
- `recordViolation({ ..., typeCount = null })`: RPC `record_violation`, przy PGRST202 dotychczasowy INSERT bez `type_count`; DEMO zapisuje też `typeCount`.
- `getViolationSummary(sessionId)`: RPC `get_session_violation_summary` → `Map` (zapas `rows_tab`/`rows_shot`), przy PGRST202 stronicowany select (`.range(from, from + 999)`) + `summarizeViolations`, inny błąd → pusta `Map` + `console.error`. `getViolationsForSession` bez zmian.

## Weryfikacja

- `npx vitest run src/lib/codeFormat.test.js src/lib/violations.test.js` — 37/37.
- `npm test` — 10 plików, 251/251.
- `npm run build` — kod 0.
- Wszystkie kryteria akceptacji `grep` z planu spełnione (m.in. `CODE_NOT_FOUND` = 6, brak `"Nie znaleziono kodu."`, brak `return generateParticipantCode(`, `rateLimited: true` = 2).
- Jednorazowy test w trybie DEMO (nie commitowany): numer ręczny `0042` → `KRK-0042`, powtórka → `conflict: true`, `42` → błąd formatu, losowy `WAR-NNNN`, 5 błędnych prób → 6. próba `rateLimited`, `recordViolation` + `getViolationSummary` → `{ total: 2, tab_switch: 2, screenshot_attempt: 0 }`.

## Odchylenia od planu

Plan wykonany zgodnie z opisem. Drobne doprecyzowania w granicach planu (nie zmieniają kontraktów):
- `parseCodesCsv` przyjmuje też spację między prefiksem a numerem (`KRK 0042`), nie tylko myślnik lub brak separatora.
- `takenNumbersFromCodes` przyjmuje także tablicę samych napisów oraz `null`.
- `getViolationSummary` w fallbacku przerywa stronicowanie przy błędzie strony (loguje i zwraca to, co zebrało), zamiast wisieć w pętli.

### Uwaga środowiskowa (nie dotyczy kodu)
Gałąź worktree startowała na `272dbf0` (przed planami fazy 07), więc na początku zrobiłem `git merge --ff-only main` do `aca4369`. Bez zmian w historii poza przewinięciem.

## Wpływ na istniejący UI

`AdminPanel.jsx` (KodyTab) woła `generateParticipantCode` bez `number`, więc od teraz generuje kody 4-cyfrowe (zamierzone). Wynik tych wywołań jest dziś ignorowany; obsługę `conflict`/błędów doda plan 07-09.

## Known Stubs

Brak.

## Self-Check: PASSED

- FOUND: src/lib/codeFormat.js, src/lib/codeFormat.test.js, src/lib/violations.js, src/lib/violations.test.js, src/lib/supabase.js
- FOUND commits: bbc2bbd, a48d06a, 57960d2, f68e1a2, 86d4f0f
