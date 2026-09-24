---
phase: 06-rozgrywka-autorytatywna-serwera-i-plynnosc-jak-w-aplikacji
plan: 03
subsystem: database
tags: [supabase, pg_cron, verification, regression, production]
requires: ["06-01", "06-02"]
provides:
  - "scripts/verify-plan.js — parzystość JS↔SQL planu sesji (read-only, 29 przypadków)"
  - "scripts/verify-prod.js — smoke sekcji 39–40 (istnienie, blokady anona, żywotność zamiatacza)"
  - "Sekcje 39–40 wgrane na produkcję ytbwmmqwbfcugouourih; pg_cron fue-advance-due żyje"
  - "Dowód SC6: sesja bez planu (stary front 87e7c20) działa jak przed wgraniem 39–40"
affects: [06-05, 06-06, 06-08, 06-09, 06-10]
tech-stack:
  added: []
  patterns: ["parzystość JS↔SQL na wspólnych fixture'ach", "regresja starego buildu przez git worktree + vite preview"]
key-files:
  created: [scripts/verify-plan.js]
  modified: [scripts/verify-prod.js, package.json]
key-decisions:
  - "SC6 oceniane jako brak regresji względem stanu sprzed 39–40: jedyne FAIL-e sondy to znana anomalia D6 na ostatnim pytaniu, odtworzona na tym samym kodzie przed wgraniem SQL"
  - "Anomalia D6 zlokalizowana: stary front na jednym z telefonów liczy ostatnie pytanie od 90 s zamiast od 20 s (błąd klienta, nie bazy). Znika z konstrukcją nowego frontu (06-05). Nie naprawiamy w starym buildzie"
requirements-completed: [P6-SC1, P6-SC6]
duration: ~35 min (bez czasu oczekiwania na ręczne wgranie SQL)
completed: 2026-09-24
---

# Phase 6 Plan 03: Wgranie sekcji 39–40 i bramka weryfikacji produkcji Summary

**Sekcje 39–40 są na produkcji. Zamiatacz pg_cron chodzi co 1 s, verify-prod pokazuje 40 OK, parzystość JS↔SQL wynosi 29/29, a stary wdrożony front na sesji bez planu zachowuje się tak samo jak przed wgraniem SQL. Zamiatacz nie dotknął tej sesji.**

## Performance
- Tasks: 3/3 (1 auto, 1 human-action, 1 auto)
- Files modified: 3 (`scripts/verify-plan.js` nowy, `scripts/verify-prod.js`, `package.json`)

## Accomplishments
- `npm run verify-plan`: 19 pozycji planu + 10 decyzji zamiatacza, JS (`plan.js`) i SQL (`plan_position`/`sweep_decision`) dają identyczne wyniki, zgodne z `expect`. **PARZYSTOŚĆ JS↔SQL: 29/29**, kod 0
- `npm run verify-prod`: **PRODUKCJA GOTOWA pod kątem SQL (40 OK)**, kod 0. Stary kontrakt (sekcje 16–38) nadal zielony. Sekcje 39–40: 5 funkcji dostępnych dla anona, `session_plans` i kolumny planu czytelne, 7 funkcji admina/zamiatacza zablokowanych dla anona, zamiatacz żyje (ostatni przebieg 0,0–0,8 s temu, harmonogram `'1 seconds'`)
- Ręczne wgranie SQL (Task 2, human-action) zakończone. Wynik opisany niżej
- Regresja SC6 na starym buildzie wykonana dwa razy (drugi przebieg ze śladem i monitoringiem wiersza sesji)

## Task 2 — ręczne wgranie (human-action)
- Projekt: `ytbwmmqwbfcugouourih` (produkcja z `.env`)
- `select version();` → **PostgreSQL 17.6** on aarch64-unknown-linux-gnu (gcc 15.2.0). To powyżej wymogu 15.1.1.61 dla harmonogramu `'1 seconds'`
- Użytkownik wkleił linie 1283–2052 `SUPABASE_FIXES.sql` (sekcje 39 + 40 razem, po kolei) w SQL Editor. Przeszło bez błędów, `cron.schedule` zwróciło id zadania 2
- `select public.sweeper_status();` → `{"cron_installed": true, "job_active": true, "schedule": "1 seconds", "last_run_age_s": 0.547, "last_status": "succeeded"}`
- Wersja rozszerzenia pg_cron nie została podana. Nie jest potrzebna, bo `sweeper_status` potwierdza działający harmonogram 1 s

## SC6 regresja starego buildu: OK (brak regresji), 2026-09-24, 3 pytania sondy, 2 telefony, Kraków
- Build: worktree `87e7c20` (kod `src/` identyczny z wdrożonym `c2180d6`, `git diff --stat` puste), `npm ci && npm run build`, `vite preview --port 4174`
- Komenda: `PROBE_TARGET=prod PROBE_CONFIRM=1 PROBE_APP_URL=http://localhost:4174 npm run sonda` (sonda z głównego repo, niezmieniona)

