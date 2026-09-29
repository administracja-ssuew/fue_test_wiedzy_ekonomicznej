---
phase: 07-poprawki-po-tescie-na-telefonach-i-organizacja-konkursu
plan: 06
subsystem: database
tags: [supabase, sql, rate-limit, production]
requires: ["07-01"]
provides: ["Sekcja 44 + 44.Z-A na produkcji", "07-GATE.md: Sekcja 44, Nagłówek IP"]
affects: ["07-12", "07-13"]
key-files:
  created:
    - .planning/phases/07-poprawki-po-tescie-na-telefonach-i-organizacja-konkursu/07-GATE.md
  modified:
    - scripts/verify-code-limit.js
key-decisions:
  - "Wariant 44.Z-A (warstwa limitu po IP włączona) — nagłówki IP niepodrabialne"
  - "Test nagłówka IP w verify-code-limit per nagłówek; odrzucenie przez Cloudflare = nagłówek nie dociera"
requirements-completed: [P7-CODE-RATE]
completed: 2026-09-29
---

# Plan 07-06: wgranie sekcji 44 i 44.Z na produkcję — podsumowanie

**Sekcja 44 i wariant 44.Z-A są na produkcji: limit prób kodów działa po urządzeniu i po IP, funkcja-echo usunięta; verify-prod 66 OK, verify-plan 47/47, verify-code-limit 8 OK, check-planless 0.**

## Wykonane

1. Przed wgraniem: `verify-prod` (jedyne ❌ = sekcja 44), sprawdzenie, że stary front woła `validate_participant_code` tylko przy PGRST202 z `claim` (REVOKE z 44.7b bezpieczny), zakres linii 2744–3014.
2. Użytkownik wgrał sekcję 44 → cztery weryfikacje zielone (szczegóły: `07-GATE.md` → „Sekcja 44”).
3. Werdykt IP: niepodrabialne → użytkownik wgrał 44.Z-A → `verify-code-limit` (8 OK, echo usunięte) i `verify-prod` (66 OK).

## Odstępstwa

- **[Błąd w narzędziu] `verify-code-limit` — test nagłówka IP.** Skrypt wysyłał trzy podrobione nagłówki naraz; Cloudflare odrzuca żądanie z podrobionym `CF-Connecting-IP` (błąd 1000), więc wynik był pusty, skrypt kończył się kodem 1 i wyprowadzał „podrabialne” (wariant B — wyłączona warstwa IP) bez dowodu. Poprawka: każdy nagłówek osobno, odrzucenie przez brzeg = nie dociera. Commit `c53880e`.

## Uwagi dla kolejnych planów

- 07-12: sonda regresji na starym froncie powinna potwierdzić wejście kodem po sekcji 44 (stary front dla `rate_limited` pokazuje „Nie znaleziono kodu.” — zamierzone).
- 07-13: decyzja o sekcji 45 (ryzyko rezydualne w `07-GATE.md` → „Nagłówek IP”).
