# Quick 261026-wfx — PODSUMOWANIE

**Commit:** `afb7c46` · **SQL 48 na prod:** 27.10 ok. 00:20 (`npm run db:sql -- --section 48`) · **Front:** 27.10 00:28, `index-CwBmYp0V.js`.

Decyzja użytkownika: najpierw miała być baza testowa, ostatecznie „od razu na produkcję” (baza testowa pusta, finał tego dnia).

## Weryfikacja na produkcji
- Plany właściwe 5 miast zapisane PRZED wgraniem; po wgraniu `build_session_plan(city, false)` identyczny co do bajtu dla wszystkich 5 (50 pytań każde).
- `build_session_plan(city, true)` = 4 pytania, wszystkie `is_practice = true`, w każdym mieście.
- `start_quiz_session_v2` na prod zawiera nową wersję (przekazuje is_practice).
- Prawdziwy start w transakcji wycofanej (`RAISE EXCEPTION` na końcu, jako superadmin przez `request.jwt.claims`), fikcyjne miasto `ZZ-TEST-48`: PRÓBNA ok, running, plan = 2 pytania próbne; WŁAŚCIWA ok, running, plan = 1 pytanie główne. Resztki 0/0.
- `verify-prod`: 76 OK (blok 48 zielony). `npm test` 372/372.

## Uwagi
- `BOT_ADMIN_PASSWORD` z `.env` nie loguje („Invalid login credentials”) — sondy z logowaniem admina wymagają aktualnego hasła.
- Wycofanie: zrzut 42.4 `start_quiz_session_v2` w scratchpadzie sesji b281c2cb (`rollback-48.sql`).