| Metryka | Przebieg 1 | Przebieg 2 (PROBE_TRACE=1) | Stan sprzed 39–40 (debug 2026-09-24T00:50–01:00, ten sam kod) |
|---|---|---|---|
| pyt.1 / pyt.2 | 26,8 s ✅ / 26,3 s ✅ | 27,0 s ✅ / 25,9 s ✅ | 26,3–26,9 s ✅ |
| pyt.3 (ostatnie) | 77,9 s (ucięte limitem) | 77,5 s (ucięte limitem) | 78,1–78,2 s (ucięte limitem) |
| Host vs telefon | 0 ms ✅ | 0 ms ✅ | 0 ms ✅ |
| Telefon vs telefon | 70 s ❌ | 70 s ❌ | 70–71 s ❌ |
| Najdłuższy postój | 77,9 s ❌ | 77,5 s ❌ | 78,1–78,2 s ❌ |
| Socket Realtime | 3 zdarzenia / 3 pytania ✅ | 3/3 ✅ | 3/3 ✅ |
| Sprzątanie | czysto ✅ | czysto ✅ | czysto ✅ |

- **Kod wyjścia sondy: 1 (2 FAIL-e) w obu przebiegach.** Oba FAIL-e to znana anomalia D6 (`.planning/research/PLYNNOSC-ROZGRYWKI.md`, `.planning/debug/telefon-refresh-blokuje-live-view.md`). Ma ona taką samą sygnaturę i taką samą wartość (70 s) jak na tym kodzie przed wgraniem sekcji 39–40. Wszystkie przejścia prowadzone przez starego kierowcę admina (pyt.1→2→3) są czyste
- **Zlokalizowane w śladzie (nowe ustalenie dla D6):** na ostatnim pytaniu telefon 1 startuje licznik od **90 s** (90→0), a telefon 2 poprawnie od 20 s (20→0, potem „czekam na wyniki” w ~98 s). Stąd 70 s rozjazdu i „postój”. To błąd obliczania czasu w kliencie starego `App.jsx` dla przypadku „brak kolejnego pytania”, nie problem bazy
- **Zamiatacz nie dotyka sesji bez planu:** monitoring wiersza `quiz_sessions` Krakowa co 1 s przez cały przebieg 2: `plan_anchor_at = null`, `plan_paused_at = null`, `revealed_idx = null`, `session_plans` = 0 wierszy. Przejścia `current_question_idx` 0→1→2 zapisał wyłącznie stary kierowca (`advance_session_question` przechodzi przy `plan_anchor_at IS NULL`). Po ostatnim pytaniu status zostaje `running`, jak w starym modelu. Na koniec sonda przywraca stan `waiting`
- **Stan produkcji po teście:** `session_plans` 0, pytania `[SONDA]` 0, kody `PRB-` 0, profile sondy 0, sesja Krakowa `waiting / idx 0 / plan_anchor_at null`
- Po sondzie: preview zatrzymany (port 4174 wolny), `git worktree remove --force` wykonane, `git worktree list` nie zawiera `fue-old`
- `scripts/verify-prod.js` nie wymagał zmian, bo sonda nie ujawniła niesprawdzonego elementu starego kontraktu

## Task Commits
1. **Task 1: verify-plan.js + verify-prod sekcje 39–40** – `c4e4c94`
2. **Task 2: ręczne wgranie sekcji 39–40** – brak commitu (zmiana wyłącznie na produkcji, repo bez zmian)
3. **Task 3: regresja SC6** – brak commitu (weryfikacja, bez zmian w plikach)

## Decisions Made
- SC6 oceniane względem stanu sprzed wgrania, nie literalnie jako „sonda kod 0”. Domyślna sonda na starym buildzie z definicji nie przechodzi ostatniego pytania z powodu D6, niezależnie od SQL. Porównanie przebiegów to jedyny uczciwy dowód braku regresji
- D6 nie jest naprawiane w starym buildzie. Nowy front (06-05) liczy fazy z planu i zegara serwera, a przejście „ostatnie pytanie → wyniki” wykonuje zamiatacz, więc ta klasa błędu znika z konstrukcji. Jeśli po 06-08 D6 nadal występuje, potrzebne jest osobne `/gsd:debug` (zgodnie z CONTEXT)

## Deviations from Plan

**1. [Kryterium akceptacji] Sonda na starym buildzie kończy się kodem 1, a nie 0**
- **Found during:** Task 3
- **Issue:** Kryterium „Sonda na starym buildzie kończy się kodem 0” jest nieosiągalne dla tego buildu. Anomalia D6 na ostatnim pytaniu była odnotowana już przed fazą 6 na identycznym kodzie (`c2180d6`)
- **Action:** Bez zmian w kodzie i na produkcji. Wykonano drugi przebieg ze śladem i monitoringiem wiersza sesji. Wynik: przyczyna leży w kliencie starego buildu (licznik 90 s na jednym telefonie), zamiatacz sesji nie dotyka, a metryki są identyczne ze stanem sprzed 39–40
- **Impact:** Brak dla SC6 (brak regresji). Dla 06-08 i 06-09: sonda na nowym froncie powinna przejść ostatnie pytanie. To będzie potwierdzenie, że D6 zniknęło

## Deferred Issues
- D6 w starym buildzie (licznik ostatniego pytania 90 s na jednym telefonie). Nie naprawiamy, bo stary front zostanie zastąpiony w 06-05/06-09. Sprawdzić w 06-08 na nowym froncie

## Known Stubs
Brak.

## Self-Check: PASSED
- FOUND: scripts/verify-plan.js, scripts/verify-prod.js (sekcja 39–40), package.json (`verify-plan`)
- FOUND: commit c4e4c94
- verify-prod kod 0 (40 OK), verify-plan kod 0 (29/29), worktree `fue-old` usunięty, port 4174 wolny, produkcja bez resztek sondy
