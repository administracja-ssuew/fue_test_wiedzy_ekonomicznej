---
phase: 07-poprawki-po-tescie-na-telefonach-i-organizacja-konkursu
plan: 01
subsystem: backend-sql
tags: [supabase, sql, rate-limit, violations, reorder, pg_cron, verify]
requires: []
provides:
  - "Sekcja 44 w SUPABASE_FIXES.sql (code_attempts, limiter, record_violation, get_session_violation_summary, admin_reorder_questions, admin_recent_code_conflicts, admin_question_answer_presence, pg_cron, echo IP, schema_marker_44)"
  - "Blok 44.Z (warianty A/B) w komentarzu"
  - "npm run verify-code-limit"
  - "Blok sekcji 44 w npm run verify-prod"
affects: [07-05, 07-06, 07-10, 07-11]
tech-stack:
  added: []
  patterns:
    - "Limit prób w SQL: porażki w code_attempts, odrzucenia nie są zapisywane (blokada wygasa 60 s po ostatniej porażce)"
    - "Przełącznik warstwy IP jako funkcja STABLE (code_limit_ip_enabled) podmieniana osobnym blokiem 44.Z"
    - "RPC SECURITY INVOKER + RLS dla operacji admina na pytaniach (admin_reorder_questions)"
key-files:
  created:
    - scripts/verify-code-limit.js
  modified:
    - SUPABASE_FIXES.sql
    - scripts/verify-prod.js
    - package.json
decisions:
  - "44.7b: REVOKE EXECUTE validate_participant_code FROM anon — odchylenie od szkicu researchu (bez tego validate obchodzi limit i zwraca imię/nazwisko)"
  - "Warstwa limitu po IP wdrożona, ale wyłączona (code_limit_ip_enabled() = false) do werdyktu testu nagłówka; włączenie tylko wariantem 44.Z-A"
  - "code_exists i polityki violations bez zmian — utwardzenie wyroczni kodów zostaje do decyzji o sekcji 45 (po wdrożeniu frontu)"
metrics:
  duration: "~12 min"
  completed: 2026-09-28
  tasks: 2
  files: 4
---

# Faza 07 Plan 01: Sekcja SQL 44 i narzędzia jej weryfikacji — Podsumowanie

Addytywna sekcja 44 w `SUPABASE_FIXES.sql`: limit 5 błędnych kodów / 60 s na urządzenie w `claim_participant_code` (nowy powód `rate_limited` + `retry_after_s`), wyłączona warstwa limitu po IP, zapis naruszeń per typ przez `record_violation` + agregat dla raportu, atomowe `admin_reorder_questions`, dane widoku „kto utknął” i konfliktów kodów, sprzątanie `code_attempts` przez pg_cron. Do tego integracyjny `npm run verify-code-limit` i blok sekcji 44 w `npm run verify-prod`. **Sekcja NIE jest wgrana** — wgranie ręczne to plan 07-06.

## Zadania

| # | Zadanie | Commit | Pliki |
|---|---------|--------|-------|
| 1 | Sekcja 44 (44.1–44.14) + blok 44.Z w komentarzu | `6ee18b9` | `SUPABASE_FIXES.sql` |
| 2 | `verify-code-limit.js`, blok 44 w `verify-prod.js`, skrypt npm | `ee4f1e5` | `scripts/verify-code-limit.js`, `scripts/verify-prod.js`, `package.json` |

## Co powstało

**SUPABASE_FIXES.sql, sekcja 44** (po `schema_marker_43`, przed stopką „Done. Verify”):
- 44.1 `code_attempts` (tylko porażki `not_found`/`taken`), indeksy częściowe, RLS + REVOKE dla anon/authenticated (także sekwencja); indeks `participant_codes(device_id)`.
- 44.2 `request_ip()` (NULL poza PostgREST / przy śmieciach w nagłówku), 44.3 `code_limit_ip_enabled()` = `false` (STABLE).
- 44.4 `code_limit_retry_after(p_device, p_ip)`: urządzenie ≥ 5 porażek w 60 s → blokada do 60 s po ostatniej; IP ≥ 100 w 10 min (tylko gdy przełącznik włączony, z wyjątkiem dla urządzeń z przypiętym kodem).
- 44.5 `code_attempt_log` (wewnętrzna, długości przycięte).
- 44.6 `claim_participant_code` — CREATE OR REPLACE, ta sama sygnatura i granty; guard limitu przed wyszukaniem kodu, zapis porażek `not_found` i `taken`, sukces dosłownie jak §34.
- 44.7 `validate_participant_code` — identyczne `RETURNS TABLE`, ale `plpgsql VOLATILE` (Pułapka 5), limit po IP, zapis porażki; 44.7b REVOKE od anona.
- 44.8 `violations.type_count`, `record_violation` (zawsze VOID, bez wyroczni kodu), `get_session_violation_summary` (tylko admini).
- 44.9 `admin_reorder_questions(UUID[])` — SECURITY INVOKER, gęsta numeracja 0..n-1, RAISE = rollback całości.
- 44.10 `admin_recent_code_conflicts(p_city)`, 44.11 `admin_question_answer_presence(session, question)`.
- 44.12 pg_cron `fue-code-attempts-cleanup` (co 10 min, wiersze > 1 h), powtarzalny blok.
- 44.13 tymczasowe `debug_request_ip_echo()`, 44.14 `schema_marker_44()` + `NOTIFY pgrst, 'reload schema'`.
- 44.Z (w `/* … */`): wariant A (włącz IP + usuń echo) i wariant B (tylko usuń echo) + opis ryzyka rezydualnego.

**scripts/verify-code-limit.js** — pisze na produkcję i sprząta w `finally` (violations, participant_codes, code_attempts po urządzeniach A/B, potem odczyt resztek i linia `resztki: 0 ✅`). Werdykt nagłówka IP wypisywany dokładnie jako `IP: brak (…) → wariant 44.Z-B` / `IP: podrabialne → wariant 44.Z-B` / `IP: niepodrabialne → wariant 44.Z-A`; IP w logu tylko maskowane (`a.b.x.x`). Czas ~75 s.

**scripts/verify-prod.js** — blok „🎟️ SEKCJA 44”: marker, odmowy anona na 9 funkcjach (w tym `validate_participant_code` po 44.7b), `code_attempts` niedostępne dla anona, `record_violation` działa dla anona, stan echa IP. `claim_participant_code` nie jest wołany (skrypt zostaje read-only).

## Weryfikacja

- Wszystkie grepy z kryteriów akceptacji Task 1 i Task 2 spełnione (m.in. brak `DROP FUNCTION` claim/validate w sekcji 44, brak zmian `code_exists` / `violations_anon_insert`, `SELECT true` dla `code_limit_ip_enabled` wyłącznie w bloku 44.Z).
- `node --check` obu skryptów — kod 0.
- `vitest run` — 214/214 testów zielonych (plan nie dotyka `src/`).
- Skrypt `verify-code-limit` NIE był uruchamiany (sekcja 44 nie jest wgrana; zgodnie z planem to 07-06).

## Odchylenia od planu

### Odchylenia zaplanowane (opisane w planie)

**1. 44.7b — REVOKE EXECUTE `validate_participant_code` FROM anon (odchylenie od szkicu researchu)**
- Szkic w 07-RESEARCH zostawiał validate dostępne dla anona z samym limitem po IP. Limit po IP jest wyłączony do testu nagłówka, a validate nie zna urządzenia — byłby więc obejściem limitu, zwracającym imię i nazwisko. Żaden front nie woła validate przy istniejącym claim (fallback tylko przy PGRST202 claim, a claim jest na prod od §34). `authenticated` zachowuje EXECUTE.
- Skutek dla verify-prod: stary blok §27 dostaje dla validate odmowę uprawnień, którą `isMissing` dalej traktuje jako „istnieje” (bez zmian w tym bloku); nowy blok 44 wymaga tej odmowy.

### Drobne odchylenia wykonawcze

**2. [Rule 3 - Blokujące] Gałąź worktree była za `main`**
- Worktree startował z `272dbf0` (bez planów fazy 7). Wykonano `git merge --ff-only main` (do `aca4369`), żeby mieć `07-01-PLAN.md`. Bez zmian lokalnych, czysty fast-forward.

**3. [Rule 3 - Blokujące] Junction `node_modules` zablokowany przez strażnika powłoki**
- `mklink` / `New-Item -ItemType Junction` odrzucone w tym środowisku. Testy uruchomione przez `node D:/Projects/fue-quiz-project/node_modules/vitest/vitest.mjs run` — worktree leży w drzewie głównego repo, więc rozwiązywanie modułów trafia do jego `node_modules`. Nic nie zostało dodane do repo.

**4. Komentarz nagłówka verify-prod** — kryterium `grep -c "claim_participant_code" scripts/verify-prod.js = 0` wymusiło opisanie w nagłówku „RPC wiązania kodu (claim)” zamiast pełnej nazwy funkcji.

## Decyzje (do przeniesienia do STATE.md przez orkiestratora)

- 07-01: limit prób kodów w SQL per urządzenie (5 porażek / 60 s), odrzucenia nie są zapisywane; warstwa IP wyłączona do werdyktu `npm run verify-code-limit` (włącza ją tylko 44.Z-A).
- 07-01: `validate_participant_code` odebrane anonowi (44.7b) — zamyka obejście limitu przez validate.
- 07-01: `code_exists` / polityka `violations_anon_insert` bez zmian — utwardzenie wyroczni kodów to decyzja o sekcji 45 po wdrożeniu frontu fazy 7.

## Dla kolejnych planów

- 07-06 (ręcznie): wgrać 44.1–44.14 w SQL Editorze projektu `ytbwmmqwbfcugouourih`, potem `npm run verify-prod` i `npm run verify-code-limit`, następnie wariant 44.Z według wypisanej linii werdyktu, na końcu ponownie `npm run verify-prod` (echo ma być „usunięte”).
- Fronty 07-05 / 07-10 / 07-11: soft-fallback PGRST202 dla `record_violation`, `get_session_violation_summary`, `admin_reorder_questions`, `admin_recent_code_conflicts`, `admin_question_answer_presence`; obsługa `reason: 'rate_limited'` + `retry_after_s` w claim.

## Znane zaślepki

Brak. `debug_request_ip_echo` jest celowo tymczasowe (usuwane przez 44.Z w 07-06).

## Self-Check: PASSED

- FOUND: SUPABASE_FIXES.sql (sekcja 44, `schema_marker_44`)
- FOUND: scripts/verify-code-limit.js (264 linie)
- FOUND: scripts/verify-prod.js (`schema_marker_44`)
- FOUND: commit 6ee18b9
- FOUND: commit ee4f1e5
